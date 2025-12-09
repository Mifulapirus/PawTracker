import express from 'express';
import session from 'express-session';
import bodyParser from 'body-parser';
import { WebSocketServer } from 'ws';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import bcrypt from 'bcrypt';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../public')));

// Session configuration
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'pawtracker-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
  })
);

// In-memory storage (replace with database in production)
const users = new Map();
const devices = new Map(); // deviceId -> { name, lastSeen, location, beaconData }
const trackerHistory = new Map(); // trackerId -> [locations]

// Initialize default admin user
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

(async () => {
  const hashedPassword = await bcrypt.hash(ADMIN_PASSWORD, 10);
  users.set(ADMIN_USERNAME, {
    username: ADMIN_USERNAME,
    password: hashedPassword,
    createdAt: new Date()
  });
  console.log(`Admin user created: ${ADMIN_USERNAME}`);
})();

// Authentication middleware
function requireAuth(req, res, next) {
  if (req.session && req.session.userId) {
    return next();
  }
  res.status(401).json({ error: 'Unauthorized' });
}

// ============================================================================
// Authentication Routes
// ============================================================================

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  const user = users.get(username);
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const passwordMatch = await bcrypt.compare(password, user.password);
  if (!passwordMatch) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  req.session.userId = username;
  res.json({ success: true, username });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Logout failed' });
    }
    res.json({ success: true });
  });
});

app.get('/api/auth/check', (req, res) => {
  if (req.session && req.session.userId) {
    res.json({ authenticated: true, username: req.session.userId });
  } else {
    res.json({ authenticated: false });
  }
});

// ============================================================================
// Device Data Routes (for PupStation to send data)
// ============================================================================

app.post('/api/device/register', (req, res) => {
  const { deviceId, deviceName } = req.body;

  if (!deviceId) {
    return res.status(400).json({ error: 'Device ID required' });
  }

  if (!devices.has(deviceId)) {
    devices.set(deviceId, {
      id: deviceId,
      name: deviceName || `Station ${deviceId.substring(0, 8)}`,
      registeredAt: new Date(),
      lastSeen: new Date(),
      beacons: new Map()
    });
  } else {
    // Ensure existing devices have Map for beacons
    const device = devices.get(deviceId);
    if (!device.beacons || !(device.beacons instanceof Map)) {
      device.beacons = new Map();
    }
  }

  res.json({ success: true, deviceId });
});

// PupStation sends beacon data here
app.post('/api/device/beacon', (req, res) => {
  const { deviceId, beaconData, stationLocation } = req.body;

  if (!deviceId || !beaconData) {
    return res.status(400).json({ error: 'Device ID and beacon data required' });
  }

  const device = devices.get(deviceId);
  if (!device) {
    return res.status(404).json({ error: 'Device not registered' });
  }

  // Update device data
  device.lastSeen = new Date();
  
  // Update station location if provided
  if (stationLocation) {
    device.stationLocation = {
      latitude: stationLocation.latitude,
      longitude: stationLocation.longitude,
      hdop: stationLocation.hdop,
      sats: stationLocation.sats,
      altitude: stationLocation.altitude,
      hasValidFix: stationLocation.hasValidFix,
      timestamp: new Date()
    };
  }
  
  const trackerId = beaconData.trackerId || 'unknown';
  
  // Initialize beacons Map if needed
  if (!device.beacons || !(device.beacons instanceof Map)) {
    device.beacons = new Map();
  }
  
  // Get or create beacon entry
  if (!device.beacons.has(trackerId)) {
    device.beacons.set(trackerId, {
      id: trackerId,
      name: `Beacon ${trackerId.substring(0, 8)}`,
      firstSeen: new Date(),
      history: []
    });
  }
  
  const beacon = device.beacons.get(trackerId);
  
  // Update current beacon location
  beacon.lastSeen = new Date();
  beacon.location = {
    latitude: beaconData.latitude,
    longitude: beaconData.longitude,
    hdop: beaconData.hdop,
    sats: beaconData.sats,
    batteryVoltage: beaconData.batteryVoltage,
    rssi: beaconData.rssi,
    snr: beaconData.snr,
    speed: beaconData.speed,
    altitude: beaconData.altitude,
    ledOn: beaconData.ledOn,
    buzzerOn: beaconData.buzzerOn,
    timestamp: new Date()
  };
  
  // Add to history
  beacon.history.push({
    latitude: beaconData.latitude,
    longitude: beaconData.longitude,
    hdop: beaconData.hdop,
    sats: beaconData.sats,
    batteryVoltage: beaconData.batteryVoltage,
    rssi: beaconData.rssi,
    snr: beaconData.snr,
    speed: beaconData.speed,
    altitude: beaconData.altitude,
    timestamp: new Date()
  });
  
  // Keep only last 1000 points per beacon
  if (beacon.history.length > 1000) {
    beacon.history.shift();
  }
  
  // Also store in global tracker history for backwards compatibility
  if (!trackerHistory.has(trackerId)) {
    trackerHistory.set(trackerId, []);
  }
  const history = trackerHistory.get(trackerId);
  history.push({
    latitude: beaconData.latitude,
    longitude: beaconData.longitude,
    hdop: beaconData.hdop,
    sats: beaconData.sats,
    batteryVoltage: beaconData.batteryVoltage,
    rssi: beaconData.rssi,
    snr: beaconData.snr,
    speed: beaconData.speed,
    altitude: beaconData.altitude,
    timestamp: new Date(),
    deviceId
  });
  
  if (history.length > 1000) {
    history.shift();
  }

  // Broadcast to all connected WebSocket clients
  broadcastToClients({
    type: 'beacon_update',
    deviceId,
    trackerId,
    data: beacon.location
  });

  res.json({ success: true });
});

