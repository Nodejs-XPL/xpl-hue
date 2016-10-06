/*jslint node: true, esversion: 6, sub: true, maxlen: 180 */
'use strict';

const debug = require('debug')('xpl-hue');
const hue = require("node-hue-api");
const util = require('util');

const Accessory = require('./accessory');

class Hue {
	constructor(configuration) {
		this.configuration = configuration || {};

		this.hueAddress = configuration.host;
		this.huePort = configuration.port;
		this.username = configuration.username || "XPL-NodeJS";
		this.hueTimeout = configuration.hueTimeout;
		this.scenePrefix = configuration.scenePrefix;
		this.upnpTimeout = configuration.upnpTimeout || 1000 * 60;
	}

	listAccessories(callback) {
		debug("listAccessories", "Fetching Philips Hue lights...");

		if (!this.username) {
			return callback(new Error("An user must be specified !"));
		}

		this.getHueAddress((error, hueAddress) => {
			debug("listAccessories", "getHueAddress=", hueAddress, "error=", error);
			if (error) {
				return callback(error);
			}


			var api = new hue.HueApi(hueAddress, this.username, this.hueTimeout, this.huePort, this.scenePrefix);

			api.lights((error, response) => {
				if (debug.enabled) {
					debug("listAccessories", "response=", util.inspect(response, {depth: null}), "error=", error);
				}

				callback(error, response);
			});
		});
	}

	listLights(callback) {
		debug("listLights", "Fetching Philips Hue lights...");

		if (!this.username) {
			return callback(new Error("An user must be specified !"));
		}

		this.getHueAddress((error, hueAddress) => {
			debug("listLights", "getHueAddress=", hueAddress, "error=", error);
			if (error) {
				return callback(error);
			}

			var api = new hue.HueApi(hueAddress, this.username, this.hueTimeout, this.huePort, this.scenePrefix);

			try {
				api.lights((error, response) => {
					if (debug.enabled) {
						debug("listLights", "response=", util.inspect(response, {depth: null}), "error=", error);
					}

					if (error) {
						return callback(error);
					}

					var foundAccessories = [];
					var states = {};
					for (var deviceId in response.lights) {
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
	}

	listSensors(callback) {
		debug("listSensors", "Fetching Philips Hue sensors...");

		if (!this.username) {
			return callback(new Error("An user must be specified !"));
		}

		this.getHueAddress((error, hueAddress) => {
			debug("listSensors", "getHueAddress=", hueAddress, "error=", error);
			if (error) {
				return callback(error);
			}

			var api = new hue.HueApi(hueAddress, this.username, this.hueTimeout, this.huePort, this.scenePrefix);

			try {
				api.sensors((error, response) => {
					if (debug.enabled) {
						debug("listSensors", "response=", util.inspect(response, {depth: null}), "error=", error);
					}

					if (error) {
						return callback(error);
					}

					var foundAccessories = [];
					var states = {};
					for (var deviceId in response.sensors) {
						var device = response.sensors[deviceId];
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
	}

	setLightState(id, lightState, callback) {

		this.getHueAddress((error, hueAddress) => {
			if (error) {
				return callback(error);
			}

			var api = new hue.HueApi(hueAddress, this.username, this.hueTimeout,
				this.huePort, this.scenePrefix);

			try {
				api.setLightState(id, lightState, callback);

			} catch (x) {
				console.error("setLightState error=", x);
				callback(x);
			}
		});
	}

	registerUser(username, callback) {

		this.getHueAddress((error, hueAddress) => {
			debug("registerUser", "getHueAddress=", hueAddress, "error=", error);
			if (error) {
				return callback(error);
			}

			var api = new hue.HueApi(hueAddress, null, this.hueTimeout,
				this.huePort, this.scenePrefix);
			try {
				api.registerUser(
					hueAddress,
					username || "XPL-NodeJS",
					"XPL nodejs user",
					(error, user) => {
						debug("registerUser", "Create user=", user, "error=", error);

						// try and help explain this particular error
						if (error && error.message == "link button not pressed") {
							// debug("Please press the link button on your Philips Hue bridge, then start the HomeBridge server within
							// 30
							// seconds.");
						}

						if (error) {
							return callback(error);
						}

						debug("registerUser", "Created a new username", JSON.stringify(user), "for your Philips Hue. Please add it to your config.json then start the HomeBridge server again: ");

						callback(null, user);
					});
			} catch (x) {
				callback(x);
			}
		});
	}

// Get the ip address of the first available bridge with meethue.com or a network scan.
	getHueAddress(callback) {

		if (this.hueAddress) {
			return callback(null, this.hueAddress);
		}

		// Report the results of the scan to the user
		var getIp = (bridges) => {
			if (!bridges || !bridges.length) {
				debug("getHueAddress", "No Philips Hue bridges found.");
				callback(new Error("No bridges found"));
				return;
			}

			if (bridges.length > 1) {
				console.log("Warning: Multiple Philips Hue bridges detected. The first bridge will be used automatically. To use a different bridge, set the `ip_address` manually in the configuration.");
			}

			if (debug.enabled) {
				debug("getHueAddress", "Philips Hue bridges found :");
				bridges.forEach((bridge) => {
					// Bridge name is only returned from meethue.com so use id instead if it isn't there
					debug("  ", bridge);
				});
			}

			this.hueAddress = bridges[0].ipaddress;

			callback(null, this.hueAddress);
		};

		var found = false;

		// Try to discover the bridge ip using meethue.com
		debug("Attempting to discover Philips Hue bridge with meethue.com...");
		hue.nupnpSearch((error, bridges) => {
			if (found) {
				return;
			}
			if (!error) {
				found = true;
				return getIp(bridges);
			}

			debug("getHueAddress", "Philips Hue bridge discovery with meethue.com failed. Register your bridge with the meethue.com for more reliable discovery.",
				error);

			debug("getHueAddress", "Attempting to discover Philips Hue bridge with network scan...");

			// Timeout after one minute
			hue.upnpSearch(this.upnpTimeout).then((bridges) => {
				if (found) {
					return;
				}

				found = true;
				debug("getHueAddress", "Scan completed");
				getIp(bridges);

			}).fail((error) => {
				if (found) {
					return;
				}

				found = true;
				debug("getHueAddress", "Philips Hue bridge discovery with network scan failed. Check your network connection or set ip_address manually in configuration.");
				callback(new Error("Scan failed: " + error.message));
			}).done();
		});
	}
}

module
	.exports = Hue;
