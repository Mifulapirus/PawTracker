# PawTracker

**PawTracker** is an outdoors GPS tracker system for dogs, utilizing LoRa technology for long-range communication. The system consists of two main devices:

 - **PupBeacon**: Worn by the dog, this device transmits GPS location data to the base station. It features a bright LED and a loud buzzer, both remotely activatable from the base station's website to help locate your pet.
- **PupStation**: Carried by the human, this device receives location data from the animal tracker via LoRa and serves a web interface over WiFi. The website displays a real-time map of your dog's location and controls for the LED and buzzer.

## Features

- Real-time GPS tracking via LoRa
- Web-based map interface accessible over WiFi
- Remote activation of LED and buzzer on the animal tracker
- Long battery life with lithium battery support

## Hardware

- [Heltec Wireless Tracker](https://heltec.org/project/wireless-tracker/)
- Lithium battery

## Getting Started

See individual component READMEs for detailed setup instructions:
- `Firmware/` - PupBeacon and PupStation firmware
- `Server/` - Central tracking server with web dashboard

## Server

The `Server/` directory contains a Node.js-based central tracking server with a login-protected web dashboard. PupStations can optionally send their beacon data to this server when they have internet connectivity.

**Features:**
- Real-time GPS tracking dashboard with interactive maps
- WebSocket support for live updates
- Remote LED/buzzer control through the web interface
- Multi-device support
- Authentication and session management
- Device history tracking

**Quick Start:**
```bash
cd Server
npm install
cp .env.example .env
# Edit .env with your credentials
npm start
```

Then configure each PupStation with your server URL via its web interface or API.

See `Server/README.md` for complete documentation.

## Firmware

The `Firmware/` directory contains a single shared firmware image for the Heltec Wireless Tracker, which can run as either:

- **PupBeacon** (dog-worn tracker)
- **PupStation** (human-carried base station)

The role is selected at boot using the BOOT button (GPIO0):

- **Button not pressed during reset** → runs as **PupBeacon** (power-efficient GPS beacon with LoRa uplink and remote LED/buzzer control).
- **Button held during reset** → runs as **PupStation** (LoRa receiver that displays location data and sends LED/buzzer control commands).

PupBeacon firmware is optimized for low power by spending most of its time in deep sleep, waking periodically to acquire a GPS fix, transmit it over LoRa, briefly listen for control messages, and then going back to sleep.
