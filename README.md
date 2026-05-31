# homebridge-gpio-device-autom-pi5

Homebridge GPIO device exposes several HomeKit accessories interacting with GPIO.

This is a **Raspberry Pi 5 port** of `homebridge-gpio-device-autom`. The Pi 5 replaced the
Broadcom GPIO block with the in-house **RP1** controller, which removed the legacy sysfs
interface (`/sys/class/gpio`) that the original `onoff` dependency relied on. This fork drops
`onoff` and drives the GPIO header through the modern **libgpiod character device**
(`/dev/gpiochip0`) via `node-libgpiod`. It is verified against **Ubuntu 24.04 LTS**
(libgpiod 1.6.3). The HomeKit/automation behaviour and the device configuration format below
are unchanged from the upstream fork.

> Pin numbers in your config stay the same: they are BCM GPIO numbers, equal to the line
> offset on the RP1 chip. The plugin **auto-detects** which gpiochip is the 40-pin header (the
> one labelled `pinctrl-rp1`), so no chip configuration is normally needed. On Ubuntu 24.04 the
> header is usually `gpiochip4`; on a patched Raspberry Pi OS kernel it may be `gpiochip0` —
> either way detection handles it. Override with `GPIO_CHIP` only if auto-detection fails.

# Apple Home automations

All accessories expose a unique serial number and report an initial state at startup, so they appear in the Apple Home **Automation** picker as triggers and conditions.

Input accessories (`ContactSensor`, `MotionSensor`, `LeakSensor`, etc.) and `ProgrammableSwitch` emit state-change events and can be used directly as automation triggers ("When this happens").

Output accessories (`Switch`, `Lightbulb`, `Outlet`, `Fan`, `Valve`, `LockMechanism`, ...) can always be used as automation **actions**. To also use them as **triggers**, wire the relay/contact state back to a GPIO and set the optional `inputPin` parameter — the accessory then reports real state changes and becomes trigger-capable. Without `inputPin` there is no state feedback, so an output can be controlled by automations but cannot trigger them.

Apple Home does not offer `Valve`/`Faucet` accessories as automation triggers (they are action-only). To trigger automations from a valve, add `"stateSensor": true` to the accessory config: the plugin exposes a linked `ContactSensor` that shadows the on/off state (ON → "Open", OFF → "Closed"), which Apple Home always accepts as a trigger. Set `"stateSensor": "My Name"` to choose the sensor name. The mirror follows real hardware state when `inputPin` is set, otherwise it follows the commanded state. This option works on any output type.

Apple Home also does not expose `Valve`/`Faucet` accessories to its automation engine as **actions** (they can be controlled manually but are not selectable when choosing accessories for an automation). To control a valve from an automation, add `"controlSwitch": true`: the plugin exposes a companion `Switch` that drives the same GPIO and stays in sync with the valve in both directions. Select that switch as the controlled accessory in the automation. Set `"controlSwitch": "My Name"` to choose its name. Combine `stateSensor` and `controlSwitch` to use a valve as both trigger and action.

Note: `Speaker`, `Microphone`, and `Doorbell` are not first-class services in the Apple Home app and will not appear in automations regardless. Use `StatelessProgrammableSwitch` for button-press triggers.

# Installation (Raspberry Pi 5 / Ubuntu 24.04 LTS)

1. Install Node.js 18 LTS or newer.
2. Install Homebridge: `npm install -g homebridge`
3. Install the libgpiod build prerequisites (the `node-libgpiod` native addon compiles
   against these). On Ubuntu 24.04 these provide libgpiod **1.6.3**:
   ```
   sudo apt-get update
   sudo apt-get install -y gpiod libgpiod-dev build-essential python3
   ```
4. Grant the Homebridge service user access to the GPIO character device. Ubuntu does not
   ship a `gpio` group by default, so create one, give it ownership of `/dev/gpiochip0`, and
   add the user:
   ```
   sudo groupadd -f gpio
   sudo usermod -aG gpio homebridge
   # udev rule so the chip is group-accessible on every boot:
   echo 'SUBSYSTEM=="gpio", KERNEL=="gpiochip[0-9]*", GROUP="gpio", MODE="0660"' \
     | sudo tee /etc/udev/rules.d/90-gpio.rules
   sudo udevadm control --reload-rules && sudo udevadm trigger
   ```
   Then restart the Homebridge service (or reboot) so the new group membership takes effect.
