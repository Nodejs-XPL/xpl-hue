/*jslint node: true, esversion: 6, sub: true, maxlen: 180 */
'use strict';

const hue = require("node-hue-api");
const debug = require('debug')('xpl-hue:accessory');

class PhilipsHueAccessory {
	constructor(api, device) {
		this.id = device.id;
		this.uniqueId = device.uniqueid || this.id;
		this.name = device.name;
		this.model = device.modelid;
		this.device = device;
		this.api = api;
	}

// Convert 0-65535 to 0-360
	hueToArcDegrees(value) {
		value = value / 65535;
		value = value * 360;
		value = Math.round(value);
		return value;
	}

// Convert 0-360 to 0-65535
	arcDegreesToHue(value) {
		value = value / 360;
		value = value * 65535;
		value = Math.round(value);
		return value;
	}

// Convert 0-255 to 0-100
	bitsToPercentage(value) {
		value = value / 255;
		value = value * 100;
		value = Math.round(value);
		return value;
	}
}
module.exports = PhilipsHueAccessory;
