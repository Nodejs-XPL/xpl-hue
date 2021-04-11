/*jslint node: true, esversion: 6, sub: true, maxlen: 180 */

const Xpl = require("xpl-api");
const commander = require('commander');
const os = require('os');
const debug = require('debug')('xpl-hue:cli');
const debugDevice = require('debug')('xpl-hue:device');
const util = require('util');
const Semaphore = require('semaphore-async-await').default;

const Hue = require("./lib/hue");
const v3 = require("node-hue-api").v3

const DEFAULT_HUE_USERNAME = "XPL-NodeJS";

const hueSemaphore = new Semaphore(1);

commander.version(require("./package.json").version);
commander.option("--host <host>", "Hostname of hue bridge");
commander.option("--port <port>", "Port of hue bridge", parseInt);
commander.option("--username <username>", "Hue username");
commander.option("--hueTimeout <ms>", "Hue timeout", parseInt);
commander.option("--hueRetryTimeout <ms>", "Hue retry timeout", parseInt);
commander.option("--upnpTimeout <ms>", "UPNP timeout", parseInt);
commander.option("-a, --deviceAliases <aliases>", "Devices aliases");
commander.option("--verifyUpdates", "Send only updates");

commander.option("--heapDump", "Enable heap dump (require heapdump)");
commander.username = DEFAULT_HUE_USERNAME;

Xpl.fillCommander(commander);

commander.command('registerUser [username]').description("Create a user").action(function (username) {
	if (!username) {
		username = DEFAULT_HUE_USERNAME;
	}


	const hue = new Hue(commander);
	hue.registerUser(username, function (error, username) {
		if (error) {
			console.error(error);
			return;
		}

		console.log("User '" + username + "' created !");
	});
});

commander.command('listLights').action(async () => {

	const hue = new Hue(commander);
	const hueAddress = await hue.getHueAddress();

	const api = await v3.api.createLocal(hueAddress).connect(hue.username); //, hue.hueTimeout, this.huePort, hue.scenePrefix);

	const list = await api.lights.getAll();

	console.log("list=", util.inspect(list, {depth: null}));
});

commander.command('listLightGroups').action(async () => {

	const hue = new Hue(commander);
	const hueAddress = await hue.getHueAddress();

	const api = await v3.api.createLocal(hueAddress).connect(hue.username); //, hue.hueTimeout, this.huePort, hue.scenePrefix);

	const list = await api.groups.getAll();

	console.log("groups=", list.map((g) => ({id: g.id, name: g.name, lights: g.lights})));
});

commander.command('listSensors').action(async () => {

	const hue = new Hue(commander);
	const hueAddress = await hue.getHueAddress();

	const api = await v3.api.createLocal(hueAddress).connect(hue.username); //, hue.hueTimeout, this.huePort, hue.scenePrefix);

	const list = await api.sensors.getAll();

	console.log("list=", list.map((g) => ({id: g.id, name: g.name, type: g.type})));
});


commander.command('run').description("Start processing Hue").action(async () => {
	console.log("Start processing hue");

	const hue = new Hue(commander);
	const hueAddress = await hue.getHueAddress();

	const api = await v3.api.createLocal(hueAddress).connect(hue.username); //, hue.hueTimeout, this.huePort, hue.scenePrefix);

	if (!commander.xplSource) {
		let hostName = os.hostname();
		if (hostName.indexOf('.') > 0) {
			hostName = hostName.substring(0, hostName.indexOf('.'));
		}

		commander.xplSource = "hue." + hostName;
	}

	const deviceAliases = Xpl.loadDeviceAliases(commander.deviceAliases);

	debug("Device aliases=", deviceAliases);

	const xpl = new Xpl(commander);

	xpl.on("error", (error) => {
		console.log("XPL error", error);
	});

	xpl.bind(async (error) => {
		if (error) {
			console.error("Can not open xpl bridge ", error);
			process.exit(2);
			return;
		}

		console.log("Xpl bind succeed ");
		// xpl.sendXplTrig(body, callback);

		const groups = await setupLightGroups(api);

		syncState(xpl, api, deviceAliases, groups).catch((error) => {
			console.error(error);
		})

		xpl.on("xpl:xpl-cmnd", processXplMessage.bind(xpl, api, deviceAliases));
	});
});
commander.parse(process.argv);

