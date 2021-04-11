const debug = require('debug')('xpl-hue');
const v3 = require("node-hue-api").v3;

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
					(error, user) => {
						debug("registerUser", "Create user=", username, "error=", error);

						// try and help explain this particular error
						if (error && error.message == "link button not pressed") {
							debug("Please press the link button on your Philips Hue bridge, then start the HomeBridge server within 30 seconds.");
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
	async getHueAddress(callback) {

		if (this.hueAddress) {
			return callback(null, this.hueAddress);
		}

		// Report the results of the scan to the user
		const getIp = (bridges) => {
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

			return this.hueAddress;
		};

		// Try to discover the bridge ip using meethue.com
		debug("Attempting to discover Philips Hue bridge with meethue.com...");
		try {
			const bridges = await v3.discovery.nupnpSearch();
			if (bridges && bridges.length) {
				return getIp(bridges);
			}
		} catch (error) {
			debug("getHueAddress", "Philips Hue bridge discovery with meethue.com failed. Register your bridge with the meethue.com for more reliable discovery.", error);
		}

		debug("getHueAddress", "Attempting to discover Philips Hue bridge with network scan...");

		try {
			// Timeout after one minute
			const bridges = await v3.discovery.upnpSearch(this.upnpTimeout);
			debug("getHueAddress", "Scan completed");
			if (bridges && bridges.length) {
				return getIp(bridges);
			}

		} catch (error) {
			console.error(error);
		}

		throw new Error('Can not get bridge');
	}
}

module
	.exports = Hue;
