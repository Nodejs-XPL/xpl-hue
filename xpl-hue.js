/*jslint node: true, vars: true, nomen: true */
'use strict';

var Xpl = require("xpl-api");
var commander = require('commander');
var os = require('os');
var debug = require('debug')('xpl-hue:cli');

var Hue = require("./lib/hue");

commander.version(require("./package.json").version);
commander.option("--host <host>", "Hostname of hue bridge");
commander.option("--port <port>", "Port of hue bridge", parseInt);
commander.option("--username <username>", "Hue username");
commander.option("--hueTimeout <ms>", "Hue timeout", parseInt);
commander.option("--upnpTimeout <ms>", "UPNP timeout", parseInt);
commander.option("-a, --deviceAliases <aliases>", "Devices aliases");

commander.option("--heapDump", "Enable heap dump (require heapdump)");

Xpl.fillCommander(commander);

commander.command('registerUser <username>').description("Create a user")
    .action(
        function(username) {

          var hue = new Hue(commander);
          hue.registerUser(username || commander.username, function(error,
              username) {
            if (error) {
              console.error(error);
              return;
            }

            console.log("User '" + username + "' created !");
          });
        });

commander.command('run').description("Start processing Hue").action(
    function() {
      console.log("Start");

      var hue = new Hue(commander);

      hue.listAccessories(function(error, list) {
        if (error) {
          if (error.message === 'unauthorized user') {
            console.error("The user '" + commander.username +
                "' is not authorized");
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

        var deviceAliases = Xpl.loadDeviceAliases(commander.deviceAliases);

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

          sendFullState(xpl, hue);

          xpl.on("xpl:xpl-cmnd",
              function(message) {

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

                  } else if (/(disable|disabled|off|0|false)/i
                      .exec(body.current)) {
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

                debug("Process command", command, "zones=", zones);

                switch (command) {
                case "off":
                  debug("Request OFF zones=", targetKeys);
                  return;

                case "nightMode":
                  debug("Request nightMode zones=", zones);
                  return;

                case "on":
                  debug("Request ON zones=", targetKeys);
                  return;

                case "brightness":
                  var brightness = undefined;
                  if (typeof (current) === "string") {
                    brightness = parseInt(current, 10);
                  }
                  debug("Request brightness: ", brightness, "zones=", zones);
                  zones.brightness(brightness);
                  return;

                case "white":
                  var white = undefined;
                  if (typeof (current) === "string") {
                    white = parseInt(current, 10);
                  }
                  debug("Request white: ", white, "zones=", zones);
                  return;

                case "hsv":
                  var hue = undefined;
                  if (typeof (body.hue) === "string") {
                    hue = parseInt(body.hue, 10);
                  }
                  var value = undefined;
                  if (typeof (body.value) === "string") {
                    value = parseInt(body.value, 10);
                  }
                  debug("Request hsv: hue=", hue, "value=", value, "zones=",
                      zones);
                  return;

                case "rgb":
                  var red = parseInt(body.red, 10);
                  var green = parseInt(body.green, 10);
                  var blue = parseInt(body.blue, 10);

                  debug("Request rgb255: red=", red, "green=", green, "blue=",
                      blue, "zones=", zones);
                  return;
                }

                console.error("Unsupported command '" + command + "'");
              });
        });
      });
    });
commander.parse(process.argv);

process.on('uncaughtException', function(err) {
  console.error('Caught exception: ', err);
});

var errorCount = 0;

function sendFullState(xpl, hue) {
  hue.listAccessories(function(error, list, states) {
    if (error) {
      console.error(error);

      errorCount++;
      if (errorCount > 10) {
        console.error("Two many error ! Stop process");
        process.exit(2);
        return;
      }

      setTimeout(sendFullState.bind(this, xpl, hue), 300);
      return;
    }
    errorCount = 0;

    list.forEach(function(device) {
      debug("device", device.id, "=>", list[device.id]);
    });

    setTimeout(sendFullState.bind(this, xpl, hue), 1000);
  });
}

if (commander.headDump) {
  var heapdump = require("heapdump");
  console.log("***** HEAPDUMP enabled **************");
}
