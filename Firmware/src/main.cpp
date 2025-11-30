#include <Arduino.h>
#include <TinyGPSPlus.h>
#include <SPI.h>
#include <RadioLib.h>
#include <Adafruit_GFX.h>
#include <Adafruit_ST7735.h>
#include <WiFi.h>
#include <WiFiManager.h>
#include <ESPAsyncWebServer.h>
#include <Preferences.h>
#include <LittleFS.h>
#include <ESPmDNS.h>

// -----------------------------------------------------------------------------
// Device role selection
// -----------------------------------------------------------------------------

enum DeviceRole {
  ROLE_PUP_BEACON = 0,
  ROLE_PUP_STATION = 1
};

DeviceRole currentRole = ROLE_PUP_BEACON;

// Simple role selection on boot using a button (or BOOT button)
// HIGH = PupStation, LOW = PupBeacon
const int ROLE_SELECT_PIN = 0; // GPIO0 / BOOT on many ESP32 boards

// -----------------------------------------------------------------------------
// Hardware mapping for Heltec Wireless Tracker (approximate / starter template)
// You will likely need to adapt these to the actual board pinout.
// -----------------------------------------------------------------------------

// LED & Buzzer
const int LED_PIN = 18;      // Onboard LED on Heltec Wireless Tracker V1.1
const int BUZZER_PIN = -1;   // No buzzer on board (set to -1 to disable)

// GPS (UART)
HardwareSerial GPSSerial(1);
const int GPS_RX_PIN = 33;   // RX from GPS module (ESP32 -> GPS)
const int GPS_TX_PIN = 34;   // TX to GPS module (ESP32 -> GPS)

TinyGPSPlus gps;

// TFT Display (ST7735) - Heltec Wireless Tracker V1.1
const int TFT_CS = 38;
const int TFT_DC = 40;
const int TFT_RST = 39;
const int TFT_MOSI = 42;
const int TFT_SCLK = 41;
const int TFT_BL = 21;        // Backlight pin for V1.1
const int VEXT_ENABLE = 3;    // Power enable for display/GPS (active HIGH)

// Battery monitoring
const int BATTERY_PIN = 1;    // ADC pin for battery voltage
const int ADC_CTRL = 2;       // ADC control pin (active HIGH to enable voltage divider)
const float ADC_MULTIPLIER = 4.9 * 1.045;  // Voltage divider ratio

// Use hardware SPI for TFT
Adafruit_ST7735 tft = Adafruit_ST7735(TFT_CS, TFT_DC, TFT_MOSI, TFT_SCLK, TFT_RST);

// LoRa parameters (must match on both sides)
const float LORA_FREQUENCY = 915.0; // MHz - Adjust to your region (e.g., 868.0 in EU)

// LoRa pin definitions for Heltec Wireless Tracker V1.1 (SX1262)
const int LORA_SCK = 9;
const int LORA_MISO = 11;
const int LORA_MOSI = 10;
const int LORA_CS = 8;
const int LORA_RST = 12;
const int LORA_DIO1 = 14;  // SX1262 IRQ
const int LORA_BUSY = 13;  // SX1262 BUSY

// Create SX1262 radio instance
SX1262 radio = new Module(LORA_CS, LORA_DIO1, LORA_RST, LORA_BUSY);

// Flag for packet reception
volatile bool receivedFlag = false;

// ISR for packet reception
void setFlag(void) {
  receivedFlag = true;
}

// Power management
// For PupBeacon, we'll mostly sleep between position reports.
const uint32_t BEACON_SEND_INTERVAL_MS = 1000;  // How often to send GPS fix (1 second for status updates)
const uint32_t BEACON_AWAKE_WINDOW_MS = 1500;    // How long to stay awake

// Simple message types
struct __attribute__((packed)) BeaconMessage {
  uint8_t msgType;   // 0x01 = GPS beacon, 0x02 = control ack, etc.
  float latitude;
  float longitude;
  float hdop;
  uint8_t sats;
  float batteryVoltage;
  uint8_t ledOn;
  uint8_t buzzerOn;
  uint8_t lastControlReceived; // 0=none, 1=LED, 2=Buzzer, 3=Both
  float speed;       // Speed in km/h
  float altitude;    // Altitude in meters
  uint32_t uptime;   // Beacon uptime in seconds
};

struct __attribute__((packed)) ControlMessage {
  uint8_t msgType;   // 0x10 = control from station
  uint8_t ledOn;     // 0 or 1
  uint8_t buzzerOn;  // 0 or 1
};

// -----------------------------------------------------------------------------
// WiFi and Web Server (PupStation only)
// -----------------------------------------------------------------------------

AsyncWebServer server(80);
WiFiManager wifiManager;
Preferences preferences;
bool serverStarted = false;

// Latest beacon data (global for web server)
struct LatestBeaconData {
  float latitude = 0.0;
  float longitude = 0.0;
  float hdop = 0.0;
  uint8_t sats = 0;
  float batteryVoltage = 0.0;
  bool ledOn = false;
  bool buzzerOn = false;
  uint8_t lastControlReceived = 0;
  float speed = 0.0;
  float altitude = 0.0;
  uint32_t uptime = 0;
  uint32_t lastUpdate = 0;
  float rssi = 0.0;
  float snr = 0.0;
  bool hasData = false;
} latestBeacon;

// Station GPS location (global for web server)
struct StationLocation {
  float latitude = 0.0;
  float longitude = 0.0;
  float hdop = 0.0;
  uint8_t sats = 0;
  float altitude = 0.0;
  bool hasValidFix = false;
  uint32_t lastUpdate = 0;
} stationLocation;

// Control state for beacon actuators
struct BeaconControlState {
  bool ledOn = false;
  bool buzzerOn = false;
  bool pendingControl = false; // Flag to send control on next beacon reception
} beaconControl;

// -----------------------------------------------------------------------------
// Statistics Tracking
// -----------------------------------------------------------------------------

const char* STATS_FILE = "/stats.csv";
const uint32_t STATS_LOG_INTERVAL = 5000; // TODO: Change to 60000 (1 minute) after testing
const uint32_t MAX_STATS_FILE_SIZE = 1024; // Keep file under 1KB
uint32_t lastStatsLog = 0;
uint32_t bootTime = 0;
uint32_t rebootCount = 0;

struct StatsEntry {
  uint32_t timestamp;
  uint32_t stationUptime;
  float stationBattery;
  uint32_t beaconUptime;
  float beaconBattery;
};

// Forward declaration
float readBatteryVoltage();

