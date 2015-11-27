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
