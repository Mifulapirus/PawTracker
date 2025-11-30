// Heltec Wireless Tracker V1.1 - ST7735 TFT Display Configuration
// This file configures TFT_eSPI for the specific hardware

#define ST7735_DRIVER      // Configure for ST7735 TFT

#define TFT_WIDTH  80
#define TFT_HEIGHT 160

// Pin definitions for Heltec Wireless Tracker V1.1
#define TFT_CS    38
#define TFT_DC    40  // Data/Command (RS)
#define TFT_RST   39  // Reset
#define TFT_MOSI  42  // SDA
#define TFT_SCLK  41  // SCL
#define TFT_MISO  -1  // Not used

// Use HSPI (SPI3) 
#define TFT_SPI_PORT HSPI_HOST

// Display orientation and colors
#define TFT_INVERSION_OFF
#define ST7735_GREENTAB160x80  // Specific tab color variant

// Fonts
#define LOAD_GLCD   // Font 1. Original Adafruit 8 pixel font
#define LOAD_FONT2  // Font 2. Small 16 pixel high font
#define LOAD_FONT4  // Font 4. Medium 26 pixel high font
#define LOAD_FONT6  // Font 6. Large 48 pixel font
#define LOAD_FONT7  // Font 7. 7 segment 48 pixel font
#define LOAD_FONT8  // Font 8. Large 75 pixel font
#define LOAD_GFXFF  // FreeFonts

#define SMOOTH_FONT

// SPI frequency
#define SPI_FREQUENCY  40000000
#define SPI_READ_FREQUENCY  16000000