// Log statistics to file
void logStats() {
  // Only log if we have valid GPS time
  if (!gps.time.isValid() || !gps.date.isValid()) {
    Serial.println("Skipping stats log - no GPS time available");
    return;
  }
  
  uint32_t now = millis();
  uint32_t stationUptime = (now - bootTime) / 1000; // uptime in seconds
  float stationBattery = readBatteryVoltage();
  
  // Calculate beacon uptime (time since last seen, or 0 if never seen)
  uint32_t beaconUptime = 0;
  float beaconBattery = 0.0;
  if (latestBeacon.hasData) {
    beaconUptime = (now - latestBeacon.lastUpdate) / 1000; // seconds since last beacon
    beaconBattery = latestBeacon.batteryVoltage;
  }
  
  // Create Unix timestamp from GPS date/time
  // Note: TinyGPS++ provides UTC time
  struct tm timeinfo;
  timeinfo.tm_year = gps.date.year() - 1900;
  timeinfo.tm_mon = gps.date.month() - 1;
  timeinfo.tm_mday = gps.date.day();
  timeinfo.tm_hour = gps.time.hour();
  timeinfo.tm_min = gps.time.minute();
  timeinfo.tm_sec = gps.time.second();
  timeinfo.tm_isdst = 0;
  time_t timestamp = mktime(&timeinfo);
  
  // Check current file size before writing
  File file = LittleFS.open(STATS_FILE, FILE_READ);
  size_t currentSize = 0;
  if (file) {
    currentSize = file.size();
    file.close();
  }
  
  // If file is too large, rotate (remove oldest entries)
  if (currentSize >= MAX_STATS_FILE_SIZE) {
    file = LittleFS.open(STATS_FILE, FILE_READ);
    if (file) {
      String header = file.readStringUntil('\n');
      
      // Skip lines until we're under 75% of max size (leave room for new entries)
      String keepData = "";
      size_t targetSize = (MAX_STATS_FILE_SIZE * 3) / 4;
      
      // Read all lines first
      String allLines[100]; // Buffer for lines
      int lineCount = 0;
      while (file.available() && lineCount < 100) {
        allLines[lineCount++] = file.readStringUntil('\n');
      }
      file.close();
      
      // Keep only the most recent lines that fit
      int startIdx = 0;
      for (int i = lineCount - 1; i >= 0; i--) {
        if (keepData.length() + allLines[i].length() + 2 < targetSize) {
          keepData = allLines[i] + "\n" + keepData;
          startIdx = i;
        } else {
          break;
        }
      }
      
      // Rewrite file with header and kept data
      file = LittleFS.open(STATS_FILE, FILE_WRITE);
      if (file) {
        file.println(header);
        file.print(keepData);
        file.close();
        Serial.println("Stats file rotated (FIFO)");
      }
    }
  }
  
  // Check if file exists, create with header if not
  if (!LittleFS.exists(STATS_FILE)) {
    file = LittleFS.open(STATS_FILE, FILE_WRITE);
    if (file) {
      file.println("T,SUT,SB,BUT,BB");
      file.close();
    }
  }
  
  // Open file in append mode
  file = LittleFS.open(STATS_FILE, FILE_APPEND);
  if (!file) {
    Serial.println("Failed to open stats file for writing");
    return;
  }
  
  // Write data (compact format)
  file.print(timestamp);
  file.print(",");
  file.print(stationUptime);
  file.print(",");
  file.print(stationBattery, 2);
  file.print(",");
  file.print(beaconUptime);
  file.print(",");
  file.println(beaconBattery, 2);
  
  file.close();
}

// Initialize stats tracking
void initStats() {
  bootTime = millis();
  
  // Load reboot count from preferences
  preferences.begin("pawtracker", false);
  rebootCount = preferences.getUInt("rebootCount", 0);
  rebootCount++;
  preferences.putUInt("rebootCount", rebootCount);
  preferences.end();
  
  Serial.print("Boot #");
  Serial.println(rebootCount);
  
  // Log initial entry
  lastStatsLog = millis();
  logStats();
}

// -----------------------------------------------------------------------------
// Utility
// -----------------------------------------------------------------------------

float readBatteryVoltage() {
  // Enable ADC voltage divider
  pinMode(ADC_CTRL, OUTPUT);
  digitalWrite(ADC_CTRL, HIGH);
  delay(10);
  
  // Read voltage
  int rawValue = analogRead(BATTERY_PIN);
  float voltage = (rawValue / 4095.0) * 3.3 * ADC_MULTIPLIER;
  
  // Disable ADC to save power
  digitalWrite(ADC_CTRL, LOW);
  
  return voltage;
}

static void initLoRa() {
  Serial.println("Initializing LoRa SX1262...");
  
  // Initialize SPI for LoRa (separate pins from TFT)
  SPI.begin(LORA_SCK, LORA_MISO, LORA_MOSI, LORA_CS);
  Serial.println("LoRa SPI initialized");
  
  // Initialize SX1262
  Serial.print("LoRa frequency: ");
  Serial.print(LORA_FREQUENCY);
  Serial.println(" MHz");
  
  int state = radio.begin(LORA_FREQUENCY);
  if (state == RADIOLIB_ERR_NONE) {
    Serial.println("LoRa initialized successfully!");
  } else {
    Serial.print("LoRa init failed, code: ");
    Serial.println(state);
    Serial.println("ERROR: LoRa module not responding!");
    Serial.println("Continuing without LoRa...");
    return; // Don't halt, just continue
  }
  
  // Configure LoRa settings
  state = radio.setSpreadingFactor(7);
  Serial.print("  SF7: "); Serial.println(state);
  
  state = radio.setBandwidth(125.0);
  Serial.print("  BW125: "); Serial.println(state);
  
  state = radio.setCodingRate(5);
  Serial.print("  CR5: "); Serial.println(state);
  
  state = radio.setSyncWord(0x12);
  Serial.print("  SyncWord: "); Serial.println(state);
  
  state = radio.setOutputPower(22);
  Serial.print("  Power: "); Serial.println(state);
  
  // Set preamble length for better detection
  state = radio.setPreambleLength(8);
  Serial.print("  Preamble: "); Serial.println(state);
  
  Serial.println("LoRa configuration complete");
  
  // Set up interrupt for packet reception
  radio.setDio1Action(setFlag);
  
  // Start listening for incoming packets
  state = radio.startReceive();
  Serial.print("LoRa in receive mode, code: ");
  Serial.println(state);
}

static void initDisplay(const String &title) {
  Serial.println("Initializing display...");
  
  // Enable power to display and GPS (CRITICAL for GPS to work!)
  pinMode(VEXT_ENABLE, OUTPUT);
  digitalWrite(VEXT_ENABLE, HIGH);
  delay(500);  // Longer delay for power stabilization
  Serial.println("VEXT power ON");
  
  // TFT uses its own pins - don't initialize SPI here
  // The Adafruit library will handle it
  
  // Initialize ST7735 (using MINI160x80_PLUGIN variant for 80x160 display)
  tft.initR(INITR_MINI160x80_PLUGIN);
  Serial.println("ST7735 initialized!");
  
  tft.setRotation(1); // Landscape (160x80)
  
  // Fix inverted colors on this display
  tft.invertDisplay(false);
  
  // Clear screen completely - do this before backlight
  tft.fillScreen(ST77XX_BLACK);
  
  delay(50);  // Let display stabilize
  
  // Enable backlight AFTER init and clear
  pinMode(TFT_BL, OUTPUT);
  digitalWrite(TFT_BL, HIGH);
  Serial.println("Backlight ON");
  
  // Draw header with role (title only, IP will be added later for station)
  // Start at 1px from left to avoid right edge noise
  tft.setTextColor(ST77XX_YELLOW);
  tft.setTextSize(1);
  tft.setCursor(1, 1);
  tft.print(title);
  
  Serial.println("Display ready!");
}

// Track actuator states for beacon
static bool currentLedState = false;
static bool currentBuzzerState = false;

static void setActuators(bool ledOn, bool buzzerOn) {
  currentLedState = ledOn;
  currentBuzzerState = buzzerOn;
  
  if (LED_PIN >= 0) {
    digitalWrite(LED_PIN, ledOn ? HIGH : LOW);
  }
  if (BUZZER_PIN >= 0) {
    digitalWrite(BUZZER_PIN, buzzerOn ? HIGH : LOW);
  }
}