5. Install this plugin: `sudo npm install -g homebridge-gpio-device-autom-pi5 --unsafe-perm`

### Verifying the hardware first

Confirm the header is on `gpiochip0` and that pins respond before configuring Homebridge:
```
gpiodetect                 # expect: gpiochip0 [pinctrl-rp1] (54 lines)
gpioget gpiochip0 17       # read BCM17
gpioset gpiochip0 17=1     # drive BCM17 high
```

### Selecting a different gpiochip

The plugin **auto-detects** the 40-pin header by finding the gpiochip whose label is
`pinctrl-rp1`, so it works out of the box whether that chip is `gpiochip4` (typical on Ubuntu
24.04) or `gpiochip0` (patched Raspberry Pi OS kernels). Check the layout with:
```
gpiodetect        # find the line labelled: gpiochipN [pinctrl-rp1] (54 lines)
```
Only if auto-detection fails (custom kernel, unusual label) set the `GPIO_CHIP` environment
variable for the Homebridge process — e.g. `Environment=GPIO_CHIP=4` in the systemd unit, or
`export GPIO_CHIP=4` before launching. An explicit `GPIO_CHIP` always overrides auto-detection.

### Notes on input handling

`onoff` used kernel interrupt edges for inputs. `node-libgpiod` 0.6.0 does not expose a
non-blocking edge callback, so watched inputs are sampled at the configured debounce interval
(default 10 ms) and the change is reported through the same callback contract. This is well
within range for buttons, contact/leak/motion sensors and the `StatelessProgrammableSwitch`
accessory. If you need a faster response, the sampling interval follows the `debounceTimeout`
the plugin sets internally.
6. Update your configuration file. See bellow for a sample.

# Wiring

Any inputs are configured with pull-up resistor and considered as active on low state.
Sensors must be plug as following

`GND <---> SENSOR <---> PIN`

Sensors are considered as _Normally Opened_ by default. If using _Normally Closed_ sensor, you can use `inverted` or `invertedInputs` parameters as explained in the next section.
Pull-up resistors can be disabled by adding parameter `"pullUp": false` in any accessory using inputs. If disabled, you'll have to wire pull-up or pull-down resistors by yourself.

###### Note

In the section bellow, `LOW` state means _sensor contact closed_. `HIGH` state means _sensor contact opened_.
For outputs, `LOW` state means 0V and `HIGH` state means 3.3V.

# Configuration

Configuration example:
```
{
	"bridge": {
		...
	},

	"description": "...",

	"accessories": [
		{
			"accessory": "GPIODevice",
			"name": "Front Door",
			"type": "ContactSensor",
			"pin": 4
		},
		{
			"accessory": "GPIODevice",
			"name": "Sofa Light",
			"type": "Lightbulb",
			"pin": 5
		},
		{
			"accessory": "GPIODevice",
			"type": "MotionSensor",
			"name": "Hall Motion",
			"pin": 3,
			"occupancy": {
				"name": "Home Occupancy",
				"timeout": 3600
			}
		},
		{
			"accessory": "GPIODevice",
			"name": "Kitchen Roller Shutter",
			"type": "WindowCovering",
			"pins": [12,13]
			"shiftDuration": 23,
			"initPosition": 99
		},
		{
			"accessory": "GPIODevice",
			"type": "LockMechanism",
			"name": "Front Door",
			"pin": 6,
			"duration": 5
		},
		{
			"accessory": "GPIODevice",
			"type": "Valve",
			"name": "Garden irrigation",
			"subType": "irrigation",
			"pin": 6
		},
		{
			"accessory": "GPIODevice",
			"type": "StatelessProgrammableSwitch",
			"name": "Push Button",
			"pin": 4
		}
	],

	"platforms":[]
}
```

