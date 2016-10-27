/*jslint node: true, esversion: 6, sub: true, maxlen: 180 */
'use strict';

const Xpl = require("xpl-api");
const commander = require('commander');
const os = require('os');
const debug = require('debug')('xpl-hue:cli');
const debugDevice = require('debug')('xpl-hue:device');
const async = require('async');
const util = require('util');
const Semaphore = require('semaphore');

const Hue = require("./lib/hue");
const HueApi = require("node-hue-api");

const DEFAULT_HUE_USERNAME = "XPL-NodeJS";

const hueSemaphore = Semaphore(1);

commander.version(require("./package.json").version);
commander.option("--host <host>", "Hostname of hue bridge");
commander.option("--port <port>", "Port of hue bridge", parseInt);
commander.option("--username <username>", "Hue username");
commander.option("--hueTimeout <ms>", "Hue timeout", parseInt);
commander.option("--hueRetryTimeout <ms>", "Hue retry timeout", parseInt);
commander.option("--upnpTimeout <ms>", "UPNP timeout", parseInt);
commander.option("-a, --deviceAliases <aliases>", "Devices aliases");

commander.option("--heapDump", "Enable heap dump (require heapdump)");
commander.username = DEFAULT_HUE_USERNAME;

Xpl.fillCommander(commander);

commander.command('registerUser [username]').description("Create a user").action(function (username) {
	if (!username) {
		username = commander.username;
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

commander.command('listLights').action(() => {

	var hue = new Hue(commander);
	hue.getHueAddress((error, hueAddress) => {
		if (error) {
			return console.error(error);
		}

		var api = new HueApi.HueApi(hueAddress, hue.username, hue.hueTimeout, this.huePort, hue.scenePrefix);

		api.lights((error, list) => {
			if (error) {
				console.error("ERROR=", error);
				return;
			}

			console.log("list=", util.inspect(list, {depth: null}));
		});
	});
});

commander.command('listSensors').action(() => {

	var hue = new Hue(commander);
	hue.getHueAddress((error, hueAddress) => {
		if (error) {
			return console.error(error);
		}

		var api = new HueApi.HueApi(hueAddress, hue.username, hue.hueTimeout, this.huePort, hue.scenePrefix);

		api.sensors((error, list) => {
			if (error) {
				console.error("ERROR=", error);
				return;
			}

			console.log("list=", util.inspect(list, {depth: null}));
		});
	});
});

commander.command('listAccessories').action(() => {
	var hue = new Hue(commander);
	hue.getHueAddress((error, hueAddress) => {
		if (error) {
			return console.error(error);
		}

		var api = new HueApi.HueApi(hueAddress, hue.username, hue.hueTimeout, this.huePort, hue.scenePrefix);
		hue.listAccessories((error, list) => {
			if (error) {
				console.error("ERROR=", error);
				return;
			}

			console.log("list=", util.inspect(list, {depth: null}));
		});
	});
});

commander.command('run').description("Start processing Hue").action(() => {
	console.log("Start processing hue");

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

			syncState(xpl, hue, deviceAliases);

			xpl.on("xpl:xpl-cmnd", processXplMessage.bind(xpl, hue, deviceAliases));
		});
	});
});
commander.parse(process.argv);

var errorCount = 0;

var lightsStates = {};
var sensorsStates = {};