// -----------------------------------------------------------------------------
// PupBeacon behavior (dog-worn unit)
// -----------------------------------------------------------------------------

void setupPupBeacon() {
  Serial.println("\n=== PawTracker PupBeacon ===");
  
  initDisplay("PupBeacon");
  initLoRa();
  
  Serial.println("Initializing GPS and actuators...");

  if (LED_PIN >= 0) pinMode(LED_PIN, OUTPUT);
  if (BUZZER_PIN >= 0) pinMode(BUZZER_PIN, OUTPUT);
  setActuators(false, false);

  // Try to detect GPS baud rate
  uint32_t baudRates[] = {115200, 9600, 38400, 57600};
  bool gpsDetected = false;
  
  for (int i = 0; i < 4; i++) {
    Serial.print("Trying GPS at ");
    Serial.print(baudRates[i]);
    Serial.println(" baud...");
    
    GPSSerial.begin(baudRates[i], SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);
    delay(500);
    
    // Read GPS for 2 seconds and check if we get valid NMEA sentences
    uint32_t start = millis();
    int charsReceived = 0;
    int passedBefore = gps.passedChecksum();
    
    while (millis() - start < 2000) {
      while (GPSSerial.available() > 0) {
        char c = GPSSerial.read();
        charsReceived++;
        gps.encode(c);
      }
      delay(10);
    }
    
    int validSentences = gps.passedChecksum() - passedBefore;
    
    Serial.print("  Received ");
    Serial.print(charsReceived);
    Serial.print(" chars, ");
    Serial.print(validSentences);
    Serial.print(" valid NMEA sentences (checksum verified)");
    Serial.println();
    
    // Valid GPS data: must have characters AND valid NMEA sentences with correct checksums
    if (charsReceived > 100 && validSentences > 0) {
      Serial.print("GPS detected at ");
      Serial.print(baudRates[i]);
      Serial.println(" baud with valid NMEA data!");
      gpsDetected = true;
      break;
    }
    
    GPSSerial.end();
  }
  
  if (!gpsDetected) {
    Serial.println("WARNING: GPS not detected at any baud rate!");
    Serial.println("Defaulting to 115200 baud");
    GPSSerial.begin(115200, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);
  }
  
  Serial.println("PupBeacon setup complete!");

  tft.fillScreen(ST77XX_BLACK);
}

bool readGpsFix(float &lat, float &lng, float &hdop, uint8_t &sats, uint32_t timeoutMs) {
  uint32_t start = millis();
  int charsProcessed = 0;
  
  while (millis() - start < timeoutMs) {
    while (GPSSerial.available() > 0) {
      char c = GPSSerial.read();
      charsProcessed++;
      gps.encode(c);
    }
    if (gps.location.isUpdated() && gps.location.isValid()) {
      lat = gps.location.lat();
      lng = gps.location.lng();
      hdop = gps.hdop.hdop();
      sats = gps.satellites.value();
      Serial.print("GPS fix obtained: ");
      Serial.print(sats);
      Serial.println(" satellites");
      return true;
    }
    delay(10);
  }
  
  Serial.print("No GPS fix. Satellites visible: ");
  Serial.print(gps.satellites.value());
  Serial.print(", Valid sentences: ");
  Serial.print(gps.passedChecksum());
  Serial.print(", Failed: ");
  Serial.println(gps.failedChecksum());
  return false;
}

