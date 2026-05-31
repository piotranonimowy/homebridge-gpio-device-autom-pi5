'use strict';

/*
 * gpio-pi5.js
 *
 * A minimal, onoff-compatible GPIO shim built on top of `node-libgpiod`
 * (libgpiod v1 character-device API). It exists so that
 * homebridge-gpio-device-autom can run on a Raspberry Pi 5 under
 * Ubuntu 24.04 LTS, where the legacy sysfs interface used by `onoff`
 * (/sys/class/gpio) no longer exists. On the Pi 5 the 40-pin header is
 * driven by the RP1 controller and exposed exclusively through the
 * character device /dev/gpiochipN.
 *
 * Compatibility surface (only what index.js actually uses via its own
 * `gpio` wrapper):
 *   new Gpio(pin, direction[, edge][, options])
 *       direction: 'in' | 'out' | 'high' | 'low'
 *       edge     : 'none' | 'rising' | 'falling' | 'both'   (input only)
 *       options  : { debounceTimeout, activeLow, reconfigureDirection }
 *   .watch(callback)     callback(err, value)
 *   .unwatch()
 *   .readSync()  -> 0 | 1
 *   .writeSync(value)
 *   .unexport()
 *   Gpio.HIGH (1), Gpio.LOW (0)
 *
 * Pin numbering: BCM, identical to onoff. On Ubuntu 24.04 / Pi 5 the
 * user header is gpiochip0 and line offset == BCM number, so the pin is
 * passed straight through as the line offset. The chip can be overridden
 * with the GPIO_CHIP environment variable for kernels/distros that still
 * expose the header as a different chip (e.g. gpiochip4 on some early
 * Pi 5 firmware).
 */

const libgpiod = require('node-libgpiod');
const { Chip } = libgpiod;

const HIGH = 1;
const LOW = 0;

// Edge constants (onoff-compatible string values).
const EDGE_NONE = 'none';
const EDGE_RISING = 'rising';
const EDGE_FALLING = 'falling';
const EDGE_BOTH = 'both';

// Default chip: gpiochip0 on Ubuntu 24.04 / Pi 5 (RP1 user header).
// Override with GPIO_CHIP=4 if your kernel exposes the header elsewhere.
const DEFAULT_CHIP = (() => {
	const env = process.env.GPIO_CHIP;
	if (env === undefined || env === '') return 0;
	const n = Number(env);
	return Number.isInteger(n) ? n : env; // node-libgpiod accepts number or name
})();

const CONSUMER = 'homebridge-gpio-device';

// Cache one Chip handle per chip id; libgpiod lets each line be requested
// independently, and sharing the chip avoids re-opening the device per pin.
const chipCache = new Map();
function getChip(chipId) {
	if (!chipCache.has(chipId)) {
		chipCache.set(chipId, new Chip(chipId));
	}
	return chipCache.get(chipId);
}

class Gpio {
	/**
	 * @param {number} pin        BCM GPIO number (== line offset on gpiochip0)
	 * @param {string} direction  'in' | 'out' | 'high' | 'low'
	 * @param {string} [edge]     'none' | 'rising' | 'falling' | 'both'
	 * @param {object} [options]  { debounceTimeout, activeLow }
	 */
	constructor(pin, direction, edge, options) {
		if (typeof edge === 'object' && edge !== null && options === undefined) {
			options = edge;
			edge = undefined;
		}
		this.pin = pin;
		this.direction = direction;
		this.edge = edge || EDGE_NONE;
		this.options = options || {};
		this.chipId = this.options.chip !== undefined ? this.options.chip : DEFAULT_CHIP;

		this._chip = getChip(this.chipId);
		this._line = this._chip.getLine(pin);
		this._watchTimer = null;
		this._lastValue = null;
		this._released = false;

		this._request();
	}

	_request() {
		const dir = this.direction;
		if (dir === 'in') {
			// Plain input request; edge handling is done by polling getValue().
			// (node-libgpiod 0.6.0 does not expose non-blocking edge callbacks.)
			this._line.requestInputMode(CONSUMER);
		} else if (dir === 'out') {
			this._line.requestOutputMode(CONSUMER, LOW);
		} else if (dir === 'high') {
			this._line.requestOutputMode(CONSUMER, HIGH);
		} else if (dir === 'low') {
			this._line.requestOutputMode(CONSUMER, LOW);
		} else {
			throw new Error('gpio-pi5: unsupported direction "' + dir + '"');
		}
	}

	readSync() {
		const v = this._line.getValue();
		return v ? HIGH : LOW;
	}

	writeSync(value) {
		this._line.setValue(value ? HIGH : LOW);
		return this;
	}

	/**
	 * Emulates onoff's interrupt-driven watch() with non-blocking polling.
	 * The poll interval equals the debounce window (default 10 ms), which
	 * matches the { debounceTimeout: 10 } the plugin passes for inputs and
	 * naturally rejects bounces shorter than one sample. Callback follows
	 * the onoff contract: callback(err, value).
	 */
	watch(callback) {
		if (this.direction !== 'in') {
			throw new Error('gpio-pi5: watch() is only valid on input lines');
		}
		const pollMs = Math.max(1, Number(this.options.debounceTimeout) || 10);
		this._lastValue = this.readSync();

		this._watchTimer = setInterval(() => {
			let value;
			try {
				value = this.readSync();
			} catch (err) {
				callback(err);
				return;
			}
			if (value === this._lastValue) return;
			this._lastValue = value;

			const rising = value === HIGH;
			const fire =
				this.edge === EDGE_BOTH ||
				(this.edge === EDGE_RISING && rising) ||
				(this.edge === EDGE_FALLING && !rising);
			if (fire) callback(null, value);
		}, pollMs);

		if (typeof this._watchTimer.unref === 'function') {
			this._watchTimer.unref();
		}
		return this;
	}

	unwatch() {
		if (this._watchTimer) {
			clearInterval(this._watchTimer);
			this._watchTimer = null;
		}
		return this;
	}

	unexport() {
		this.unwatch();
		if (!this._released && this._line && typeof this._line.release === 'function') {
			try {
				this._line.release();
			} catch (e) {
				/* line already released or never requested */
			}
		}
		this._released = true;
		return this;
	}

	setDirection(direction) {
		this.unexport();
		this._released = false;
		this.direction = direction;
		this._line = this._chip.getLine(this.pin);
		this._request();
		return this;
	}

	direction_() {
		return this.direction;
	}
}

Gpio.HIGH = HIGH;
Gpio.LOW = LOW;
Gpio.accessible = true;

module.exports = { Gpio };