function sendLightsStates(list, xpl, deviceAliases, callback) {

	async.eachSeries(list, (light, callback) => {
		debugDevice("sendLightsStates", "test light=", light);
		let device = light.device;
		let key = device.uniqueid;
		if (deviceAliases) {
			var dk = deviceAliases[key];
			if (dk) {
				key = dk;

				if (key === "ignore") {
					callback();
					return;
				}
			}
		}

		let state = device.state;
		let lightState = lightsStates[key];
		if (!lightState) {
			lightState = {
				id: device.id
			};
			lightsStates[key] = lightState;
		}

		let modifs = [];

		let status = (typeof (state.on) === "boolean") && state.on && (typeof (state.reachable) === "boolean") && state.reachable;
		if (lightState.status !== status) {
			lightState.status = status;

			modifs.push({
				device: key,
				type: "status",
				current: (status) ? "enable" : "disable"
			});
		}

		if (typeof (state.on) === "boolean") {
			if (lightState.on !== state.on) {
				lightState.on = state.on;

				modifs.push({
					device: key,
					type: "on",
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
			debug("sendLightsStates", "Send modifs", modifs);

			xpl.sendXplStat(body, "sensor.basic", callback);
		}, callback);
	}, callback);
}

function sendSensorsStates(list, xpl, deviceAliases, callback) {

	async.eachSeries(list, (sensor, callback) => {

		debugDevice("sendSensorsStates", "test sensor=", sensor);
		let device = sensor.device;
		let key = device.uniqueid;
		if (deviceAliases) {
			var dk = deviceAliases[key];
			if (dk) {
				key = dk;
			}
			if (key === "ignore") {
				callback();
				return;
			}
		}

		if (!key) {
			return callback();
		}

		let state = device.state;
		let config = device.config;
		let sensorState = sensorsStates[key];
		if (!sensorState) {
			sensorState = {
				id: device.id
			};
			sensorsStates[key] = sensorState;
		}

		let modifs = [];

		if (typeof (state.lastupdated) === "string") {
			if (sensorState.lastupdated !== state.lastupdated) {
				sensorState.lastupdated = state.lastupdated;

				for (let k in state) {
					let v = state[k];
					if (typeof(v) === 'object' || v === undefined || k === "lastupdated") {
						continue;
					}

					sensorState[k] = v;

					let d = {
						device: key,
						type: k,
						current: v
					};

					if (state.lastupdated) {
						d.date = state.lastupdated;
					}

					modifs.push(d);
				}
			}
		} else {
			for (let k in state) {
				let v = state[k];
				if (typeof(v) === 'object') {
					continue;
				}

				if (sensorState[k] === v) {
					continue;
				}

				sensorState[k] = v;

				modifs.push({
					device: key,
					type: k,
					current: v
				});
			}
		}

		for (let k in config) {
			let v = config[k];

			if (typeof(v) === 'object' || v === undefined) {
				continue;
			}
			if (sensorState[k] === v) {
				continue;
			}

			sensorState[k] = v;

			modifs.push({
				device: key,
				type: k,
				current: v
			});
		}


		if (!modifs.length) {
			return callback();
		}

		async.eachSeries(modifs, (body, callback) => {
			debug("sendSensorsStates", "Send modifs", modifs);

			xpl.sendXplStat(body, "sensor.basic", callback);
		}, callback);

	}, callback);
}

function syncState(xpl, hue, deviceAliases) {
	hueSemaphore.take(() => {
		hue.listLights((error, list, states) => {
			if (error) {
				console.error("listLights: error=", error);

				errorCount++;
				if (errorCount > 10) {
					console.error("listLights: Two many error ! Stop process");
					process.exit(2);
					return;
				}

				hueSemaphore.leave();
				setTimeout(syncState.bind(this, xpl, hue, deviceAliases), commander.hueRetryTimeout || 300);
				return;
			}
			errorCount = 0;

			sendLightsStates(list, xpl, deviceAliases, (error) => {
				function callback(error) {
					if (error) {
						console.error("sendLightsStates: error=", error);
					}

					hueSemaphore.leave();
					setTimeout(syncState.bind(this, xpl, hue, deviceAliases), 500);
				}

				if (error) {
					return callback(error);
				}

				hue.listSensors((error, list, states) => {
					if (error) {
						return callback(error);
					}

					sendSensorsStates(list, xpl, deviceAliases, callback);
				});
			});
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
			if (body.data1) {
				current = parseInt(body.data1, 10) / 255 * 100;
			}
			break;
	}

	var targetKeys = {};
	if (device === "all") {
		for (var l in lightsStates) {
			targetKeys[l.id] = true;
		}
	} else {
		device.split(',').forEach((tok) => {
			tok = tok.trim();
			debug("processXplMessage", "Process tok=", tok);

			for (var l in lightsStates) {
				let v=lightsStates[l];

				if (l !== tok) {
					continue;
				}

				targetKeys[v.id] = true;
				break;
			}
		});
	}

	var lightState = HueApi.lightState.create();

	switch (command) {
		case "off":
			debug("processXplMessage", "Request OFF lights=", targetKeys);
			lightState.off();
			break;

		case "on":
			debug("processXplMessage", "Request ON lights=", targetKeys);
			lightState.on();
			break;

		case "brightness": {
			let brightness = undefined;
			if (typeof (current) === "string") {
				brightness = parseInt(current, 10);
			}
			debug("processXplMessage", "Request brightness: ", brightness, "zones=", targetKeys);
			lightState.bri(brightness);
			break;
		}

		case "white": {
			let white = undefined;
			if (typeof (current) === "string") {
				white = parseInt(current, 10);
			}

			let colorTemp = 500;
			if (typeof(body.colorTemp) === "string") {
				colorTemp = parseInt(body.colorTemp, 10);
				colorTemp = isNaN(colorTemp) ? 500 : Math.min(Math.max(colorTemp, 153), 500);
			}

			debug("processXplMessage", "Request white=", white, "colorTemp=", colorTemp, "lights=", targetKeys);
			lightState.white(colorTemp, white);
			break;
		}

		case "hsb": {
			let hue = undefined;
			if (typeof (body.hue) === "string") {
				hue = parseInt(body.hue, 10);
			}
			let saturation = undefined;
			if (typeof (body.saturation) === "string") {
				saturation = parseInt(body.saturation, 10);
			}
			let brightness = undefined;
			if (typeof (body.brightness) === "string") {
				brightness = parseInt(body.brightness, 10);
			}
			debug("processXplMessage", "Request hsb: hue=", hue, "saturation=", saturation, "brightness=", brightness, "lights=", targetKeys);
			lightState.hsb(hue, saturation, brightness);
			break;
		}

		case "rgb": {
			let red = parseInt(body.red, 10);
			let green = parseInt(body.green, 10);
			let blue = parseInt(body.blue, 10);

			debug("processXplMessage", "Request rgb255: red=", red, "green=", green, "blue=", blue, "zones=", zones);
			lightState.rgb(red, green, blue);
			break;
		}

		default:
			console.error("Unsupported command '" + command + "' for target=", targetKeys);
			return;
	}

	hueSemaphore.take(() => {
		async.forEachOfSeries(targetKeys, function changeLightState(item, id, callback) {
			debug("processXplMessage", "Set light", id, "state=", lightState);
			hue.setLightState(id, lightState, (error) => {
				if (error) {
					debug("processXplMessage", "setLightState error=", error);
				}

				if (error && error.code == "ECONNRESET") {
					console.error("ECONNRESET when setting lightSate id=", id, "to=", lightState);
					setTimeout(() => {
						changeLightState(item, id, callback);
					}, commander.hueRetryTimeout || 300);
					return;
				}

				callback(error);
			});
		}, (error) => {
			hueSemaphore.leave();

			if (error) {
				console.error(error);
			}
		});
	});
}

if (commander.headDump) {
	var heapdump = require("heapdump");
	console.log("***** HEAPDUMP enabled **************");
}