void loopPupBeacon() {
  static uint32_t lastSend = 0;
  static uint32_t lastRxTime = 0;
  static bool firstRun = true;
  static uint32_t randomOffset = random(0, 2000); // Random 0-2 second offset
  static uint8_t lastControlCmd = 0; // Track last control command received
  uint32_t now = millis();

  // GPS debugging - print stats every 5 seconds
  // Disabled for now
  /*
  static uint32_t lastGpsDebug = 0;
  if (now - lastGpsDebug > 5000) {
    lastGpsDebug = now;
    Serial.println("\n--- GPS Debug Info ---");
    Serial.print("Characters received: ");
    Serial.println(gps.charsProcessed());
    Serial.print("Sentences passed: ");
    Serial.println(gps.passedChecksum());
    Serial.print("Sentences failed: ");
    Serial.println(gps.failedChecksum());
    Serial.print("Satellites: ");
    Serial.println(gps.satellites.value());
    Serial.print("Satellites valid: ");
    Serial.println(gps.satellites.isValid() ? "YES" : "NO");
    Serial.print("Location valid: ");
    Serial.println(gps.location.isValid() ? "YES" : "NO");
    Serial.print("Location age: ");
    Serial.println(gps.location.age());
    Serial.print("HDOP: ");
    Serial.print(gps.hdop.hdop());
    Serial.print(" (valid: ");
    Serial.print(gps.hdop.isValid() ? "YES" : "NO");
    Serial.println(")");
    Serial.print("Date valid: ");
    Serial.println(gps.date.isValid() ? "YES" : "NO");
    Serial.print("Time valid: ");
    Serial.println(gps.time.isValid() ? "YES" : "NO");
    
    if (gps.location.isValid()) {
      Serial.print("Lat: ");
      Serial.print(gps.location.lat(), 6);
      Serial.print(", Lon: ");
      Serial.println(gps.location.lng(), 6);
    } else {
      Serial.println("GPS Status: Receiving NMEA but NO satellite signals!");
      Serial.println("Possible causes:");
      Serial.println("  - Device is indoors (GPS needs sky view)");
      Serial.println("  - Antenna blocked or damaged");
      Serial.println("  - Cold start (can take 30+ seconds outside)");
    }
    Serial.println("---------------------\n");
  }
  */

  // Update display periodically
  static uint32_t lastDisplayUpdate = 0;
  static bool lastGpsValid = false;
  static uint8_t lastSats = 0;
  static float lastVoltage = 0;
  static uint32_t lastElapsed = 0;
  
  if (now - lastDisplayUpdate > 1000) {
    lastDisplayUpdate = now;
    
    bool gpsValid = gps.location.isValid();
    uint8_t sats = gps.satellites.value();
    float voltage = readBatteryVoltage();
    uint32_t elapsed = (lastRxTime == 0) ? 0 : (now - lastRxTime) / 1000;
    
    // Only redraw if values changed
    if (gpsValid != lastGpsValid || sats != lastSats) {
      tft.fillRect(32, 14, 128, 8, ST77XX_BLACK);
      tft.setTextSize(1);
      tft.setCursor(32, 14);
      if (gpsValid) {
        tft.setTextColor(ST77XX_GREEN);
        tft.print("FIX ");
        tft.setTextColor(ST77XX_WHITE);
        tft.print(sats);
        // tft.print("sat");
      } else {
        tft.setTextColor(ST77XX_RED);
        tft.print("NO FIX ");
        tft.setTextColor(ST77XX_YELLOW);
        tft.print(sats);
        // tft.print("sat");
      }
      lastGpsValid = gpsValid;
      lastSats = sats;
    }
    
    // Only redraw battery if changed significantly
    if (abs(voltage - lastVoltage) > 0.05) {
      tft.fillRect(38, 28, 120, 8, ST77XX_BLACK);
      tft.setCursor(38, 28);
      tft.setTextColor(voltage > 3.7 ? ST77XX_GREEN : ST77XX_YELLOW);
      tft.print(voltage, 2);
      tft.print("V");
      lastVoltage = voltage;
    }
    
    // Only redraw RX time if changed
    if (elapsed != lastElapsed || (lastRxTime == 0 && elapsed == 0)) {
      tft.fillRect(62, 42, 96, 8, ST77XX_BLACK);
      tft.setCursor(62, 42);
      if (lastRxTime == 0) {
        tft.setTextColor(ST77XX_YELLOW);
        tft.print("--");
      } else {
        if (elapsed > 60) {
          tft.setTextColor(ST77XX_RED);
          tft.print(elapsed / 60);
          tft.print("m");
        } else {
          tft.setTextColor(ST77XX_GREEN);
          tft.print(elapsed);
          tft.print("s   ");
        }
      }
      lastElapsed = elapsed;
    }
    
    // Draw labels only once (on first run)
    static bool labelsDrawn = false;
    if (!labelsDrawn) {
      tft.setTextSize(1);
      tft.setTextColor(ST77XX_CYAN);
      tft.setCursor(2, 14);
      tft.print("GPS: ");
      tft.setCursor(2, 28);
      tft.print("Batt: ");
      tft.setCursor(2, 42);
      tft.print("Last RX: ");
      labelsDrawn = true;
    }
  }

  // Don't sleep on first run, and check if enough time has passed
  if (!firstRun && (now - lastSend < BEACON_SEND_INTERVAL_MS + randomOffset)) {
    // Update GPS data while waiting
    while (GPSSerial.available() > 0) {
      gps.encode(GPSSerial.read());
    }
    delay(100);
    return;
  }

  firstRun = false;
  lastSend = now;
  randomOffset = random(0, 2000); // New random offset for next cycle

  // Wake: quickly get GPS fix, send via LoRa, then potentially receive control
  float lat = 0, lng = 0;
  float hdop = 0;
  uint8_t sats = 0;

  bool gotFix = readGpsFix(lat, lng, hdop, sats, BEACON_AWAKE_WINDOW_MS);

  BeaconMessage msg{};
  msg.msgType = 0x01;
  msg.latitude = gotFix ? lat : 0.0;
  msg.longitude = gotFix ? lng : 0.0;
  msg.hdop = gotFix ? hdop : 0.0f;
  msg.sats = sats;
  msg.batteryVoltage = readBatteryVoltage();
  msg.ledOn = currentLedState ? 1 : 0;
  msg.buzzerOn = currentBuzzerState ? 1 : 0;
  msg.lastControlReceived = lastControlCmd;
  msg.speed = (gotFix && gps.speed.isValid()) ? gps.speed.kmph() : 0.0f;
  msg.altitude = (gotFix && gps.altitude.isValid()) ? gps.altitude.meters() : 0.0f;
  msg.uptime = (millis() - bootTime) / 1000; // Uptime in seconds

  // Send via LoRa
  Serial.print("Sending beacon, size: ");
  Serial.print(sizeof(msg));
  Serial.println(" bytes");
  
  int state = radio.transmit((uint8_t *)&msg, sizeof(msg));
  if (state == RADIOLIB_ERR_NONE) {
    Serial.println("Beacon sent successfully");
  } else {
    Serial.print("Send failed, code: ");
    Serial.println(state);
  }

  // Small delay to let radio settle after transmit
  delay(50);
  
  // Listen for control packets after sending
  int rxState = radio.startReceive();
  Serial.print("Listening for control (startReceive code: ");
  Serial.print(rxState);
  Serial.println(")...");
  
  uint32_t listenStart = millis();
  while (millis() - listenStart < 500) {
    ControlMessage ctrl{};
    int state = radio.readData((uint8_t *)&ctrl, sizeof(ctrl));
    
    if (state == RADIOLIB_ERR_NONE) {
      Serial.print("Control received! msgType: 0x");
      Serial.println(ctrl.msgType, HEX);
      if (ctrl.msgType == 0x10) {
        setActuators(ctrl.ledOn != 0, ctrl.buzzerOn != 0);
        lastRxTime = millis();
        
        // Track what was received: 1=LED, 2=Buzzer, 3=Both
        lastControlCmd = 0;
        if (ctrl.ledOn) lastControlCmd |= 0x01;
        if (ctrl.buzzerOn) lastControlCmd |= 0x02;
        
        Serial.print("Command received: ");
        if (ctrl.ledOn && ctrl.buzzerOn) Serial.println("LED+Buzzer ON");
        else if (ctrl.ledOn) Serial.println("LED ON");
        else if (ctrl.buzzerOn) Serial.println("Buzzer ON");
        else Serial.println("All OFF");
      }
      break; // Exit listen loop after receiving
    } else if (state != RADIOLIB_ERR_RX_TIMEOUT) {
      Serial.print("Read error: ");
      Serial.println(state);
    }
    delay(10);
  }

  // After short active window go back to deep sleep
  // esp_sleep_enable_timer_wakeup((uint64_t)BEACON_SEND_INTERVAL_MS * 1000ULL);
  // esp_deep_sleep_start();
}

// -----------------------------------------------------------------------------
// PupStation behavior (human-carried unit)
// -----------------------------------------------------------------------------

// NOTE: For now we'll just print to Serial and display; WiFi/web UI can be
// added in a later iteration.

