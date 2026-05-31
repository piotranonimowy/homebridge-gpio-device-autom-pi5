# Changelog

## 0.5.0 — Raspberry Pi 5 port

- **GPIO backend swapped from `onoff` (sysfs) to `node-libgpiod` (libgpiod v1
  character device).** Required for the Raspberry Pi 5 / RP1 controller, which
  removed `/sys/class/gpio`. Verified against Ubuntu 24.04 LTS (libgpiod 1.6.3).
- Added `lib/gpio-pi5.js`, a drop-in onoff-compatible `Gpio` shim
  (`new Gpio`, `readSync`, `writeSync`, `watch`, `unwatch`, `unexport`,
  `HIGH`/`LOW`). `index.js` changes only its one `require` line.
- Inputs are watched via non-blocking polling at the debounce interval
  (default 10 ms), since `node-libgpiod` 0.6.0 has no async edge callback.
- Chip defaults to `gpiochip0`; override with the `GPIO_CHIP` env var.
- Updated install docs: `libgpiod-dev`/`gpiod` prerequisites, `gpio` group +
  udev rule, hardware verification with `gpiodetect`/`gpioget`/`gpioset`.
- `engines.node` raised to `>=18`; package marked `linux`-only.

Pin numbering (BCM) and all device configuration are unchanged from upstream.