`pin` numbers must be specified as ~~wPi~~ **BCM** (as of v0.4.7) pin number in the `Pin Configuration` table below

## Common configuration

| Type                  | Note							|
|-----------------------|-------------------|
| `name`								| Accessory name 		|
| `type`								| Type of accessory |


Accessory type could be one of the following:
* [ContactSensor](#digitalinput)
* [MotionSensor](#digitalinput)
* [LeakSensor](#digitalinput)
* [SmokeSensor](#digitalinput)
* [CarbonDioxideSensor](#digitalinput)
* [Switch](#digitaloutput)
* [Lightbulb](#digitaloutput)
* [Outlet](#digitaloutput)
* [Valve](#digitaloutput)
* [Window](#positionopener)
* [WindowCovering](#positionopener)
* [Door](#positionopener)
* [GarageDoorOpener](#garagedooropener)
* [LockMechanism](#lockmechanism)
* [StatelessProgrammableSwitch](#programmableswitch)
* [Doorbell](#programmableswitch)

## Pin Configuration

wPi pin number must be used in config file

`gpio readall`
```
 +-----+-----+---------+------+---+---Pi 2---+---+------+---------+-----+-----+
 | BCM | wPi |   Name  | Mode | V | Physical | V | Mode | Name    | wPi | BCM |
 +-----+-----+---------+------+---+----++----+---+------+---------+-----+-----+
 |     |     |    3.3v |      |   |  1 || 2  |   |      | 5v      |     |     |
 |   2 |   8 |   SDA.1 |  OUT | 0 |  3 || 4  |   |      | 5V      |     |     |
 |   3 |   9 |   SCL.1 |   IN | 1 |  5 || 6  |   |      | 0v      |     |     |
 |   4 |   7 | GPIO. 7 |   IN | 1 |  7 || 8  | 1 | ALT0 | TxD     | 15  | 14  |
 |     |     |      0v |      |   |  9 || 10 | 1 | ALT0 | RxD     | 16  | 15  |
 |  17 |   0 | GPIO. 0 |   IN | 0 | 11 || 12 | 1 | IN   | GPIO. 1 | 1   | 18  |
 |  27 |   2 | GPIO. 2 |  OUT | 0 | 13 || 14 |   |      | 0v      |     |     |
 |  22 |   3 | GPIO. 3 |   IN | 0 | 15 || 16 | 0 | IN   | GPIO. 4 | 4   | 23  |
 |     |     |    3.3v |      |   | 17 || 18 | 0 | IN   | GPIO. 5 | 5   | 24  |
 |  10 |  12 |    MOSI |   IN | 0 | 19 || 20 |   |      | 0v      |     |     |
 |   9 |  13 |    MISO |   IN | 0 | 21 || 22 | 0 | IN   | GPIO. 6 | 6   | 25  |
 |  11 |  14 |    SCLK |   IN | 0 | 23 || 24 | 1 | IN   | CE0     | 10  | 8   |
 |     |     |      0v |      |   | 25 || 26 | 1 | IN   | CE1     | 11  | 7   |
 |   0 |  30 |   SDA.0 |   IN | 1 | 27 || 28 | 1 | IN   | SCL.0   | 31  | 1   |
 |   5 |  21 | GPIO.21 |   IN | 1 | 29 || 30 |   |      | 0v      |     |     |
 |   6 |  22 | GPIO.22 |   IN | 1 | 31 || 32 | 0 | IN   | GPIO.26 | 26  | 12  |
 |  13 |  23 | GPIO.23 |   IN | 0 | 33 || 34 |   |      | 0v      |     |     |
 |  19 |  24 | GPIO.24 |   IN | 0 | 35 || 36 | 0 | IN   | GPIO.27 | 27  | 16  |
 |  26 |  25 | GPIO.25 |   IN | 0 | 37 || 38 | 0 | IN   | GPIO.28 | 28  | 20  |
 |     |     |      0v |      |   | 39 || 40 | 0 | IN   | GPIO.29 | 29  | 21  |
 +-----+-----+---------+------+---+----++----+---+------+---------+-----+-----+
 | BCM | wPi |   Name  | Mode | V | Physical | V | Mode | Name    | wPi | BCM |
 +-----+-----+---------+------+---+---Pi 2---+---+------+---------+-----+-----+
```

# Type of accessories

## DigitalInput

`ContactSensor`, `MotionSensor`, `LeakSensor`, `SmokeSensor`, `CarbonDioxideSensor` and `CarbonMonoxideSensor` types monitor a GPIO input and report it as HomeKit Sensor.

###### Configuration

| Parameter                  | Type				| Default 	| Note																																									|
|----------------------------|------------------|-----------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `pin`               		 | Integer			| N/A	  	| mandatory, input pin number to monitor (LOW: sensor triggered, HIGH: sensor not triggered)																			|
| `inverted`               	 | Boolean			| false		| optional, reverse the behaviour of the GPIO **input** pin (HIGH: sensor triggered, LOW: sensor not triggered)																	|
| `postpone`               	 | Integer			| 100		| optional, delay (ms) between 2 state change to avoid bouncing																											|
###### MotionSensor additional parameters

`MotionSensor` has optional OccupancySensor wich can be configured with a timeout.
Could be used with this [PIR Sensor](http://snootlab.com/adafruit/285-capteur-de-presence-pir.html).

| Parameter                  | Type				| Default 	| Note																																									|
|----------------------------|------------------|-----------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `occupancy`            	 | {}				| null		| optional, activate an occupancy sensor with a timeout after motion detection																							|
| `occupancy.name`           | String			| N/A		| mandatory, occupancy sensor name																																		|
| `occupancy.timeout`        | Integer (sec)	| 60		| optional, ocupancy timeout in sec after motion detection																												|

## DigitalOutput

`Switch`, `Lightbulb`, `Outlet`, `Fan`, `Fanv2` and `Valve` operates a GPIO output as ON/OFF.

###### Configuration

| Parameter                  | Type				| Default 	| Note																																									|
|----------------------------|------------------|-----------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `pin`               		 | Integer			| N/A		| mandatory, output pin number to trigger (on: HIGH, off: LOW)																										|
| `inverted`               	 | Boolean			| false		| optional, reverse the behaviour of the GPIO **output** pin (on: LOW, off: HIGH)																								|
| `initState`             	 | 0/1				| 0			| optional, default state of the switch at startup (0: off, 1: on)																									|
| `duration`             	 | Integer			| 0			| optional, duration before restoring output state (0: disabled)																										|
| `inputPin`               	 | Integer			| N/A		| optional, input pin number used as mirroring.	(LOW: switch to on, HIGH: switch to off)																				|

###### Valve optional configuration

| Parameter                  | Type				| Default 	| Note																																									|
|----------------------------|------------------|-----------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `subType`               	 | String			| "generic"	| optional, valve widget subtype like "irrigation", "shower" or "faucet"																								|
| `inputPin`               	 | Integer			| N/A		| optional, input pin number used as "InUse" characteristic for Valve widget. (LOW: in use, HIGH: not in use)														|

## ProgrammableSwitch

`StatelessProgrammableSwitch` or `Doorbell` types monitor a GPIO input and reports it as HomeKit Stateless Programmable Switch.

###### Configuration

| Parameter                  | Type				| Default 	| Note																																									|
|----------------------------|------------------|-----------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `pin`               		 | Integer			| N/A	  	| mandatory, input pin number to monitor (LOW: button pressed, HIGH: button released)																					|
| `inverted`               	 | Boolean			| false		| optional, reverse the behaviour of the GPIO **output** pin (HIGH: button pressed, LOW: button released)																		|
| `shortPress`             	 | Integer			| 500		| optional, delay (ms) of a short press (double press will be detected if done in this delay)																			|
| `longPress`              	 | Integer			| 2000		| optional, delay (ms) of a long press																																	|
| `postpone`               	 | Integer			| 100		| optional, delay (ms) between 2 state change to avoid bouncing																											|

## PositionOpener

`Window`, `WindowCovering` or `Door` controls 2 GPIO outputs plugged to a remote control.
When operating, the GPIO is turned on for 200ms to simulate a button pression on the remote control.

###### Configuration

| Parameter                  | Type				| Default 	| Note																																									|
|----------------------------|------------------|-----------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `pins`               		 | Integer[2]		| N/A	  	| mandatory, output pins numbers to trigger (pins[0]: open, pins[1]: close)																							|
| `inverted`               	 | Boolean			| false		| optional, reverse the behaviour of the GPIO **output** pin(s) (pulse becomes HIGH->LOW->HIGH)																						|
| `initPosition`			 | Integer (%)		| 0			| optional, default shutter position at homebridge startup to compensate absence of state feedback, recommanded to ensure open/close scenarios after unexptected restart: 99% |
| `shiftDuration`            | Integer (sec)	| 20		| optional, duration of a shift (close->open or open->close) used to compute intermediate position																		|
| `pulseDuration`          	 | Integer			| 200		| optional, duration of the pin pulse. (0: deactivate, pin active during all shifting)
| `invertStopPin`          	 | Boolean			| false		| optional, utilize the opposite pin to stop the shutter |
| `openSensorPin`            | Integer			| N/A		| optional, input pin number for open sensor (LOW: opened position)																												|
| `closeSensorPin`           | Integer			| N/A		| optional, input pin number for close sensor (LOW: closed position)																												|
| `invertedInputs`         	 | Boolean			| false		| optional, reverse the behaviour of the GPIO **input** pins (detect opened/closed on HIGH state)																				|

## GarageDoorOpener

`GarageDoorOpener` controls 1 or 2 GPIO output(s) plugged to a garage door engine.
When operating, the GPIO is turned on for 200ms.

###### Configuration

| Parameter                  | Type				| Default 	| Note																																									|
|----------------------------|------------------|-----------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `pin`               		 | Integer			| N/A		| optional, output pin number for toggle opener (first pulse: open, second pulse: close)																				|
| `pins`               		 | Integer[2]		| N/A		| optional, output pins numbers for open/close opener (pins[0]: open, pins[1]: close)																					|
| `inverted`               	 | Boolean			| false		| optional, reverse the behaviour of the GPIO **output** pin(s) (pulse becomes HIGH->LOW->HIGH)																						|
| `openingDuration`          | Integer			| 10		| optional, opening duration of the door (seconds). Emulate transition if openSensorPin not provided.																	|
| `closingDuration`          | Integer			| 10		| optional, closing duration of the door (seconds). Emulate transition if closeSensorPin not provided.																	|
| `waitingDuration`          | Integer			| N/A		| optional, waiting duration of the door shift before closing (seconds). If setted, emulate a cyclic door if openSensorPin not provided.									|
| `pulseDuration`          	 | Integer			| 200		| optional, duration of the pin pulse.																																	|
| `openSensorPin`            | Integer			| N/A		| optional, input pin number for open sensor (LOW: opened position)																										|
| `closeSensorPin`           | Integer			| N/A		| optional, input pin number for close sensor (LOW: closed position)																										|
| `invertedInputs`         	 | Boolean			| false		| optional, reverse the behaviour of the GPIO **input** pins (detect opened/closed on HIGH state)																				|


## LockMechanism

`LockMechanism` operate a GPIO outputs plugged to an electric latch.
When operating, the latch is unlocked for `duration` seconds (or indefinitely if `duration=0`)

###### Configuration

| Parameter                  | Type				| Default 	| Note																																									|
|----------------------------|------------------|-----------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `pin`               		 | Integer		  	| N/A		| mandatory, output pin number to trigger (lock: LOW, unlock: HIGH)																								|
| `duration`            	 | Integer (sec)  	| 0			| optional, duration before restoring locked state (0 : disabled)																										|
| `inverted`				 | Boolean		  	| false		| optional, reverse the behaviour of the GPIO **output** pin (lock: HIGH, unlock: LOW)																						|
| `inputPin`               	 | Integer			| N/A		| optional, input pin number for lock sensor (LOW: unlocked, HIGH: locked)																								|