void setupWiFiAndWebServer() {
  Serial.println("\nInitializing WiFi...");
  
  // Initialize LittleFS
  if (!LittleFS.begin(true)) {
    Serial.println("LittleFS mount failed!");
  } else {
    Serial.println("LittleFS mounted successfully");
  }
  
  // Update display
  tft.fillRect(0, 45, 160, 15, ST77XX_BLACK);
  tft.setTextSize(1);
  tft.setTextColor(ST77XX_YELLOW);
  tft.setCursor(5, 45);
  tft.println("WiFi connecting...");
  
  // Set WiFiManager timeout to 180 seconds
  wifiManager.setConfigPortalTimeout(180);
  
  // Try to connect to saved WiFi or start config portal
  if (!wifiManager.autoConnect("PawTracker-Setup")) {
    Serial.println("Failed to connect, restarting...");
    tft.fillRect(0, 45, 160, 15, ST77XX_BLACK);
    tft.setCursor(5, 45);
    tft.setTextColor(ST77XX_RED);
    tft.println("WiFi failed!");
    delay(3000);
    ESP.restart();
  }
  
  Serial.println("WiFi connected!");
  Serial.print("IP address: ");
  Serial.println(WiFi.localIP());
  
  // Set up mDNS
  if (MDNS.begin("pawtracker")) {
    Serial.println("mDNS responder started");
    Serial.println("Access via: http://pawtracker.local");
    MDNS.addService("http", "tcp", 80);
  } else {
    Serial.println("Error setting up mDNS");
  }
  
  // Update display with mDNS name
  tft.fillRect(0, 45, 160, 25, ST77XX_BLACK);
  tft.setCursor(5, 45);
  tft.setTextColor(ST77XX_GREEN);
  tft.println("WiFi OK");
  tft.setCursor(5, 55);
  tft.setTextColor(ST77XX_CYAN);
  tft.setTextSize(1);
  tft.println("pawtracker.local");
  
  // Setup web server routes
  
  // API endpoint to get JSON data (define before static file handler)
  server.on("/api/data", HTTP_GET, [](AsyncWebServerRequest *request){
    String json = "{";
    json += "\"hasData\":" + String(latestBeacon.hasData ? "true" : "false") + ",";
    json += "\"latitude\":" + String(latestBeacon.latitude, 6) + ",";
    json += "\"longitude\":" + String(latestBeacon.longitude, 6) + ",";
    json += "\"hdop\":" + String(latestBeacon.hdop, 2) + ",";
    json += "\"sats\":" + String(latestBeacon.sats) + ",";
    json += "\"battery\":" + String(latestBeacon.batteryVoltage, 2) + ",";
    json += "\"rssi\":" + String(latestBeacon.rssi, 1) + ",";
    json += "\"snr\":" + String(latestBeacon.snr, 1) + ",";
    json += "\"ledOn\":" + String(latestBeacon.ledOn ? "true" : "false") + ",";
    json += "\"buzzerOn\":" + String(latestBeacon.buzzerOn ? "true" : "false") + ",";
    json += "\"lastControlReceived\":" + String(latestBeacon.lastControlReceived) + ",";
    json += "\"speed\":" + String(latestBeacon.speed, 2) + ",";
    json += "\"altitude\":" + String(latestBeacon.altitude, 1) + ",";
    json += "\"lastUpdate\":" + String(latestBeacon.lastUpdate) + ",";
    json += "\"station\":{";
    json += "\"hasValidFix\":" + String(stationLocation.hasValidFix ? "true" : "false") + ",";
    json += "\"latitude\":" + String(stationLocation.latitude, 6) + ",";
    json += "\"longitude\":" + String(stationLocation.longitude, 6) + ",";
    json += "\"hdop\":" + String(stationLocation.hdop, 2) + ",";
    json += "\"sats\":" + String(stationLocation.sats) + ",";
    json += "\"altitude\":" + String(stationLocation.altitude, 1) + ",";
    json += "\"lastUpdate\":" + String(stationLocation.lastUpdate);
    json += "}";
    json += "}";
    request->send(200, "application/json", json);
  });
  
  // Control endpoints
  server.on("/led", HTTP_GET, [](AsyncWebServerRequest *request){
    Serial.println("LED toggle requested via web");
    // Toggle LED state
    beaconControl.ledOn = !beaconControl.ledOn;
    // Mark control as pending - will be sent after next beacon reception
    beaconControl.pendingControl = true;
    Serial.print("LED set to: ");
    Serial.println(beaconControl.ledOn ? "ON" : "OFF");
    request->send(200, "text/plain", "OK");
  });
  
  server.on("/buzzer", HTTP_GET, [](AsyncWebServerRequest *request){
    Serial.println("Buzzer toggle requested via web");
    // Toggle buzzer state
    beaconControl.buzzerOn = !beaconControl.buzzerOn;
    // Mark control as pending - will be sent after next beacon reception
    beaconControl.pendingControl = true;
    Serial.print("Buzzer set to: ");
    Serial.println(beaconControl.buzzerOn ? "ON" : "OFF");
    request->send(200, "text/plain", "OK");
  });
  
  server.on("/reset-wifi", HTTP_GET, [](AsyncWebServerRequest *request){
    Serial.println("WiFi reset requested via web");
    request->send(200, "text/plain", "Resetting WiFi and rebooting...");
    
    // Reset WiFi credentials
    wifiManager.resetSettings();
    Serial.println("WiFi credentials cleared");
    
    // Delay to allow response to be sent
    delay(1000);
    
    // Reboot the device
    Serial.println("Rebooting...");
    ESP.restart();
  });
  
  // Statistics API endpoints - IMPORTANT: More specific routes first!
  
  // Export stats file as CSV
  server.on("/api/stats/export", HTTP_GET, [](AsyncWebServerRequest *request){
    if (!LittleFS.exists(STATS_FILE)) {
      request->send(404, "text/plain", "Stats file not found");
      return;
    }
    
    File file = LittleFS.open(STATS_FILE, FILE_READ);
    if (!file) {
      request->send(500, "text/plain", "Failed to open stats file");
      return;
    }
    
    AsyncWebServerResponse *response = request->beginResponse(file, STATS_FILE, "text/csv", true);
    response->addHeader("Content-Disposition", "attachment; filename=stats.csv");
    request->send(response);
  });
  
  // Clear stats file
  server.on("/api/stats/clear", HTTP_POST, [](AsyncWebServerRequest *request){
    LittleFS.remove(STATS_FILE);
    Serial.println("Stats file cleared");
    
    // Reinitialize with fresh log
    logStats();
    
    request->send(200, "text/plain", "Stats cleared");
  });
  
  // Get stats as JSON (for dashboard)
  server.on("/api/stats", HTTP_GET, [](AsyncWebServerRequest *request){
    uint32_t now = millis();
    uint32_t uptime = (now - bootTime) / 1000;
    float stationBattery = readBatteryVoltage();
    uint32_t beaconLastSeen = latestBeacon.hasData ? (now - latestBeacon.lastUpdate) / 1000 : 0;
    
    // Read stats file to calculate aggregates
    float stationAvgBat = 0, stationMinBat = 5.0, stationMaxBat = 0;
    float beaconAvgBat = 0, beaconMinBat = 5.0, beaconMaxBat = 0;
    int dataPoints = 0;
    uint32_t totalUptime = 0;
    
    File file = LittleFS.open(STATS_FILE, FILE_READ);
    if (file) {
      file.readStringUntil('\n'); // Skip header
      while (file.available()) {
        String line = file.readStringUntil('\n');
        if (line.length() > 0) {
          // Parse: timestamp,stationUptime,stationBattery,beaconUptime,beaconBattery
          int idx1 = line.indexOf(',');
          int idx2 = line.indexOf(',', idx1 + 1);
          int idx3 = line.indexOf(',', idx2 + 1);
          int idx4 = line.indexOf(',', idx3 + 1);
          
          if (idx1 > 0 && idx2 > 0 && idx3 > 0 && idx4 > 0) {
            uint32_t uptimeVal = line.substring(idx1 + 1, idx2).toInt();
            float staBat = line.substring(idx2 + 1, idx3).toFloat();
            float beaBat = line.substring(idx4 + 1).toFloat();
            
            totalUptime = max(totalUptime, uptimeVal);
            stationAvgBat += staBat;
            beaconAvgBat += beaBat;
            stationMinBat = min(stationMinBat, staBat);
            stationMaxBat = max(stationMaxBat, staBat);
            if (beaBat > 0) {
              beaconMinBat = min(beaconMinBat, beaBat);
              beaconMaxBat = max(beaconMaxBat, beaBat);
            }
            dataPoints++;
          }
        }
      }
      file.close();
    }
    
    if (dataPoints > 0) {
      stationAvgBat /= dataPoints;
      beaconAvgBat /= dataPoints;
    }
    
    // Get stats file size
    size_t statsFileSize = 0;
    File statsFile = LittleFS.open(STATS_FILE, FILE_READ);
    if (statsFile) {
      statsFileSize = statsFile.size();
      statsFile.close();
    }
    
    // Build JSON response
    String json = "{";
    json += "\"memory\":{";
    json += "\"freeHeap\":" + String(ESP.getFreeHeap()) + ",";
    json += "\"totalHeap\":" + String(ESP.getHeapSize()) + ",";
    json += "\"freePsram\":" + String(ESP.getFreePsram()) + ",";
    json += "\"totalPsram\":" + String(ESP.getPsramSize()) + ",";
    json += "\"sketchSize\":" + String(ESP.getSketchSize()) + ",";
    json += "\"freeSketch\":" + String(ESP.getFreeSketchSpace()) + ",";
    json += "\"statsFileSize\":" + String(statsFileSize);
    json += "},";
    json += "\"station\":{";
    json += "\"uptime\":" + String(uptime) + ",";
    json += "\"battery\":" + String(stationBattery, 2) + ",";
    json += "\"rebootCount\":" + String(rebootCount);
    json += "},";
    json += "\"beacon\":{";
    json += "\"battery\":" + String(latestBeacon.batteryVoltage, 2) + ",";
    json += "\"rssi\":" + String(latestBeacon.rssi, 1) + ",";
    json += "\"lastSeen\":" + String(beaconLastSeen);
    json += "},";
    json += "\"stats\":{";
    json += "\"station\":{";
    json += "\"avgBattery\":" + String(stationAvgBat, 2) + ",";
    json += "\"minBattery\":" + String(stationMinBat, 2) + ",";
    json += "\"maxBattery\":" + String(stationMaxBat, 2) + ",";
    json += "\"totalUptime\":" + String(totalUptime);
    json += "},";
    json += "\"beacon\":{";
    json += "\"avgBattery\":" + String(beaconAvgBat, 2) + ",";
    json += "\"minBattery\":" + String(beaconMinBat, 2) + ",";
    json += "\"maxBattery\":" + String(beaconMaxBat, 2) + ",";
    json += "\"dataPoints\":" + String(dataPoints);
    json += "}";
    json += "},";
    json += "\"history\":[";
    
    // Read history data (last 100 entries)
    file = LittleFS.open(STATS_FILE, FILE_READ);
    if (file) {
      file.readStringUntil('\n'); // Skip header
      String entries[100];
      int entryCount = 0;
      
      while (file.available() && entryCount < 100) {
        String line = file.readStringUntil('\n');
        if (line.length() > 0) {
          // Parse: timestamp,stationUptime,stationBattery,beaconUptime,beaconBattery
          int idx1 = line.indexOf(',');
          int idx2 = line.indexOf(',', idx1 + 1);
          int idx3 = line.indexOf(',', idx2 + 1);
          int idx4 = line.indexOf(',', idx3 + 1);
          
          if (idx1 > 0 && idx2 > 0 && idx3 > 0 && idx4 > 0) {
            String entry = "{";
            entry += "\"timestamp\":" + line.substring(0, idx1) + ",";
            entry += "\"stationUptime\":" + line.substring(idx1 + 1, idx2) + ",";
            entry += "\"stationBattery\":" + line.substring(idx2 + 1, idx3) + ",";
            entry += "\"beaconUptime\":" + line.substring(idx3 + 1, idx4) + ",";
            entry += "\"beaconBattery\":" + line.substring(idx4 + 1);
            entry += "}";
            entries[entryCount++] = entry;
          }
        }
      }
      file.close();
      
      // Add entries to JSON (most recent first)
      for (int i = max(0, entryCount - 100); i < entryCount; i++) {
        if (i > max(0, entryCount - 100)) json += ",";
        json += entries[i];
      }
    }
    
    json += "]";
    json += "}";
    
    request->send(200, "application/json", json);
  });
  
  // Handle favicon to prevent 404 errors
  server.on("/favicon.ico", HTTP_GET, [](AsyncWebServerRequest *request){
    // Return empty 204 No Content to prevent errors
    request->send(204);
  });
  
  // Serve static files from LittleFS (must be after API routes)
  // Disable gzip compression lookup to avoid .gz file errors
  server.serveStatic("/", LittleFS, "/")
    .setDefaultFile("index.html")
    .setCacheControl("max-age=600")
    .setTemplateProcessor(NULL); // Disable template processing
  
  if (!serverStarted) {
    server.begin();
    serverStarted = true;
    Serial.println("Web server started on port 80");
    Serial.println("Access via: http://pawtracker.local or http://" + WiFi.localIP().toString());
  } else {
    Serial.println("Web server already running");
  }
}

