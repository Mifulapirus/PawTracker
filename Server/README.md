# PawTracker Central Server

A login-protected web dashboard for receiving and displaying real-time GPS tracking data from PupStation devices.

## Features

- **Authentication**: Login-protected web interface with session management
- **Real-time Updates**: WebSocket support for live location updates
- **Interactive Map**: OpenStreetMap-based display of all tracked devices
- **Remote Control**: Send LED and buzzer commands to PupBeacons through their PupStations
- **Multi-Device Support**: Track multiple PupStations simultaneously
- **Device Management**: View device status, last seen time, battery levels, and signal strength
- **History Tracking**: Store and visualize location history for each tracker
- **Station View**: Firmware-style interface for each station - click on any station to see the same interface you'd get from accessing the device directly

## Technology Stack

**Backend:**
- Node.js with Express
- WebSocket (ws) for real-time communication
- bcrypt for password hashing
- express-session for authentication

**Frontend:**
- Vanilla JavaScript (no frameworks)
- Leaflet.js for interactive maps
- WebSocket client for live updates
- Responsive CSS design

## Installation

### Prerequisites

- Node.js 16+ and npm
- Internet access for the PupStations
- A server or computer to host the application

### Setup

1. **Navigate to the Server directory:**
   ```bash
   cd Server
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure environment variables:**
   ```bash
   cp .env.example .env
   ```

4. **Edit `.env` file:**
   ```
   PORT=3000
   SESSION_SECRET=your-secure-random-string-here
   ADMIN_USERNAME=admin
   ADMIN_PASSWORD=your-secure-password-here
   NODE_ENV=production
   ```

   **Important:** Change the default credentials and session secret in production!

5. **Start the server:**
   ```bash
   npm start
   ```

   For development with auto-restart:
   ```bash
   npm run dev
   ```

The server will start on `http://localhost:3000` (or the port you configured).

## Configuring PupStation Devices

Each PupStation needs to be configured to send data to your central server.

### Method 1: Via PupStation Web Interface

