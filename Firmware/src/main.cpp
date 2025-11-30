#include <Arduino.h>
#include <TinyGPSPlus.h>
#include <SPI.h>
#include <RadioLib.h>
#include <Adafruit_GFX.h>
#include <Adafruit_ST7735.h>

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
const uint32_t BEACON_SEND_INTERVAL_MS = 10000;  // How often to send GPS fix
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
};

struct __attribute__((packed)) ControlMessage {
  uint8_t msgType;   // 0x10 = control from station
  uint8_t ledOn;     // 0 or 1
  uint8_t buzzerOn;  // 0 or 1
};

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
  delay(300);
  Serial.println("VEXT power ON");
  
  // TFT uses its own pins - don't initialize SPI here
  // The Adafruit library will handle it
  
  // Initialize ST7735 (using GREENTAB variant for 80x160 display)
  tft.initR(INITR_MINI160x80);
  Serial.println("ST7735 initialized!");
  
  tft.setRotation(1); // Landscape
  tft.fillScreen(ST77XX_BLACK);
  
  // Enable backlight AFTER init
  pinMode(TFT_BL, OUTPUT);
  digitalWrite(TFT_BL, HIGH);
  Serial.println("Backlight ON");
  
  // Draw header
  tft.setTextColor(ST77XX_WHITE);
  tft.setTextSize(2);
  tft.setCursor(5, 5);
  tft.println("PawTracker");
  
  tft.setTextSize(1);
  tft.setCursor(5, 30);
  tft.println(title);
  
  // Display battery voltage
  float voltage = readBatteryVoltage();
  tft.setCursor(5, 70);
  tft.setTextColor(ST77XX_CYAN);
  tft.print("Batt: ");
  tft.print(voltage, 2);
  tft.println("V");
  
  Serial.print("Battery voltage: ");
  Serial.print(voltage, 2);
  Serial.println("V");
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
  
  initDisplay("Role: PupBeacon");
  initLoRa();
  
  Serial.println("Initializing GPS and actuators...");

  if (LED_PIN >= 0) pinMode(LED_PIN, OUTPUT);
  if (BUZZER_PIN >= 0) pinMode(BUZZER_PIN, OUTPUT);
  setActuators(false, false);

  // UC6580 GPS uses 115200 baud
  GPSSerial.begin(115200, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);
  Serial.println("GPS Serial initialized at 115200 baud");
  Serial.println("PupBeacon setup complete!");
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
  static bool firstRun = true;
  static uint32_t randomOffset = random(0, 2000); // Random 0-2 second offset
  uint32_t now = millis();

  // Don't sleep on first run, and check if enough time has passed
  if (!firstRun && (now - lastSend < BEACON_SEND_INTERVAL_MS + randomOffset)) {
    // Not time yet, just delay a bit
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

  // Update display with GPS status
  tft.fillRect(0, 45, 160, 35, ST77XX_BLACK);
  tft.setTextSize(1);
  
  if (gotFix) {
    tft.setTextColor(ST77XX_GREEN);
    tft.setCursor(5, 45);
    tft.println("GPS: VALID FIX");
    tft.setCursor(5, 55);
    tft.print("Lat:");
    tft.println(lat, 4);
    tft.setCursor(5, 65);
    tft.print("Lon:");
    tft.println(lng, 4);
  } else {
    tft.setTextColor(ST77XX_RED);
    tft.setCursor(5, 45);
    tft.println("GPS: NO FIX");
    tft.setCursor(5, 55);
    tft.setTextColor(ST77XX_YELLOW);
    tft.print("Sats visible: ");
    tft.println(sats);
  }

  BeaconMessage msg{};
  msg.msgType = 0x01;
  msg.latitude = gotFix ? lat : 0.0;
  msg.longitude = gotFix ? lng : 0.0;
  msg.hdop = gotFix ? hdop : 0.0f;
  msg.sats = sats;
  msg.batteryVoltage = readBatteryVoltage();
  msg.ledOn = currentLedState ? 1 : 0;
  msg.buzzerOn = currentBuzzerState ? 1 : 0;

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

void setupPupStation() {
  Serial.println("\n=== PawTracker PupStation ===");
  
  initDisplay("Role: PupStation");
  initLoRa();
  
  Serial.println("Initializing actuators...");

  if (LED_PIN >= 0) pinMode(LED_PIN, OUTPUT);
  if (BUZZER_PIN >= 0) pinMode(BUZZER_PIN, OUTPUT);
  setActuators(true, false);

  Serial.println("PupStation ready, listening continuously for beacons...");
  Serial.println("PupStation setup complete!");
}

void handleIncomingBeacon(const BeaconMessage &msg) {
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
  
  Serial.print("Latitude:  ");
  Serial.println(msg.latitude, 6);
  Serial.print("Longitude: ");
  Serial.println(msg.longitude, 6);
  Serial.print("HDOP: ");
  Serial.print(msg.hdop, 1);
  Serial.print("  Satellites: ");
  Serial.println(msg.sats);
  Serial.print("Battery: ");
  Serial.print(msg.batteryVoltage, 2);
  Serial.print("V  LED: ");
  Serial.print(msg.ledOn ? "ON" : "OFF");
  Serial.print("  Buzzer: ");
  Serial.println(msg.buzzerOn ? "ON" : "OFF");
  Serial.println("=======================\n");
  
  // Update display only if data is valid
  if (validData) {
    tft.fillRect(0, 45, 160, 35, ST77XX_BLACK);
    tft.setTextSize(1);
    tft.setTextColor(ST77XX_GREEN);
    tft.setCursor(5, 45);
    tft.print("Lat:");
    tft.println(msg.latitude, 4);
    tft.setCursor(5, 55);
    tft.print("Lon:");
    tft.println(msg.longitude, 4);
    tft.setCursor(5, 65);
    tft.setTextColor(ST77XX_YELLOW);
    tft.print("Sat:");
    tft.print(msg.sats);
    tft.print(" ");
    tft.setTextColor(ST77XX_CYAN);
    tft.print(msg.batteryVoltage, 1);
    tft.print("V");
  }
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
        Serial.print(", RSSI: ");
        Serial.print(radio.getRSSI());
        Serial.print(" dBm, SNR: ");
        Serial.print(radio.getSNR());
        Serial.println(" dB");
        
        handleIncomingBeacon(msg);
      }
    }
    
    // Restart receive mode
    radio.startReceive();
  }
  
  // Always delay to avoid tight loop
  delay(100);

  // Simple demo: use BOOT button to toggle buzzer, and another pin to toggle LED
  static bool ledState = false;
  static bool buzzerState = false;

  // Placeholder: you can hook this to buttons or a future web UI.
  // For now we don't send control automatically - just listen for beacons
  // TODO: Add button press detection to send control on demand
  
  uint32_t now = millis();
  
  // Periodic status
  static uint32_t lastStatus = 0;
  if (now - lastStatus > 10000) {
    lastStatus = now;
    Serial.println("PupStation listening...");
  }
  
  // Update battery voltage on display every 5 seconds
  static uint32_t lastVoltageUpdate = 0;
  if (now - lastVoltageUpdate > 5000) {
    lastVoltageUpdate = now;
    float voltage = readBatteryVoltage();
    
    tft.fillRect(40, 70, 80, 8, ST77XX_BLACK);
    tft.setCursor(40, 70);
    tft.setTextColor(ST77XX_CYAN);
    tft.setTextSize(1);
    tft.print(voltage, 2);
    tft.print("V");
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