void setupPupStation() {
  Serial.println("\n=== PawTracker PupStation ===");
  
  initDisplay("PupStation");
  initLoRa();
  
  Serial.println("Initializing actuators and GPS...");

  if (LED_PIN >= 0) pinMode(LED_PIN, OUTPUT);
  if (BUZZER_PIN >= 0) pinMode(BUZZER_PIN, OUTPUT);
  setActuators(false, false);

  // Initialize GPS for station
  GPSSerial.begin(115200, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);
  Serial.println("Station GPS initialized at 115200 baud");

  // Setup WiFi and web server
  setupWiFiAndWebServer();
  
  // Initialize statistics tracking
  initStats();

  Serial.println("PupStation ready, listening continuously for beacons...");
  Serial.println("PupStation setup complete!");

  tft.fillScreen(ST77XX_BLACK);
}

void handleIncomingBeacon(const BeaconMessage &msg, float rssi, float snr) {
  Serial.println("\n=== BEACON RECEIVED ===");
  
  // Validate data ranges
  bool validData = true;
  if (msg.latitude < -90.0 || msg.latitude > 90.0) validData = false;
  if (msg.longitude < -180.0 || msg.longitude > 180.0) validData = false;
  if (msg.sats > 50) validData = false;
  
  if (!validData) {
    Serial.println("WARNING: Invalid GPS data received!");
    Serial.print("Raw values - Lat: ");
    Serial.print(msg.latitude);
    Serial.print(", Lon: ");
    Serial.print(msg.longitude);
    Serial.print(", Sats: ");
    Serial.println(msg.sats);
    return;
  }
  
  // Store in global structure for web server
  latestBeacon.latitude = msg.latitude;
  latestBeacon.longitude = msg.longitude;
  latestBeacon.hdop = msg.hdop;
  latestBeacon.sats = msg.sats;
  latestBeacon.batteryVoltage = msg.batteryVoltage;
  latestBeacon.ledOn = msg.ledOn;
  latestBeacon.buzzerOn = msg.buzzerOn;
  latestBeacon.lastControlReceived = msg.lastControlReceived;
  latestBeacon.speed = msg.speed;
  latestBeacon.altitude = msg.altitude;
  latestBeacon.uptime = msg.uptime;
  latestBeacon.lastUpdate = millis();
  latestBeacon.rssi = rssi;
  latestBeacon.snr = snr;
  latestBeacon.hasData = true;
  
  // System Info
  Serial.print("Uptime:       ");
  uint32_t uptimeSeconds = msg.uptime;
  uint32_t days = uptimeSeconds / 86400;
  uint32_t hours = (uptimeSeconds % 86400) / 3600;
  uint32_t minutes = (uptimeSeconds % 3600) / 60;
  uint32_t seconds = uptimeSeconds % 60;
  if (days > 0) {
    Serial.print(days);
    Serial.print("d ");
  }
  if (hours > 0 || days > 0) {
    Serial.print(hours);
    Serial.print("h ");
  }
  Serial.print(minutes);
  Serial.print("m ");
  Serial.print(seconds);
  Serial.println("s");
  Serial.println();
  
  // GPS Data
  Serial.print("Latitude:     ");
  Serial.print(msg.latitude, 6);
  Serial.println("°");
  Serial.print("Longitude:    ");
  Serial.print(msg.longitude, 6);
  Serial.println("°");
  Serial.print("Altitude:     ");
  Serial.print(msg.altitude, 1);
  Serial.println(" m");
  Serial.print("Speed:        ");
  Serial.print(msg.speed, 1);
  Serial.println(" km/h");
  Serial.print("Satellites:   ");
  Serial.println(msg.sats);
  Serial.print("HDOP:         ");
  Serial.println(msg.hdop, 1);
  
  // Power & Signal
  Serial.print("Battery:      ");
  Serial.print(msg.batteryVoltage, 2);
  Serial.println(" V");
  Serial.print("RSSI:         ");
  Serial.print(rssi, 1);
  Serial.println(" dBm");
  Serial.print("SNR:          ");
  Serial.print(snr, 1);
  Serial.println(" dB");
  
  // Control Status
  Serial.print("LED:          ");
  Serial.println(msg.ledOn ? "ON" : "OFF");
  Serial.print("Buzzer:       ");
  Serial.println(msg.buzzerOn ? "ON" : "OFF");
  Serial.print("Last Control: ");
  switch(msg.lastControlReceived) {
    case 0: Serial.println("None"); break;
    case 1: Serial.println("LED"); break;
    case 2: Serial.println("Buzzer"); break;
    case 3: Serial.println("Both"); break;
    default: Serial.println("Unknown");
  }
  
  Serial.println("=======================\n");
}