// PupStation sends control command status
app.post('/api/device/control-status', (req, res) => {
  const { deviceId, ledOn, buzzerOn } = req.body;

  if (!deviceId) {
    return res.status(400).json({ error: 'Device ID required' });
  }

  const device = devices.get(deviceId);
  if (device) {
    device.controlState = { ledOn, buzzerOn, timestamp: new Date() };
    device.lastSeen = new Date();

    broadcastToClients({
      type: 'control_status',
      deviceId,
      ledOn,
      buzzerOn
    });
  }

  res.json({ success: true });
});

// ============================================================================
// Web Dashboard Routes (protected)
// ============================================================================

app.get('/api/devices', requireAuth, (req, res) => {
  const deviceList = Array.from(devices.values()).map(device => {
    const beaconList = device.beacons ? Array.from(device.beacons.values()).map(beacon => ({
      id: beacon.id,
      name: beacon.name,
      lastSeen: beacon.lastSeen,
      firstSeen: beacon.firstSeen,
      location: beacon.location,
      historyCount: beacon.history.length
    })) : [];
    
    return {
      id: device.id,
      name: device.name,
      lastSeen: device.lastSeen,
      registeredAt: device.registeredAt,
      controlState: device.controlState,
      stationLocation: device.stationLocation,
      beacons: beaconList,
      beaconCount: beaconList.length
    };
  });

  res.json({ devices: deviceList });
});

// Get beacons for a specific device
app.get('/api/device/:deviceId/beacons', requireAuth, (req, res) => {
  const { deviceId } = req.params;
  
  const device = devices.get(deviceId);
  if (!device) {
    return res.status(404).json({ error: 'Device not found' });
  }
  
  const beaconList = device.beacons ? Array.from(device.beacons.values()).map(beacon => ({
    id: beacon.id,
    name: beacon.name,
    lastSeen: beacon.lastSeen,
    firstSeen: beacon.firstSeen,
    location: beacon.location,
    historyCount: beacon.history.length
  })) : [];
  
  res.json({ deviceId, beacons: beaconList });
});

// Get history for a specific beacon
app.get('/api/device/:deviceId/beacon/:beaconId/history', requireAuth, (req, res) => {
  const { deviceId, beaconId } = req.params;
  const limit = parseInt(req.query.limit) || 1000;
  
  const device = devices.get(deviceId);
  if (!device || !device.beacons) {
    return res.status(404).json({ error: 'Device or beacon not found' });
  }
  
  const beacon = device.beacons.get(beaconId);
  if (!beacon) {
    return res.status(404).json({ error: 'Beacon not found' });
  }
  
  const history = beacon.history.slice(-limit);
  
  res.json({ 
    deviceId, 
    beaconId,
    beaconName: beacon.name,
    history,
    totalPoints: beacon.history.length
  });
});

app.get('/api/tracker/:trackerId/history', requireAuth, (req, res) => {
  const { trackerId } = req.params;
  const history = trackerHistory.get(trackerId) || [];

  res.json({ trackerId, history });
});

app.post('/api/device/:deviceId/control', requireAuth, (req, res) => {
  const { deviceId } = req.params;
  const { ledOn, buzzerOn } = req.body;

  const device = devices.get(deviceId);
  if (!device) {
    return res.status(404).json({ error: 'Device not found' });
  }

  // Store the control command for the device to retrieve
  device.pendingControl = { ledOn, buzzerOn, timestamp: new Date() };

  broadcastToClients({
    type: 'control_command',
    deviceId,
    ledOn,
    buzzerOn
  });

  res.json({ success: true });
});

