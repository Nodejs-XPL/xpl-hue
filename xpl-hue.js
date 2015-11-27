/*jslint node: true, vars: true, nomen: true */
'use strict';

var Xpl = require("xpl-api");
var commander = require('commander');
var os = require('os');
var debug = require('debug')('xpl-hue:cli');
var debugDevice = require('debug')('xpl-hue:device');
var async = require('async');

var Hue = require("./lib/hue");
var HueAPI = require("node-hue-api");

var DEFAULT_HUE_USERNAME = "XPL-NodeJS";

commander.version(require("./package.json").version);
commander.option("--host <host>", "Hostname of hue bridge");
commander.option("--port <port>", "Port of hue bridge", parseInt);
commander.option("--username <username>", "Hue username");
commander.option("--hueTimeout <ms>", "Hue timeout", parseInt);
commander.option("--upnpTimeout <ms>", "UPNP timeout", parseInt);
commander.option("-a, --deviceAliases <aliases>", "Devices aliases");

commander.option("--heapDump", "Enable heap dump (require heapdump)");

Xpl.fillCommander(commander);

commander.command('registerUser [username]').description("Create a user")
    .action(function(username) {
      if (!username) {
        username = commander.username;
      }

      if (!username) {
        username = DEFAULT_HUE_USERNAME;
      }

      var hue = new Hue(commander);
      hue.registerUser(username, function(error, username) {
        if (error) {
          console.error(error);
          return;
        }

        console.log("User '" + username + "' created !");
      });
    });

commander
    .command('run')
    .description("Start processing Hue")
    .action(
        function() {
          console.log("Start");

          if (!commander.username) {
            commander.username = DEFAULT_HUE_USERNAME;
          }

          var hue = new Hue(commander);

          hue
              .listAccessories(function(error, list) {
                if (error) {
                  if (error.message === 'unauthorized user') {
                    console.error("The user '" + commander.username +
                        "' is not authorized");
                    console
                        .error("Push the bridge BUTTON, and launch : node xpl-hue.js registerUser '" +
                            commander.username + "'");
                    process.exit(4);
                    return;
                  }
                  console.error("Hue error", error);
                  process.exit(5);
                  return;
                }

                if (!commander.xplSource) {
                  var hostName = os.hostname();
                  if (hostName.indexOf('.') > 0) {
                    hostName = hostName.substring(0, hostName.indexOf('.'));
                  }

                  commander.xplSource = "hue." + hostName;
                }

                var deviceAliases = Xpl
                    .loadDeviceAliases(commander.deviceAliases);

                debug("Device aliases=", deviceAliases);

                var xpl = new Xpl(commander);

                xpl.on("error", function(error) {
                  console.log("XPL error", error);
                });

                xpl.bind(function(error) {
                  if (error) {
                    console.log("Can not open xpl bridge ", error);
                    process.exit(2);
                    return;
                  }

                  console.log("Xpl bind succeed ");
                  // xpl.sendXplTrig(body, callback);

                  sendFullState(xpl, hue, deviceAliases);

                  xpl.on("xpl:xpl-cmnd", processXplMessage.bind(xpl, hue,
                      deviceAliases));
                });
              });
        });
commander.parse(process.argv);

process.on('uncaughtException', function(err) {
  console.error('Caught exception: ', err);
});

var errorCount = 0;

var lightsStates = {};

function sendFullState(xpl, hue, deviceAliases) {
  hue.listAccessories(function(error, list, states) {
    if (error) {
      console.error(error);

      errorCount++;
      if (errorCount > 10) {
        console.error("Two many error ! Stop process");
        process.exit(2);
        return;
      }

      setTimeout(sendFullState.bind(this, xpl, hue, deviceAliases), 300);
      return;
    }
    errorCount = 0;

    async.eachSeries(list, function(light, callback) {
      if (debugDevice.enabled) {
        debugDevice("light", light);
      }
      var device = light.device;
      var key = device.uniqueid;
      if (deviceAliases) {
        var dk = deviceAliases[key];
        if (dk) {
          key = dk;
        }
      }

      var state = device.state;
      var lightState = lightsStates[key];
      if (!lightState) {
        lightState = {
          id : device.id
        };
        lightsStates[key] = lightState;
      }

      var modifs = [];

      if (typeof (state.on) === "boolean") {
        if (lightState.on !== state.on) {
          lightState.on = state.on;

          modifs.push({
            device : key,
            type : "status",
            current : (state.on) ? "enable" : "disable"
          });
        }
      }

      if (typeof (state.reachable) === "boolean") {
        if (lightState.reachable !== state.reachable) {
          lightState.reachable = state.reachable;

          modifs.push({
            device : key,
            type : "reachable",
            current : (state.reachable) ? "enable" : "disable"
          });
        }
      }

      if (typeof (state.bri) === "number") {
        if (lightState.bri !== state.bri) {
          lightState.bri = state.bri;

          modifs.push({
            device : key,
            type : "brightness",
            current : state.bri
          });
        }
      }
      if (typeof (state.hue) === "number") {
        if (lightState.hue !== state.hue) {
          lightState.hue = state.hue;

          modifs.push({
            device : key,
            type : "hue",
            current : state.hue
          });
        }
      }
      if (typeof (state.sat) === "number") {
        if (lightState.sat !== state.sat) {
          lightState.sat = state.sat;

          modifs.push({
            device : key,
            type : "saturation",
            current : state.sat
          });
        }
      }

      if (!modifs.length) {
        return callback();
      }

      async.eachSeries(modifs, function(body, callback) {
        debug("Send modifs", modifs);

        xpl.sendXplStat(body, "sensor.basic", callback);
      }, callback);
    }, function(error) {
      if (error) {
        console.error(error);
      }

      setTimeout(sendFullState.bind(this, xpl, hue, deviceAliases), 1000);
    });
  });
}

