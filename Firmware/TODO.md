# PawTracker TODO List

## Future Features & Improvements

### 📍 Location History & Tracking
- ✅ **PawBeacon History Tracking**
  - ✅ Store beacon location history in a file (CSV or JSON format)
  - ✅ Include timestamp, lat/lon, speed, altitude for each point
  - Implement data retention policy (e.g., keep last 30 days)
  - Add date/time range selector in web interface
  - Visualize historical path on map with playback controls on a new web page and update header.html to add a button for it
  - Show statistics: total distance traveled, average speed, time in motion
  - ✅ Export history data as GPX or KML for use in other mapping apps

### 📊 Enhanced Map Features
- **Relative Altitude Display**
  - Change "Dog Altitude" to show altitude difference between Station and Beacon
  - Display as "+50m" (dog is higher) or "-30m" (dog is lower)
  - Useful for hiking/mountainous terrain to know if dog is above or below you
  - Add visual indicator (↑↓ arrows) for quick reference

- ✅ **Satellite View**
  - ✅ Add tile layer switcher to map
  - ✅ Include satellite/aerial imagery option
  - ✅ Options: Street map, Satellite, Terrain, Hybrid
  - Remember user's preference in localStorage

### 🏃 Movement Analytics
- ✅ **Max Speed Tracking**
  - ✅ Track and display maximum speed reached during session
  - Show max speed for current session and all-time record
  - Alert if dog exceeds certain speed threshold (possible escape detection)
  - Reset max speed at start of new tracking session

### 📝 Session Management
- **Automatic Session Detection**
  - Auto-start session when beacon movement detected (speed > threshold)
  - Auto-end session after X minutes of no movement
  - Store session metadata: start/end time, duration, distance covered
  
- **Manual Session Controls**
  - Add "Start Tracking" / "Stop Tracking" button
  - Session summary: duration, distance, avg speed, max speed, altitude change
  - Session history list with date/time
  - Ability to name/tag sessions (e.g., "Morning walk", "Park visit")

### 🔋 Power & Battery Management
- **Deep Sleep for Beacon**
  - Enable ESP32 deep sleep between transmissions
  - Wake on timer for GPS updates
  - Significantly extend battery life
  
- **Battery Monitoring**
  - Low battery warnings (visual + optional buzzer alert)
  - Battery percentage calculation based on voltage
  - Estimated time remaining display
  - Battery history graph

- ✅ **Uptime & Battery Status Tracking**
  - ✅ Log uptime and battery voltage over time to persistent storage (LittleFS)
  - ✅ Store data in CSV or JSON format for both Station and Beacon
  - ✅ Include timestamps, uptime duration, battery voltage readings
  - ✅ Implement circular buffer/data retention (e.g., last 7 days)
  - ✅ New "Statistics" web page with interactive charts
  - ✅ Visualize uptime trends: total uptime, reboot events, uptime percentage
  - ✅ Visualize battery health: voltage over time, discharge rate, charge cycles
  - Show system health metrics: longest uptime session, average battery voltage
  - Export stats data for external analysis
  - ✅ Data persists across reboots using LittleFS file storage

### 🔔 Alerts & Notifications
- **Geofencing**
  - Define safe zones on map
  - Alert when beacon leaves safe zone
  - Configurable radius and multiple zones
  
- **Distance Alerts**
  - Alert when distance exceeds threshold
  - Useful for keeping dog within range
  
- **Speed Alerts**
  - Alert on unusual high speed (possible chase/escape)
  - Alert on extended period of no movement (dog may be stuck)

### 🎨 UI/UX Improvements
- **Dashboard Widgets**
  - Add customizable widget layout
  - Quick stats cards (today's distance, time active, etc.)
  
- **Dark/Light Theme Toggle**
  - User preference for color scheme
  - Auto-detect system preference

- **Mobile App**
  - Progressive Web App (PWA) support
  - Add to home screen capability
  - Offline mode with cached map tiles

### 🛠️ Technical Improvements
- **Data Logging**
  - Log to SD card for longer history
  - Periodic sync to cloud storage (optional)
  
- **OTA Updates**
  - Over-the-air firmware updates
  - Update beacon firmware wirelessly
  
- ✅ **Multi-Beacon Support**
  - Identify Beacons with their own unique ID (using ESP32 chip ID)
  - Add a configuration page on Station (and add it to header.html) where we could give human readible names to each Beacon. Save this configuration in a permanent file, we will be adding more to this configuration section and file.
  - Track multiple pets simultaneously
  - Color-coded markers for each pet on map
  - Individual settings per beacon (control messages can target specific beacons)

### 🔐 Security & Backup
- **Data Export**
  - ✅ Export all tracking data
  - Backup/restore configuration
  
- **Authentication**
  - Optional password protection for web interface
  - Prevent unauthorized access

---

## Priority Levels
- 🔴 High: Session management, relative altitude, max speed
- 🟡 Medium: Location history, satellite view, deep sleep
- 🟢 Low: Multi-beacon, cloud sync, mobile app

## Notes
- Features should prioritize battery life and reliability
- Keep web interface lightweight for mobile browsers
- Consider storage limitations on ESP32 flash
