# PawTracker Firmware

## LoRa Communication Protocol

The Beacon and Station communicate using binary packed structures transmitted over LoRa at 915 MHz.

### BeaconMessage Structure (Beacon → Station)

Sent every 1 second (configurable) containing GPS and status data.

```cpp
struct __attribute__((packed)) BeaconMessage {
  uint8_t msgType;                 // 1 byte  - Message type (0x01 for beacon)
  float latitude;                  // 4 bytes - GPS latitude (degrees)
  float longitude;                 // 4 bytes - GPS longitude (degrees)
  float hdop;                      // 4 bytes - Horizontal Dilution of Precision
  uint8_t sats;                    // 1 byte  - Number of satellites
  float batteryVoltage;            // 4 bytes - Battery voltage (volts)
  uint8_t ledOn;                   // 1 byte  - LED state (0=OFF, 1=ON)
  uint8_t buzzerOn;                // 1 byte  - Buzzer state (0=OFF, 1=ON)
  uint8_t lastControlReceived;     // 1 byte  - Last control command (0=None, 1=LED, 2=Buzzer, 3=Both)
  float speed;                     // 4 bytes - Speed in km/h
  float altitude;                  // 4 bytes - Altitude in meters
  uint32_t uptime;                 // 4 bytes - Beacon uptime in seconds
};
// Total size: 33 bytes
```

### ControlMessage Structure (Station → Beacon)

Sent immediately after receiving a beacon (within 500ms window) to control LED/Buzzer.

```cpp
struct __attribute__((packed)) ControlMessage {
  uint8_t msgType;                 // 1 byte  - Message type (0x10 for control)
  uint8_t ledOn;                   // 1 byte  - LED command (0=OFF, 1=ON)
  uint8_t buzzerOn;                // 1 byte  - Buzzer command (0=OFF, 1=ON)
};
// Total size: 3 bytes
```

### Protocol Details

- **Transmission Method**: Raw binary data cast to `uint8_t*` array
- **Packing**: `__attribute__((packed))` ensures no padding between fields
- **Efficiency**: 33 bytes for full beacon data vs 100+ bytes for equivalent JSON
- **Frequency**: 915 MHz (US ISM band)
- **Modulation**: LoRa spread spectrum
- **Receive Window**: Beacon listens for 500ms after each transmission
- **Compatibility**: Both devices must have identical struct definitions

### Communication Flow

1. **Beacon** transmits `BeaconMessage` with current GPS/status data
2. **Beacon** enters receive mode for 500ms
3. **Station** receives beacon, processes data
4. **Station** (if control pending) transmits `ControlMessage` within 500ms window
5. **Beacon** receives control, updates LED/Buzzer states
6. **Beacon** waits for next transmission interval (1 second default)

## Statistics File Format

The statistics file (`stats.csv`) logs tracking data in a compact CSV format with the following columns:

### Column Definitions

| Column | Acronym | Full Name | Description | Unit |
|--------|---------|-----------|-------------|------|
| **T** | - | Timestamp | Unix timestamp from GPS (UTC) | seconds since epoch |
| **SUT** | Station Uptime | Station Uptime | Time since station boot | seconds |
| **SB** | Station Battery | Station Battery | Station battery voltage | volts (V) |
| **BUT** | Beacon Uptime | Beacon Uptime | Time since last beacon received | seconds |
| **BB** | Beacon Battery | Beacon Battery | Beacon battery voltage | volts (V) |

### File Constraints

- **Maximum Size**: 1KB
- **Rotation**: FIFO (First In, First Out) - oldest entries removed when size limit reached
- **Logging Interval**: 5 seconds (configurable, TODO: increase to 60 seconds for production)
- **Prerequisite**: Valid GPS time and date required before logging begins

### Example Data

```csv
T,SUT,SB,BUT,BB
1732992000,120,4.15,5,3.98
1732992005,125,4.14,10,3.97
1732992010,130,4.15,15,3.96
```

### Notes

- All timestamps are in UTC (from GPS)
- Battery voltages are stored with 2 decimal precision
- Beacon data (BUT, BB) shows time/battery since last beacon reception
- If no beacon has been received, BUT and BB will be 0
