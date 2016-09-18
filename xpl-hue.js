/*jslint node: true, esversion: 6, sub: true, maxlen: 180 */
'use strict';

const Xpl = require("xpl-api");
const commander = require('commander');
const os = require('os');
const debug = require('debug')('xpl-hue:cli');
const debugDevice = require('debug')('xpl-hue:device');
const async = require('async');

const Hue = require("./lib/hue");
const HueAPI = require("node-hue-api");

const DEFAULT_HUE_USERNAME = "XPL-NodeJS";

commander.version(require("./package.json").version);
commander.option("--host <host>", "Hostname of hue bridge");
commander.option("--port <port>", "Port of hue bridge", parseInt);
commander.option("--username <username>", "Hue username");
commander.option("--hueTimeout <ms>", "Hue timeout", parseInt);
commander.option("--hueRetryTimeout <ms>", "Hue retry timeout", parseInt);
commander.option("--upnpTimeout <ms>", "UPNP timeout", parseInt);
commander.option("-a, --deviceAliases <aliases>", "Devices aliases");

commander.option("--heapDump", "Enable heap dump (require heapdump)");

Xpl.fillCommander(commander);

commander.command('registerUser [username]').description("Create a user")
	.action(function (username) {
		if (!username) {
			username = commander.username;
		}

		if (!username) {
			username = DEFAULT_HUE_USERNAME;
		}

		var hue = new Hue(commander);
		hue.registerUser(username, function (error, username) {
			if (error) {
				console.error(error);
				return;
			}

			console.log("User '" + username + "' created !");
		});
	});

commander.command('run').description("Start processing Hue").action(() => {
	console.log("Start");

	if (!commander.username) {
		commander.username = DEFAULT_HUE_USERNAME;
	}

	var hue = new Hue(commander);

	hue.listAccessories((error, list) => {
		if (error) {
			if (error.message === 'unauthorized user') {
				console.error("The user '" + commander.username + "' is not authorized");
				console.error("Push the bridge BUTTON, and launch : node xpl-hue.js registerUser '" + commander.username + "'");
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

		xpl.on("error", (error) => {
			console.log("XPL error", error);
		});

		xpl.bind((error) => {
			if (error) {
				console.log("Can not open xpl bridge ", error);
				process.exit(2);
				return;
			}

			console.log("Xpl bind succeed ");
			// xpl.sendXplTrig(body, callback);

			sendFullState(xpl, hue, deviceAliases);

			xpl.on("xpl:xpl-cmnd", processXplMessage.bind(xpl, hue, deviceAliases));
		});
	});
});
commander.parse(process.argv);

var errorCount = 0;

var lightsStates = {};

function sendFullState(xpl, hue, deviceAliases) {
	hue.listAccessories((error, list, states) => {
		if (error) {
			console.error(error);

			errorCount++;
			if (errorCount > 10) {
				console.error("Two many error ! Stop process");
				process.exit(2);
				return;
			}

			setTimeout(sendFullState.bind(this, xpl, hue, deviceAliases),
				commander.hueRetryTimeout || 300);
			return;
		}
		errorCount = 0;

		async.eachSeries(list, (light, callback) => {
			debugDevice("sendFullState", "light=", light);
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
					id: device.id
				};
				lightsStates[key] = lightState;
			}

			var modifs = [];

			if (typeof (state.on) === "boolean") {
				if (lightState.on !== state.on) {
					lightState.on = state.on;

					modifs.push({
						device: key,
						type: "status",
						current: (state.on) ? "enable" : "disable"
					});
				}
			}

			if (typeof (state.reachable) === "boolean") {
				if (lightState.reachable !== state.reachable) {
					lightState.reachable = state.reachable;

					modifs.push({
						device: key,
						type: "reachable",
						current: (state.reachable) ? "enable" : "disable"
					});
				}
			}

			if (typeof (state.bri) === "number") {
				if (lightState.bri !== state.bri) {
					lightState.bri = state.bri;

					modifs.push({
						device: key,
						type: "brightness",
						current: state.bri
					});
				}
			}
			if (typeof (state.hue) === "number") {
				if (lightState.hue !== state.hue) {
					lightState.hue = state.hue;

					modifs.push({
						device: key,
						type: "hue",
						current: state.hue
					});
				}
			}
			if (typeof (state.sat) === "number") {
				if (lightState.sat !== state.sat) {
					lightState.sat = state.sat;

					modifs.push({
						device: key,
						type: "saturation",
						current: state.sat
					});
				}
			}
			if (typeof (state.alert) === "string") {
				if (lightState.alert !== state.alert) {
					lightState.alert = state.alert;

					modifs.push({
						device: key,
						type: "alert",
						current: state.alert
					});
				}
			}
			if (typeof (state.effect) === "string") {
				if (lightState.effect !== state.effect) {
					lightState.effect = state.effect;

					modifs.push({
						device: key,
						type: "effect",
						current: state.effect
					});
				}
			}

			if (!modifs.length) {
				return callback();
			}

			async.eachSeries(modifs, (body, callback) => {
				debug("sendFullState", "Send modifs", modifs);

				xpl.sendXplStat(body, "sensor.basic", callback);
			}, callback);

		}, (error) => {
			if (error) {
				console.error(error);
			}

			setTimeout(sendFullState.bind(this, xpl, hue, deviceAliases), 1000);
		});
	});
}