let errorCount = 0;

const lightsStates = {};
const sensorsStates = {};
const groupsStates = {};

async function sendLightsStates(list, xpl, deviceAliases, groups) {

	const modifs = [];
	list.forEach((light) => {
//		console.log('Send light state=', light);

		debugDevice("sendLightsStates", "test light=", light);
//		console.log("sendLightsStates", "test light=", light);
		let key = light.uniqueid;
		if (deviceAliases) {
			const dk = deviceAliases[key];
			if (dk) {
				key = dk;

				if (key === "ignore") {
					return;
				}
			}
		}

		let state = light.state;
		let lightState = lightsStates[key];
		if (!lightState) {
			lightState = {
				id: light.id
			};
			lightsStates[key] = lightState;
		}
//		console.log('light=', light.id, 'prev=', lightState, 'new=', state);

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

				console.log('change state=', state, 'key=', key);

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
					current: state.bri / 254 * 100
				});
			}
		}

		// http://rsmck.co.uk/hue
		if (typeof (state.hue) === "number") {
			if (lightState.hue !== state.hue) {
				lightState.hue = state.hue;

				modifs.push({
					device: key,
					type: "hue",
					current: state.hue / 65535 * 360
				});
			}
		}
		if (typeof (state.sat) === "number") {
			if (lightState.sat !== state.sat) {
				lightState.sat = state.sat;

				modifs.push({
					device: key,
					type: "saturation",
					current: state.sat / 254 * 100
				});
			}
		}
		if (typeof (state.ct) === "number") {
			if (lightState.ct !== state.ct) {
				lightState.ct = state.ct;

				modifs.push({
					device: key,
					type: "temperature",
					current: 1000000.0 / state.ct
				});
			}
		}

		if (Array.isArray(state.xy)) {
			const xy = state.xy.join(',');
			if (lightState.xy !== xy) {
				lightState.xy = xy;  // CIE 1931

				modifs.push({
					device: key,
					type: "xy",
					current: xy
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
		if (typeof (state.colormode) === "string") {
			if (lightState.colormode !== state.colormode) {
				lightState.colormode = state.colormode;

				modifs.push({
					device: key,
					type: "colormode",
					current: state.colormode
				});
			}
		}
	});

	if (!modifs.length) {
		return;
	}

	Object.keys(groups.lightsByGroupId).forEach((groupId) => {
		const group = groups.lightsByGroupId[groupId];
		if (!group.length) {
			return;
		}

		let groupKey = 'group@' + groupId;

		if (deviceAliases) {
			const dk = deviceAliases[groupKey];
			if (dk) {
				groupKey = dk;

				if (groupKey === "ignore") {
					return;
				}
			}
		}

		if (!groupsStates[groupKey]) {
			groupsStates[groupKey] = {
				id: groupId,
			}
		}

		const on = group.find((lightId) => {
			const light = list.find((l) => (l.id == lightId));
			if (!light) {
				console.error('Can not get light with id=', lightId);
				return;
			}

			let state = light.state;

			let status = (typeof (state.on) === "boolean") && state.on && (typeof (state.reachable) === "boolean") && state.reachable;

			return status;
		});

//		console.log('On of', groupKey, '=>', on, groupsStates[groupId]);

		if (groupsStates[groupKey].status !== on) {
			groupsStates[groupKey].status = on;

			modifs.push({
				device: groupKey,
				type: "status",
				current: (on) ? "enable" : "disable"
			});
		}
	});

	if (!modifs.length) {
		return;
	}

	console.log('modifs=', modifs);

	const ps = modifs.map((body) => (sendXplStat(xpl, body, "sensor.basic")));

	await Promise.all(ps);
}

async function sendXplStat(xpl, body, bodyName, target, source) {
	return new Promise((resolve, reject) => {
		xpl.sendXplStat(body, bodyName, target, source, (error) => {
			if (error) {
				reject(error);
				return;
			}

			resolve();
		});
	});
}


async function sendSensorsStates(list, xpl, deviceAliases) {


	const modifs = [];

	list.forEach((sensor) => {

		debugDevice("sendSensorsStates", "test sensor=", sensor);
		let key = sensor.uniqueid;
		if (deviceAliases) {
			const dk = deviceAliases[key];
			if (dk) {
				key = dk;
			}
			if (key === "ignore") {
				return;
			}
		}

		if (!key) {
			return;
		}

		let sensorState = sensorsStates[key];
		if (!sensorState) {
			sensorState = {
				id: sensor.id
			};
			sensorsStates[key] = sensorState;
		}

		if (typeof (sensor.lastupdated) === "string") {
			if (sensorState.lastupdated !== sensor.lastupdated) {
				sensorState.lastupdated = sensor.lastupdated;

				sensor.getStateAttributeNames().forEach((k) => {
					let v = sensor.getStateAttributeValue(k);

//					console.log('=>', k, '=>', v);

					if (typeof (v) === 'object' || v === undefined || k === "lastupdated") {
						return;
					}

					sensorState[k] = v;

					let units;

					if (k === 'battery') {
						units = '%';
					}
					if (k === 'temperature') {
						v /= 100;
						units = 'c';
					}

					let d = {
						device: key,
						type: k,
						current: v,
					};
					if (units) {
						d.units = units;
					}

					if (sensor.lastupdated) {
						d.date = sensor.lastupdated;
					}

					modifs.push(d);
				});
			}
		} else {
			sensor.getStateAttributeNames().forEach((k) => {
				let v = sensor.getStateAttribute(k);

				if (typeof (v) === 'object') {
					return;
				}

				if (sensorState[k] === v) {
					return;
				}

				sensorState[k] = v;

				let units;

				if (k === 'temperature') {
					v /= 100;
					units = 'c';
				}
				if (k === 'battery') {
					units = '%';
				}

				const d = {
					device: key,
					type: k,
					current: v,
				};
				if (units) {
					d.units = units;
				}
				modifs.push(d);
			});
		}

		let config = sensor.getConfig();
		for (let k in config) {
			let v = config[k];

			if (typeof (v) === 'object' || v === undefined) {
				continue;
			}
			if (sensorState[k] === v) {
				continue;
			}
			let units;
			if (k === 'temperature') {
				v /= 100;
				units = 'c';
			}
			if (k === 'battery') {
				units = '%';
			}

			sensorState[k] = v;

			const d = {
				device: key,
				type: k,
				current: v,
			};
			if (units) {
				d.units = units;
			}
			modifs.push(d);
		}
	});

	if (!modifs.length) {
		return;
	}

	console.log('modifs=', modifs);

	const ps = modifs.map(async (body) => {

		if (!commander.verifyUpdates) {
			return sendXplStat(xpl, body, "sensor.basic");
		}

		const result = await getLastFromDbClient(body.device);
		if (result.value === body.current) {
			return;
		}

		return sendXplStat(xpl, body, "sensor.basic");
	});

	await Promise.all(ps);
}

async function getLastFromDbClient(device) {
	return new Promise((resolve, reject) => {

		dbClient.getLast(device, (error, result) => {
			if (error) {
				reject(error);
				return;
			}

			resolve(result);
		});
	});
}

async function syncState(xpl, hue, deviceAliases, groups) {

	for (; ;) {
		await hueSemaphore.acquire();
		try {
			for (; ;) {
//				console.log('Try to sync lights');
				try {
					const lights = await hue.lights.getAll();

					await sendLightsStates(lights, xpl, deviceAliases, groups);
					errorCount = 0;
					break;

				} catch (error) {
					console.error('syncState.lights.getAll', error);

					errorCount++;
					if (errorCount > 10) {
						console.error("listLights: Two many error ! Stop process");
						process.exit(2);
						return;
					}

					await promiseTimeout(commander.hueRetryTimeout || 300);
				}
			}

			for (; ;) {
//				console.log('Try to sync sensors');

				try {
					const sensors = await hue.sensors.getAll();
					await sendSensorsStates(sensors, xpl, deviceAliases, groups);
					errorCount = 0;
					break;

				} catch (error) {
					console.error('syncState.sensors.getAll', error);

					errorCount++;
					if (errorCount > 10) {
						console.error("listLights: Two many error ! Stop process");
						process.exit(2);
						return;
					}

					await promiseTimeout(commander.hueRetryTimeout || 300);
				}
			}
		} finally {
			hueSemaphore.release();
		}

		await promiseTimeout(500);
	}
}

function promiseTimeout(delayms) {
	return new Promise(function (resolve, reject) {
		setTimeout(resolve, delayms);
	});
}

async function processXplMessage(hue, deviceAliases, message) {

	debug("processXplMessage", "Receive message", message);

	if (message.bodyName !== "delabarre.command" &&
		message.bodyName !== "x10.basic") {
		return;
	}

	const body = message.body;

	let command = body.command;
	let device = body.device;
	let current = body.current;

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

	const targetKeys = {};
	const targetGroupKeys = {};
	if (device === "all") {
		for (var l in lightsStates) {
			targetKeys[l.id] = true;
		}
	} else {
		device.split(',').forEach((tok) => {
			tok = tok.trim();
			debug("processXplMessage", "Process tok=", tok);

			const v = lightsStates[tok];
			if (v) {
				targetKeys[v.id] = true;
			}

			const g = groupsStates[tok];
			if (g) {
				targetGroupKeys[g.id] = true;
			}
		});
	}

	if (!Object.keys(targetKeys).length && !Object.keys(targetGroupKeys).length) {
		return;
	}

	console.log("processXplMessage", "Receive message", message, 'command=', command, 'device=', device, "current=", current);


	const lightState = new v3.lightStates.LightState();

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
			if (typeof (body.colorTemp) === "string") {
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

	await hueSemaphore.acquire();
	try {
		const ps = [];

		ps.push(...Object.keys(targetKeys).map(async (id) => {
			for (; ;) {
				try {
					await hue.lights.setLightState(id, lightState);
					errorCount = 0;
					break;

				} catch (error) {
					errorCount++;
					if (errorCount > 10) {
						throw error;
					}

					await promiseTimeout(commander.hueRetryTimeout || 300);
				}
			}
		}));

		ps.push(...Object.keys(targetGroupKeys).map(async (id) => {
			for (; ;) {
				try {
					await hue.groups.setGroupState(id, lightState);
					errorCount = 0;
					break;

				} catch (error) {
					errorCount++;
					if (errorCount > 10) {
						throw error;
					}

					await promiseTimeout(commander.hueRetryTimeout || 300);
				}
			}
		}));

		await Promise.all(ps);

	} finally {
		hueSemaphore.release();
	}
}

async function setupLightGroups(hue) {

	const list = await hue.groups.getAll();

	const groupsByLightId = {};
	const lightsByGroupId = {};

	list.forEach((group) => {
		lightsByGroupId[group.id] = group.lights;

		group.lights.forEach((light) => {
			let g = groupsByLightId[light];
			if (!g) {
				g = [];
				groupsByLightId[light] = g;
			}
			g.push(String(group.id));
		})
	});


	const ret = {
		groupsByLightId,
		lightsByGroupId,
	}

	console.log('MAPPING=', ret);

	return ret;
}
