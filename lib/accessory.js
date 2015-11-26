/*jslint node: true, vars: true, nomen: true */
'use strict';

var hue = require("node-hue-api");
var debug = require('debug')('xpl-hue:accessory');

function PhilipsHueAccessory(api, device) {
  this.id = device.id;
  this.name = device.name;
  this.model = device.modelid;
  this.device = device;
  this.api = api;
}

module.exports = PhilipsHueAccessory;

// Convert 0-65535 to 0-360
PhilipsHueAccessory.prototype.hueToArcDegrees = function(value) {
  value = value / 65535;
  value = value * 360;
  value = Math.round(value);
  return value;
};
// Convert 0-360 to 0-65535
PhilipsHueAccessory.prototype.arcDegreesToHue = function(value) {
  value = value / 360;
  value = value * 65535;
  value = Math.round(value);
  return value;
};
// Convert 0-255 to 0-100
PhilipsHueAccessory.prototype.bitsToPercentage = function(value) {
  value = value / 255;
  value = value * 100;
  value = Math.round(value);
  return value;
};
PhilipsHueAccessory.prototype._extractValue = function(characteristic, status) {
  switch (characteristic.toLowerCase()) {
  case 'power':
    return status.state.reachable && status.state.on ? 1 : 0;
  case 'hue':
    return this.hueToArcDegrees(status.state.hue);
  case 'brightness':
    return this.bitsToPercentage(status.state.bri);
  case 'saturation':
    return this.bitsToPercentage(status.state.sat);
  default:
    return null;
  }
};
// Create and set a light state
PhilipsHueAccessory.prototype.setState = function(characteristic, value,
    callback) {
  var state = hue.lightState.create();
  switch (characteristic.toLowerCase()) {
  case 'power':
    if (value) {
      state.on();
    } else {
      state.off();
    }
    break;
  case 'hue':
    state.hue(this.arcDegreesToHue(value));
    break;
  case 'brightness':
    state.brightness(value);
    break;
  case 'saturation':
    state.saturation(value);
    break;
  }

  var self = this;
  this.api.setLightState(this.id, state, function(error, lights) {
    if (error) {
      debug("setLightState error=", error);

      if (error.code == "ECONNRESET") {
        setTimeout(function() {
          self.executeChange(characteristic, value, callback);
        }, 300);
        return;
      }

      return callback(error);
    }

    debug("Set " + this.device.name + ", characteristic: " + characteristic +
        ", value: " + value + ".");

    return callback(null);
  });
};

PhilipsHueAccessory.prototype.getState = function(characteristic, callback) {

  var self = this;
  this.api.lightStatus(this.id, function(err, status) {
    if (err) {
      debug("getState error", err);

      if (err.code == "ECONNRESET") {
        setTimeout(function() {
          self.getState(characteristic, callback);
        }, 300);
        return;
      }

      return callback(err);
    }

    var newValue = self._extractValue(characteristic, status);

    callback(null, newValue);
  });
};