function processXplMessage(hue, deviceAliases, message) {

  debug("Receive message", message);

  if (message.bodyName !== "delabarre.command" &&
      message.bodyName !== "x10.basic") {
    return;
  }

  var body = message.body;

  var command = body.command;
  var device = body.device;
  var current;

  switch (command) {
  // Xpl-delabarre
  case 'status':
    if (/(enable|enabled|on|1|true)/i.exec(body.current)) {
      command = "on";

    } else if (/(disable|disabled|off|0|false)/i.exec(body.current)) {
      command = "off";
    }
    break;

  // X10
  case 'all_units_off':
  case 'all_lights_off':
    command = "off";
    device = "all";
    break;

  case 'all_units_on':
  case 'all_lights_on':
    command = "on";
    device = "all";
    break;

  case 'bright':
    command = "brightness";
    if (command.data1) {
      current = parseInt(command.data1, 10) / 255 * 100;
    }
    break;
  }

  var targetKeys = {};
  if (device === "all") {
    for ( var l in lightsStates) {
      targetKeys[l.id] = true;
    }
  } else {
    device.split(',').forEach(function(tok) {
      tok = tok.trim();

      if (deviceAliases[tok]) {
        tok = deviceAliases[tok];
      }

      for ( var l in lightsStates) {
        if (l.uniqueid !== tok) {
          continue;
        }

        targetKeys[l.id] = true;
        break;
      }
    });
  }

  debug("Process command", command, "zones=", targetKeys);

  var lightState = HueAPI.lightState.create();

  switch (command) {
  case "off":
    debug("Request OFF lights=", targetKeys);
    lightState.off();
    break;

  case "on":
    debug("Request ON lights=", targetKeys);
    lightState.on();
    break;

  case "brightness":
    var brightness = undefined;
    if (typeof (current) === "string") {
      brightness = parseInt(current, 10);
    }
    debug("Request brightness: ", brightness, "zones=", targetKeys);
    lightState.bri(brightness);
    break;

  case "white":
    var white = undefined;
    if (typeof (current) === "string") {
      white = parseInt(current, 10);
    }
    debug("Request white: ", white, "lights=", targetKeys);
    lightState.white(500, white);
    break;

  case "hsb":
    var hue = undefined;
    if (typeof (body.hue) === "string") {
      hue = parseInt(body.hue, 10);
    }
    var saturation = undefined;
    if (typeof (body.saturation) === "string") {
      saturation = parseInt(body.saturation, 10);
    }
    var brightness = undefined;
    if (typeof (body.brightness) === "string") {
      value = parseInt(body.brightness, 10);
    }
    debug("Request hsb: hue=", hue, "saturation=", saturation, "brightness=",
        brightness, "lights=", targetKeys);
    lightState.hsb(hue, saturation, brightness);
    break;

  case "rgb":
    var red = parseInt(body.red, 10);
    var green = parseInt(body.green, 10);
    var blue = parseInt(body.blue, 10);

    debug("Request rgb255: red=", red, "green=", green, "blue=", blue,
        "zones=", zones);
    lightState.rgb(red, green, blue);
    break;

  default:

    console.error("Unsupported command '" + command + "'");
    return;
  }

  async.forEach(function changeLightState(id, callback) {
    debug("Set light", id, "state=", lightState);
    hue.setLightState(id, lightState, function(error) {

      if (error && error.code == "ECONNRESET") {
        setTimeout(function() {
          changeLightState(id, callback);
        }, 300);
        return;
      }

      callback(error);
    });
  }, function(error) {
    console.error(error);
  });

}

if (commander.headDump) {
  var heapdump = require("heapdump");
  console.log("***** HEAPDUMP enabled **************");
}