// Endpoint for PupStation to poll for control commands
app.get('/api/device/:deviceId/control', (req, res) => {
  const { deviceId } = req.params;

  const device = devices.get(deviceId);
  if (!device || !device.pendingControl) {
    return res.json({ hasCommand: false });
  }

  const command = device.pendingControl;
  delete device.pendingControl; // Clear after retrieval

  res.json({
    hasCommand: true,
    ledOn: command.ledOn,
    buzzerOn: command.buzzerOn
  });
});

// ============================================================================
// Station View API Routes (mimics firmware API)
// ============================================================================

// Get station data (mimics firmware /api/data endpoint)
app.get('/api/station/:deviceId/data', requireAuth, (req, res) => {
  const { deviceId } = req.params;
  
  const device = devices.get(deviceId);
  if (!device) {
    return res.status(404).json({ error: 'Device not found' });
  }
  
  // Build response similar to firmware's /api/data
  const beaconList = device.beacons ? Array.from(device.beacons.values()).map(beacon => ({
    id: beacon.id,
    name: beacon.name,
    latitude: beacon.location?.latitude || 0,
    longitude: beacon.location?.longitude || 0,
    hdop: beacon.location?.hdop || 0,
    sats: beacon.location?.sats || 0,
    battery: beacon.location?.batteryVoltage || 0,
    rssi: beacon.location?.rssi || 0,
    snr: beacon.location?.snr || 0,
    speed: beacon.location?.speed || 0,
    altitude: beacon.location?.altitude || 0,
    lastUpdate: beacon.lastSeen ? new Date(beacon.lastSeen).getTime() : 0,
    hasData: !!beacon.location
  })) : [];
  
  res.json({
    beacons: beaconList,
    station: {
      hasValidFix: device.stationLocation ? true : false,
      latitude: device.stationLocation?.latitude || 0,
      longitude: device.stationLocation?.longitude || 0,
      hdop: device.stationLocation?.hdop || 0,
      sats: device.stationLocation?.sats || 0,
      altitude: device.stationLocation?.altitude || 0,
      lastUpdate: device.lastSeen ? new Date(device.lastSeen).getTime() : 0
    },
    config: {
      disconnectTimeout: 60 // Default timeout in seconds
    },
    serverTime: Date.now()
  });
});

// Get station history
app.get('/api/station/:deviceId/history', requireAuth, (req, res) => {
  const { deviceId } = req.params;
  
  const device = devices.get(deviceId);
  if (!device) {
    return res.status(404).json({ error: 'Device not found' });
  }
  
  // Collect all history data from all beacons
  const allHistory = [];
  let totalPoints = 0;
  
  if (device.beacons) {
    device.beacons.forEach(beacon => {
      totalPoints += beacon.history.length;
      beacon.history.forEach(point => {
        allHistory.push({
          timestamp: new Date(point.timestamp).getTime() / 1000, // Unix timestamp in seconds
          beaconId: beacon.id,
          latitude: point.latitude,
          longitude: point.longitude,
          speed: point.speed || 0,
          altitude: point.altitude || 0,
          battery: point.batteryVoltage || 0,
          rssi: point.rssi || 0,
          snr: point.snr || 0
        });
      });
    });
  }
  
  // Sort by timestamp
  allHistory.sort((a, b) => a.timestamp - b.timestamp);
  
  res.json({
    deviceId,
    totalPoints,
    history: allHistory,
    timeRange: allHistory.length > 0 ? 
      `${new Date(allHistory[0].timestamp * 1000).toLocaleString()} - ${new Date(allHistory[allHistory.length - 1].timestamp * 1000).toLocaleString()}` : 
      'No data'
  });
});

// ============================================================================
// WebSocket Server for Real-time Updates
// ============================================================================

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const clients = new Set();

wss.on('connection', (ws, req) => {
  // Check if user is authenticated via session
  // (This is simplified; in production, use proper WebSocket auth)
  clients.add(ws);

  console.log('WebSocket client connected');

  ws.on('close', () => {
    clients.delete(ws);
    console.log('WebSocket client disconnected');
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
    clients.delete(ws);
  });
});

function broadcastToClients(message) {
  const data = JSON.stringify(message);
  clients.forEach((client) => {
    if (client.readyState === 1) { // OPEN
      client.send(data);
    }
  });
}

// ============================================================================
// Start Server
// ============================================================================

server.listen(PORT, () => {
  console.log(`PawTracker Server running on http://localhost:${PORT}`);
  console.log(`Default login: ${ADMIN_USERNAME} / ${ADMIN_PASSWORD}`);
  console.log('Please change the default credentials in production!');
});