void sendControl(bool ledOn, bool buzzerOn) {
  ControlMessage ctrl{};
  ctrl.msgType = 0x10;
  ctrl.ledOn = ledOn ? 1 : 0;
  ctrl.buzzerOn = buzzerOn ? 1 : 0;

  Serial.print("Sending control (LED:");
  Serial.print(ledOn);
  Serial.print(", Buzzer:");
  Serial.print(buzzerOn);
  Serial.println(")...");
  
  int state = radio.transmit((uint8_t *)&ctrl, sizeof(ctrl));
  if (state == RADIOLIB_ERR_NONE) {
    Serial.println("Control sent");
  } else {
    Serial.print("Control send failed, code: ");
    Serial.println(state);
  }
  
  // Small delay after transmit
  delay(50);
}

void loopPupStation() {
  uint32_t now = millis();
  
  // Update station GPS location
  static uint32_t lastGpsRead = 0;
  if (now - lastGpsRead > 1000) { // Read GPS every second
    lastGpsRead = now;
    
    while (GPSSerial.available() > 0) {
      char c = GPSSerial.read();
      gps.encode(c);
    }
    
    if (gps.location.isUpdated() && gps.location.isValid()) {
      stationLocation.latitude = gps.location.lat();
      stationLocation.longitude = gps.location.lng();
      stationLocation.hdop = gps.hdop.hdop();
      stationLocation.sats = gps.satellites.value();
      stationLocation.altitude = gps.altitude.isValid() ? gps.altitude.meters() : 0.0f;
      stationLocation.hasValidFix = true;
      stationLocation.lastUpdate = now;
    }
  }
  
  // Update display periodically
  static uint32_t lastDisplayUpdate = 0;
  static bool lastBeaconHasData = false;
  static bool lastStationFix = false;
  static float lastStationVoltage = 0;
  static float lastBeaconVoltage = 0;
  static uint32_t lastElapsed = 0;
  static int lastSignalPercent = -1;
  
  if (now - lastDisplayUpdate > 1000) {
    lastDisplayUpdate = now;
    
    float stationVoltage = readBatteryVoltage();
    uint32_t elapsed = latestBeacon.hasData ? (now - latestBeacon.lastUpdate) / 1000 : 0;
    
    // Calculate signal strength percentage from RSSI
    // RSSI range: -30 (excellent) to -120 (worst)
    int signalPercent = 0;
    if (latestBeacon.hasData && elapsed <= 60) {
      // Map RSSI from -120..-30 to 0..100%
      signalPercent = constrain(map((int)latestBeacon.rssi, -120, -30, 0, 100), 0, 100);
    }
    
    // Line 1: IP address on same line as title (draw once after WiFi connected)
    static bool ipDrawn = false;
    if (!ipDrawn && WiFi.status() == WL_CONNECTED) {
      tft.setCursor(75, 2);
      tft.setTextColor(ST77XX_GREEN);
      tft.setTextSize(1);
      tft.print(WiFi.localIP());
      ipDrawn = true;
    }
    
    // Line 2: Paw GPS + Battery (y=14)
    // Check if beacon has valid GPS fix (non-zero coords and satellites)
    bool beaconHasValidGps = (latestBeacon.hasData && 
                              latestBeacon.latitude != 0.0 && 
                              latestBeacon.longitude != 0.0 && 
                              latestBeacon.sats > 0);
    
    static bool lastBeaconValidGps = false;
    bool beaconGpsChanged = (beaconHasValidGps != lastBeaconValidGps) || (latestBeacon.hasData != lastBeaconHasData);
    bool beaconBatChanged = (abs(latestBeacon.batteryVoltage - lastBeaconVoltage) > 0.05 || 
                             (latestBeacon.hasData && lastBeaconVoltage == 0));
    
    if (beaconGpsChanged || beaconBatChanged) {
      tft.fillRect(30, 14, 130, 8, ST77XX_BLACK);
      tft.setTextSize(1);
      tft.setCursor(30, 14);
      
      // Beacon GPS status
      if (beaconHasValidGps) {
        tft.setTextColor(ST77XX_GREEN);
        tft.print("Fix ");
        tft.setTextColor(ST77XX_WHITE);
        tft.print(latestBeacon.sats);
        // tft.print("sat");
      } else if (latestBeacon.hasData) {
        tft.setTextColor(ST77XX_YELLOW);
        tft.print("No Fix ");
        tft.setTextColor(ST77XX_RED);
        tft.print(latestBeacon.sats);
        // tft.print("sat");
      } else {
        tft.setTextColor(ST77XX_RED);
        tft.print("No Data");
      }
      
      lastBeaconValidGps = beaconHasValidGps;
      
      // Battery
      tft.setTextColor(ST77XX_CYAN);
      tft.setCursor(90, 14);
      tft.print("Bat: ");
      if (latestBeacon.hasData) {
        tft.setTextColor(latestBeacon.batteryVoltage > 3.7 ? ST77XX_GREEN : ST77XX_YELLOW);
        tft.print(latestBeacon.batteryVoltage, 2);
        tft.print("V");
      } else {
        tft.setTextColor(ST77XX_RED);
        tft.print("--V");
      }
      
      lastBeaconHasData = latestBeacon.hasData;
      lastBeaconVoltage = latestBeacon.batteryVoltage;
    }
    
    // Line 3: Sta GPS + Battery (y=26)
    // Check if station has valid GPS fix (non-zero coords and satellites)
    bool stationHasValidGps = (stationLocation.hasValidFix && 
                               stationLocation.latitude != 0.0 && 
                               stationLocation.longitude != 0.0 && 
                               stationLocation.sats > 0);
    
    static bool lastStationValidGps = false;
    static uint8_t lastStationSats = 0;
    bool stationGpsChanged = (stationHasValidGps != lastStationValidGps) || 
                             (stationLocation.sats != lastStationSats) ||
                             (stationLocation.hasValidFix != lastStationFix);
    bool stationBatChanged = (abs(stationVoltage - lastStationVoltage) > 0.05);
    
    if (stationGpsChanged || stationBatChanged) {
      tft.fillRect(30, 26, 130, 8, ST77XX_BLACK);
      tft.setTextSize(1);
      tft.setCursor(30, 26);
      
      // Station GPS status
      if (stationHasValidGps) {
        tft.setTextColor(ST77XX_GREEN);
        tft.print("Fix ");
        tft.setTextColor(ST77XX_WHITE);
        tft.print(stationLocation.sats);
        // tft.print("sat");
      } else if (stationLocation.hasValidFix || stationLocation.sats > 0) {
        tft.setTextColor(ST77XX_YELLOW);
        tft.print("No Fix ");
        tft.setTextColor(ST77XX_RED);
        tft.print(stationLocation.sats);
        // tft.print("sat");
      } else {
        tft.setTextColor(ST77XX_RED);
        tft.print("No Data");
      }
      
      lastStationValidGps = stationHasValidGps;
      lastStationSats = stationLocation.sats;
      
      // Battery
      tft.setTextColor(ST77XX_CYAN);
      tft.setCursor(90, 26);
      tft.print("Bat: ");
      tft.setTextColor(stationVoltage > 3.7 ? ST77XX_GREEN : ST77XX_YELLOW);
      tft.print(stationVoltage, 2);
      tft.print("V");
      
      lastStationFix = stationLocation.hasValidFix;
      lastStationVoltage = stationVoltage;
    }
    
    // Line 4: Signal + Seen (y=38)
    bool signalChanged = (signalPercent != lastSignalPercent);
    bool timeChanged = (elapsed != lastElapsed);
    
    if (signalChanged || timeChanged) {
      tft.fillRect(45, 38, 115, 8, ST77XX_BLACK);
      tft.setTextSize(1);
      tft.setCursor(45, 38);
      
      // Signal strength percentage
      if (signalPercent >= 70) {
        tft.setTextColor(ST77XX_GREEN);
      } else if (signalPercent >= 40) {
        tft.setTextColor(ST77XX_YELLOW);
      } else if (signalPercent > 0) {
        tft.setTextColor(0xFD20); // Orange
      } else {
        tft.setTextColor(ST77XX_RED);
      }
      tft.print(signalPercent);
      tft.print("%");
      
      // Seen time
      tft.setTextColor(ST77XX_CYAN);
      tft.print("  Seen: ");
      if (!latestBeacon.hasData) {
        tft.setTextColor(ST77XX_RED);
        tft.print("--");
      } else if (elapsed > 60) {
        tft.setTextColor(ST77XX_RED);
        tft.print(elapsed / 60);
        tft.print("m");
      } else {
        tft.setTextColor(ST77XX_GREEN);
        tft.print(elapsed);
        tft.print("s");
      }
      
      lastSignalPercent = signalPercent;
      lastElapsed = elapsed;
    }
    
    // Draw static labels only once
    static bool labelsDrawn = false;
    if (!labelsDrawn) {
      tft.setTextColor(ST77XX_WHITE);
      tft.setTextSize(1);
      tft.setCursor(1, 1);
      tft.print("PupStation");
      tft.setTextSize(1);
      tft.setTextColor(ST77XX_CYAN);
      tft.setCursor(2, 14);
      tft.print("Paw:");
      tft.setCursor(2, 26);
      tft.print("Sta:");
      tft.setCursor(2, 38);
      tft.print("Signal:");
      labelsDrawn = true;
    }
  }
  
  // Check if a packet was received (interrupt-driven)
  if (receivedFlag) {
    receivedFlag = false; // Clear flag
    
    BeaconMessage msg{};
    memset(&msg, 0, sizeof(msg)); // Clear buffer first
    
    int state = radio.readData((uint8_t *)&msg, sizeof(msg));
    
    if (state == RADIOLIB_ERR_NONE) {
      // Packet received successfully - validate it
      if (msg.msgType == 0x01) {
        Serial.print("Packet received! msgType: 0x");
        Serial.print(msg.msgType, HEX);
        
        // Get RSSI and SNR
        float rssi = radio.getRSSI();
        float snr = radio.getSNR();
        Serial.print(", RSSI: ");
        Serial.print(rssi);
        Serial.print(" dBm, SNR: ");
        Serial.print(snr);
        Serial.println(" dB");
        
        handleIncomingBeacon(msg, rssi, snr);
        
        // Check if there's a pending control command to send
        if (beaconControl.pendingControl) {
          Serial.println("Sending pending control command...");
          delay(50); // Small delay to let beacon enter receive mode
          sendControl(beaconControl.ledOn, beaconControl.buzzerOn);
          beaconControl.pendingControl = false;
        }
      }
    }
    
    // Restart receive mode
    radio.startReceive();
  }
  
  // Periodic statistics logging
  if (now - lastStatsLog >= STATS_LOG_INTERVAL) {
    lastStatsLog = now;
    logStats();
  }
  
  // Small delay but don't block too long for web server
  delay(10);

  // Simple demo: use BOOT button to toggle buzzer, and another pin to toggle LED
  static bool ledState = false;
  static bool buzzerState = false;

  // Placeholder: you can hook this to buttons or a future web UI.
  // For now we don't send control automatically - just listen for beacons
  // TODO: Add button press detection to send control on demand
  
  // Periodic status
  static uint32_t lastStatus = 0;
  if (now - lastStatus > 10000) {
    lastStatus = now;
    Serial.println("PupStation listening...");
  }
}