function processXplMessage(hue, deviceAliases, message) {

	debug("processXplMessage", "Receive message", message);

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
		for (var l in lightsStates) {
			targetKeys[l.id] = true;
		}
	} else {
		device.split(',').forEach(function (tok) {
			tok = tok.trim();
			debug("Process tok=", tok);

			for (var l in lightsStates) {
				if (l !== tok) {
					continue;
				}

				targetKeys[lightsStates[l].id] = true;
				break;
			}
		});
	}

	var lightState = HueAPI.lightState.create();

	switch (command) {
		case "off":
			debug("processXplMessage", "Request OFF lights=", targetKeys);
			lightState.off();
			break;

		case "on":
			debug("processXplMessage", "Request ON lights=", targetKeys);
			lightState.on();
			break;

		case "brightness":
			var brightness = undefined;
			if (typeof (current) === "string") {
				brightness = parseInt(current, 10);
			}
			debug("processXplMessage", "Request brightness: ", brightness, "zones=", targetKeys);
			lightState.bri(brightness);
			break;

		case "white":
			var white = undefined;
			if (typeof (current) === "string") {
				white = parseInt(current, 10);
			}
			debug("processXplMessage", "Request white: ", white, "lights=", targetKeys);
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
				brightness = parseInt(body.brightness, 10);
			}
			debug("Request hsb: hue=", hue, "saturation=", saturation, "brightness=",
				brightness, "lights=", targetKeys);
			lightState.hsb(hue, saturation, brightness);
			break;

		case "rgb":
			var red = parseInt(body.red, 10);
			var green = parseInt(body.green, 10);
			var blue = parseInt(body.blue, 10);

			debug("processXplMessage", "Request rgb255: red=", red, "green=", green, "blue=", blue,
				"zones=", zones);
			lightState.rgb(red, green, blue);
			break;

		default:
			console.error("Unsupported command '" + command + "' for tarket=", targetKeys);
			return;
	}

	async.forEachOf(targetKeys, function changeLightState(item, id, callback) {
		debug("processXplMessage", "Set light", id, "state=", lightState);
		hue.setLightState(id, lightState, (error) => {
			if (error && error.code == "ECONNRESET") {
				setTimeout(() => {
					changeLightState(item, id, callback);
				}, commander.hueRetryTimeout || 300);
				return;
			}

			callback(error);
		});
	}, (error) => {
		if (error) {
			console.error(error);
		}
	});

}

if (commander.headDump) {
	var heapdump = require("heapdump");
	console.log("***** HEAPDUMP enabled **************");
}