1. Connect to your PupStation's WiFi network or access it via `http://pawtracker.local`
2. Navigate to the server configuration page (you'll need to add this UI to the existing web interface)
3. Enter your server URL: `http://your-server-address:3000`
4. Save the configuration

### Method 2: Via API (Direct Configuration)

Send a POST request to the PupStation:

```bash
curl -X POST http://pawtracker.local/api/server/config \
  -d "serverUrl=http://your-server-address:3000"
```

### Verifying Configuration

Check the current server configuration:

```bash
curl http://pawtracker.local/api/server/config
```

Response:
```json
{
  "serverUrl": "http://your-server-address:3000",
  "deviceId": "A1B2C3D4E5F6",
  "enabled": true
}
```

## API Documentation

### Authentication Endpoints

#### POST `/api/login`
Login to the dashboard.

**Request:**
```json
{
  "username": "admin",
  "password": "your-password"
}
```

**Response:**
```json
{
  "success": true,
  "username": "admin"
}
```

#### POST `/api/logout`
Logout from the dashboard.

**Response:**
```json
{
  "success": true
}
```

#### GET `/api/auth/check`
Check if user is authenticated.

**Response:**
```json
{
  "authenticated": true,
  "username": "admin"
}
```

### Device Management Endpoints

#### POST `/api/device/register`
Register a new PupStation device (requires authentication).

**Request:**
```json
{
  "deviceId": "A1B2C3D4E5F6",
  "deviceName": "My PupStation"
}
```

**Response:**
```json
{
  "success": true,
  "deviceId": "A1B2C3D4E5F6"
}
```

#### POST `/api/device/beacon`
Submit beacon location data from a PupStation (no auth required for devices).

**Request:**
```json
{
  "deviceId": "A1B2C3D4E5F6",
  "beaconData": {
    "trackerId": "BEACON123",
    "latitude": 37.7749,
    "longitude": -122.4194,
    "hdop": 1.2,
    "sats": 12,
    "batteryVoltage": 3.8,
    "rssi": -65,
    "snr": 8.5,
    "ledOn": false,
    "buzzerOn": false,
    "speed": 5.2,
    "altitude": 100.5
  }
}
```

**Response:**
```json
{
  "success": true
}
```

#### GET `/api/devices`
Get all registered devices and their status (requires authentication).

**Response:**
```json
{
  "devices": [
    {
      "id": "A1B2C3D4E5F6",
      "name": "Station A1B2C3D4",
      "lastSeen": "2025-12-09T10:30:00.000Z",
      "location": {
        "latitude": 37.7749,
        "longitude": -122.4194,
        "hdop": 1.2,
        "sats": 12,
        "timestamp": "2025-12-09T10:30:00.000Z"
      },
      "controlState": {
        "ledOn": false,
        "buzzerOn": false
      }
    }
  ]
}
```

#### POST `/api/device/:deviceId/control`
Send control command to a device (requires authentication).

**Request:**
```json
{
  "ledOn": true,
  "buzzerOn": false
}
```

**Response:**
```json
{
  "success": true
}
```

#### GET `/api/device/:deviceId/control`
Poll for pending control commands (used by PupStations, no auth required).

**Response:**
```json
{
  "hasCommand": true,
  "ledOn": true,
  "buzzerOn": false
}
```

#### GET `/api/tracker/:trackerId/history`
Get location history for a specific tracker (requires authentication).

**Response:**
```json
{
  "trackerId": "BEACON123",
  "history": [
    {
      "latitude": 37.7749,
      "longitude": -122.4194,
      "hdop": 1.2,
      "sats": 12,
      "timestamp": "2025-12-09T10:25:00.000Z",
      "deviceId": "A1B2C3D4E5F6"
    }
  ]
}
```

### Station View Endpoints

#### GET `/api/station/:deviceId/data`
Get station data in firmware format (requires authentication).

**Response:**
```json
{
  "beacons": [
    {
      "id": "BEACON123",
      "name": "Dog Name",
      "latitude": 37.7749,
      "longitude": -122.4194,
      "hdop": 1.2,
      "sats": 12,
      "battery": 3.8,
      "rssi": -85,
      "snr": 8.5,
      "speed": 5.2,
      "altitude": 120,
      "lastUpdate": 1234567890000,
      "hasData": true
    }
  ],
  "station": {
    "hasValidFix": true,
    "latitude": 37.7750,
    "longitude": -122.4195,
    "hdop": 0.9,
    "sats": 14,
    "altitude": 115,
    "lastUpdate": 1234567890000
  },
  "config": {
    "disconnectTimeout": 60
  },
  "serverTime": 1234567890000
}
```

#### GET `/api/station/:deviceId/history`
Get station history summary (requires authentication).

**Response:**
```json
{
  "deviceId": "A1B2C3D4E5F6",
  "totalPoints": 1500,
  "timeRange": "Last 1000 points"
}
```

### WebSocket

Connect to `/ws` for real-time updates.

**Message Types:**

```json
{
  "type": "beacon_update",
  "deviceId": "A1B2C3D4E5F6",
  "trackerId": "BEACON123",
  "data": {
    "latitude": 37.7749,
    "longitude": -122.4194,
    "hdop": 1.2,
    "sats": 12,
    "timestamp": "2025-12-09T10:30:00.000Z"
  }
}
```

```json
{
  "type": "control_status",
  "deviceId": "A1B2C3D4E5F6",
  "ledOn": true,
  "buzzerOn": false
}
```

## Usage

1. **Access the dashboard:**
   Open `http://your-server-address:3000` in a web browser

2. **Login:**
   Use the credentials you set in the `.env` file

3. **View devices:**
   - All connected PupStations appear in the left sidebar
   - Click a device to select it and view details
   - The map shows real-time location of tracked beacons

4. **Station View Interface:**
   - Click the "🖥️ View Station Interface" button on any device card
   - Or click on a station marker on the map and select "View Station Interface"
   - This opens a firmware-style interface showing the same view you'd see when directly accessing the station device
   - Includes Dashboard, Map View, History, Statistics, and Configuration tabs
   - Auto-updates every 5 seconds with live beacon data

5. **Control beacons:**
   - Select a device from the sidebar
   - Use the LED and Buzzer buttons at the bottom to send control commands
   - The command is sent to the PupStation, which forwards it to the PupBeacon via LoRa

## Deployment

### Production Considerations

1. **Use HTTPS:**
   - Set up a reverse proxy (nginx, Apache) with SSL/TLS
   - Use Let's Encrypt for free certificates
   - Update WebSocket connections to use `wss://`

2. **Database:**
   - Current implementation uses in-memory storage
   - For production, integrate a database (MongoDB, PostgreSQL, etc.)
   - Persist users, devices, and history data

3. **Environment:**
   - Set `NODE_ENV=production` in `.env`
   - Use a process manager like PM2:
     ```bash
     npm install -g pm2
     pm2 start src/server.js --name pawtracker-server
     pm2 save
     pm2 startup
     ```

4. **Firewall:**
   - Open port 3000 (or your configured port)
   - Restrict access if needed

### Docker Deployment (Optional)

Create a `Dockerfile`:

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 3000
CMD ["node", "src/server.js"]
```

Build and run:

```bash
docker build -t pawtracker-server .
docker run -d -p 3000:3000 --env-file .env pawtracker-server
```

## Troubleshooting

### PupStation not sending data

1. Check PupStation serial output for errors
2. Verify server URL is correct: `http://pawtracker.local/api/server/config`
3. Ensure PupStation has internet connectivity
4. Check firewall rules on the server

### Cannot login to dashboard

1. Verify credentials in `.env` file
2. Check server logs for errors
3. Clear browser cookies/cache

### Map not loading

1. Check browser console for errors
2. Ensure internet connection (OpenStreetMap tiles require internet)
3. Verify WebSocket connection is established

### WebSocket disconnects

1. Check for firewall blocking WebSocket connections
2. If using a reverse proxy, ensure WebSocket support is enabled
3. Check server logs for connection errors

## Security Notes

- **Change default credentials** immediately in production
- Use a **strong session secret** (random 32+ character string)
- Consider implementing **rate limiting** for API endpoints
- Add **CORS** restrictions if needed
- Implement **user management** for multiple users
- Consider **encrypting** beacon data if transmitting sensitive information

## Future Enhancements

- User management (multiple users, roles)
- Persistent database storage
- Historical track playback
- Geofencing and alerts
- Email/SMS notifications
- Mobile app integration
- Export track data (GPX, KML)
- Multi-language support

## License

MIT License - See project root LICENSE file

## Support

For issues and questions, please open an issue on the GitHub repository.