// -----------------------------------------------------------------------------
// Shared setup/loop
// -----------------------------------------------------------------------------

void selectRoleOnBoot() {
  pinMode(ROLE_SELECT_PIN, INPUT_PULLUP);
  
  if (LED_PIN >= 0) {
    pinMode(LED_PIN, OUTPUT);
  }
  
  Serial.println("\nRole selection starting in 2 seconds...");
  Serial.println("Press and HOLD BOOT button to select PupStation");
  Serial.println("Leave button unpressed for PupBeacon");
  
  // Wait 2 seconds with LED blinking to avoid boot mode
  for (int i = 0; i < 4; i++) {
    if (LED_PIN >= 0) digitalWrite(LED_PIN, HIGH);
    delay(250);
    if (LED_PIN >= 0) digitalWrite(LED_PIN, LOW);
    delay(250);
  }
  
  // Now read the button
  Serial.println("\nReading button state NOW...");
  if (LED_PIN >= 0) digitalWrite(LED_PIN, HIGH); // LED on while reading
  delay(100); // settle
  
  int level = digitalRead(ROLE_SELECT_PIN);
  if (level == LOW) {  // Button pressed (pulled LOW)
    currentRole = ROLE_PUP_STATION;
    Serial.println("Button PRESSED - Selected: PupStation");
  } else {
    currentRole = ROLE_PUP_BEACON;
    Serial.println("Button NOT pressed - Selected: PupBeacon");
  }
  
  // Blink LED to confirm selection
  for (int i = 0; i < 3; i++) {
    if (LED_PIN >= 0) digitalWrite(LED_PIN, LOW);
    delay(100);
    if (LED_PIN >= 0) digitalWrite(LED_PIN, HIGH);
    delay(100);
  }
  if (LED_PIN >= 0) digitalWrite(LED_PIN, LOW);
}

void setup() {
  Serial.begin(115200);
  
  // Wait for USB CDC to be ready (ESP32-S3)
  unsigned long start = millis();
  while (!Serial && (millis() - start < 3000)) {
    delay(10);
  }
  delay(500);
  
  Serial.println("\n\n=== PawTracker Initializing ===");
  Serial.println("Firmware starting...");
  Serial.flush();
  
  selectRoleOnBoot();
  
  Serial.print("Selected role: ");
  Serial.println(currentRole == ROLE_PUP_BEACON ? "PupBeacon" : "PupStation");
  Serial.flush();

  if (currentRole == ROLE_PUP_BEACON) {
    setupPupBeacon();
  } else {
    setupPupStation();
  }
  
  Serial.println("=== Setup Complete ===\n");
}

void loop() {
  if (currentRole == ROLE_PUP_BEACON) {
    loopPupBeacon();
  } else {
    loopPupStation();
  }
}
