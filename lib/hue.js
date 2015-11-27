/*jslint node: true, vars: true, nomen: true */
'use strict';

var debug = require('debug')('xpl-hue');
var hue = require("node-hue-api");

var Accessory = require('./accessory');

function Hue(configuration) {
  this.configuration = configuration || {};

  this.hueAddress = configuration.host;
  this.huePort = configuration.port;
  this.username = configuration.username || "XPL-NodeJS";
  this.hueTimeout = configuration.hueTimeout;
  this.scenePrefix = configuration.scenePrefix;
  this.upnpTimeout = configuration.upnpTimeout || 1000 * 60;
}

module.exports = Hue;

Hue.prototype.listAccessories = function(callback) {
  debug("Fetching Philips Hue lights...");

  var self = this;

  if (!this.username) {
    return callback(new Error("An user must be specified !"));
  }

  this.getHueAddress(function(error, hueAddress) {
    debug("getHueAddress=", hueAddress, "error=", error);
    if (error) {
      return callback(error);
    }

    var api = new hue.HueApi(hueAddress, self.username, self.hueTimeout,
        self.huePort, self.scenePrefix);

    try {
      api.getFullState(function(error, response) {
        debug("fullState=", response, "error=", error);
        if (error) {
          return callback(error);
        }

        var foundAccessories = [];
        var states = {};
        for ( var deviceId in response.lights) {
          var device = response.lights[deviceId];
          device.id = deviceId;
          var accessory = new Accessory(api, device);
          foundAccessories.push(accessory);

          states[deviceId] = device.state;
        }

        callback(null, foundAccessories, states);
      });
    } catch (x) {
      return callback(x);
    }
  });
};

Hue.prototype.registerUser = function(username, callback) {

  var self = this;

  this
      .getHueAddress(function(error, hueAddress) {
        debug("getHueAddress=", hueAddress, "error=", error);
        if (error) {
          return callback(error);
        }

        var api = new hue.HueApi(hueAddress, null, self.hueTimeout,
            self.huePort, self.scenePrefix);
        try {
          api
              .registerUser(
                  hueAddress,
                  username || "XPL-NodeJS",
                  "XPL nodejs user",
                  function(error, user) {
                    debug("Create user=", user, "error=", error);

                    // try and help explain this particular error
                    if (error && error.message == "link button not pressed") {
                      // debug("Please press the link button on your Philips Hue bridge, then start the HomeBridge server within
                      // 30
                      // seconds.");
                    }

                    if (error) {
                      return callback(error);
                    }

                    debug(
                        "Created a new username ",
                        JSON.stringify(user),
                        " for your Philips Hue. Please add it to your config.json then start the HomeBridge server again: ");

                    callback(null, user);
                  });
        } catch (x) {
          callback(x);
        }
      });
};

// Get the ip address of the first available bridge with meethue.com or a network scan.
Hue.prototype.getHueAddress = function getHueAddress(callback) {

  if (this.hueAddress) {
    return callback(null, this.hueAddress);
  }

  var self = this;

  // Report the results of the scan to the user
  var getIp = function(bridges) {
    if (!bridges || !bridges.length) {
      debug("No Philips Hue bridges found.");
      callback(new Error("No bridges found"));
      return;
    }

    if (bridges.length > 1) {
      console
          .log("Warning: Multiple Philips Hue bridges detected. The first bridge will be used automatically. To use a different bridge, set the `ip_address` manually in the configuration.");
    }

    if (debug.enabled) {
      debug("Philips Hue bridges found :");
      bridges.forEach(function(bridge) {
        // Bridge name is only returned from meethue.com so use id instead if it isn't there
        debug("  ", bridge);
      });
    }

    self.hueAddress = bridges[0].ipaddress;

    callback(null, self.hueAddress);
  };

  var found = false;

  // Try to discover the bridge ip using meethue.com
  debug("Attempting to discover Philips Hue bridge with meethue.com...");
  hue
      .nupnpSearch(function(error, bridges) {
        if (found) {
          return;
        }
        if (!error) {
          found = true;
          return getIp(bridges);
        }

        debug(
            "Philips Hue bridge discovery with meethue.com failed. Register your bridge with the meethue.com for more reliable discovery.",
            error);

        debug("Attempting to discover Philips Hue bridge with network scan...");

        // Timeout after one minute
        hue
            .upnpSearch(self.upnpTimeout)
            .then(function(bridges) {
              if (found) {
                return;
              }

              found = true;
              debug("Scan complete");
              getIp(bridges);
            })
            .fail(
                function(error) {
                  if (found) {
                    return;
                  }

                  found = true;
                  debug("Philips Hue bridge discovery with network scan failed. Check your network connection or set ip_address manually in configuration.");
                  callback(new Error("Scan failed: " + error.message));
                }).done();
      });
};