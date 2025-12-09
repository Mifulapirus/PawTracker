// Dashboard application
let map;
let markers = {};
let selectedDeviceId = null;
let ws = null;

// Initialize the application
async function init() {
  // Check authentication
  const authCheck = await checkAuth();
  if (!authCheck) {
    window.location.href = '/login.html';
    return;
  }

  // Display username
  document.getElementById('username').textContent = authCheck.username;

  // Initialize map
  initMap();

  // Load initial data
  await loadDevices();

  // Connect WebSocket for real-time updates
  connectWebSocket();

  // Setup event listeners
  setupEventListeners();

  // Refresh devices periodically
  setInterval(loadDevices, 10000); // Every 10 seconds
}

async function checkAuth() {
  try {
    const response = await fetch('/api/auth/check');
    const data = await response.json();
    
    if (!data.authenticated) {
      return false;
    }
    
    return data;
  } catch (error) {
    console.error('Auth check failed:', error);
    return false;
  }
}

function initMap() {
  // Initialize Leaflet map centered on a default location
  map = L.map('map').setView([37.7749, -122.4194], 13);

  // Add OpenStreetMap tiles
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19
  }).addTo(map);
}

async function loadDevices() {
  try {
    const response = await fetch('/api/devices');
    const data = await response.json();

    if (data.devices) {
      updateDeviceList(data.devices);
      updateMapMarkers(data.devices);
    }
  } catch (error) {
    console.error('Failed to load devices:', error);
  }
}

function updateDeviceList(devices) {
  const deviceList = document.getElementById('deviceList');

  if (devices.length === 0) {
    deviceList.innerHTML = '<p class="loading">No devices connected</p>';
    return;
  }

  deviceList.innerHTML = devices.map(device => {
    const lastSeenDate = new Date(device.lastSeen);
    const isOnline = (Date.now() - lastSeenDate.getTime()) < 60000; // Online if seen in last minute

    return `
      <div class="device-card ${selectedDeviceId === device.id ? 'active' : ''}" 
           data-device-id="${device.id}">
        <h3>${device.name}</h3>
        <p>ID: ${device.id.substring(0, 12)}...</p>
        <p>🔗 Beacons: ${device.beaconCount || 0}</p>
        <p>Last seen: ${formatTimestamp(lastSeenDate)}</p>
        <span class="status ${isOnline ? 'online' : 'offline'}">
          ${isOnline ? '● Online' : '○ Offline'}
        </span>
        <button onclick="event.stopPropagation(); window.location.href='/station.html?deviceId=${device.id}'" 
                style="margin-top: 10px; width: 100%; padding: 8px; background: linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%); color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 500; font-size: 12px;">
          🖥️ View Station Interface
        </button>
      </div>
    `;
  }).join('');

  // Add click listeners to device cards
  document.querySelectorAll('.device-card').forEach(card => {
    card.addEventListener('click', () => {
      selectDevice(card.dataset.deviceId);
    });
  });
}

function updateMapMarkers(devices) {
  // Remove old markers
  Object.keys(markers).forEach(key => {
    if (key.startsWith('station-')) {
      const deviceId = key.substring(8);
      const device = devices.find(d => d.id === deviceId);
      if (!device || !device.stationLocation) {
        map.removeLayer(markers[key]);
        delete markers[key];
      }
    } else {
      const [deviceId, beaconId] = key.split('-');
      const device = devices.find(d => d.id === deviceId);
      if (!device || (beaconId && !device.beacons?.find(b => b.id === beaconId))) {
        map.removeLayer(markers[key]);
        delete markers[key];
      }
    }
  });

  let firstMarker = null;

  // Update or create markers for each device
  devices.forEach(device => {
    // Add station marker if location available
    if (device.stationLocation && device.stationLocation.latitude && device.stationLocation.longitude) {
      const { latitude, longitude } = device.stationLocation;
      const markerKey = `station-${device.id}`;

      if (markers[markerKey]) {
        // Update existing marker
        markers[markerKey].setLatLng([latitude, longitude]);
        markers[markerKey].getPopup().setContent(createStationPopupContent(device));
      } else {
        // Create new station marker
        const icon = L.divIcon({
          className: 'custom-marker',
          html: `<div style="background: #8b5cf6; color: white; border-radius: 50%; width: 35px; height: 35px; display: flex; align-items: center; justify-content: center; border: 3px solid white; box-shadow: 0 2px 8px rgba(139,92,246,0.5); font-size: 18px;">📱</div>`,
          iconSize: [35, 35],
          iconAnchor: [17, 17]
        });

        const marker = L.marker([latitude, longitude], { icon }).addTo(map);
        marker.bindPopup(createStationPopupContent(device));
        markers[markerKey] = marker;

        if (!firstMarker) {
          firstMarker = marker;
        }
      }
    }

    // Add beacon markers
    if (device.beacons && device.beacons.length > 0) {
      device.beacons.forEach(beacon => {
        if (beacon.location && beacon.location.latitude && beacon.location.longitude) {
          const { latitude, longitude } = beacon.location;
          const markerKey = `${device.id}-${beacon.id}`;

          if (markers[markerKey]) {
            // Update existing marker
            markers[markerKey].setLatLng([latitude, longitude]);
            markers[markerKey].getPopup().setContent(createBeaconPopupContent(device, beacon));
          } else {
            // Create new beacon marker
            const icon = L.divIcon({
              className: 'custom-marker',
              html: `<div style="background: #ec4899; color: white; border-radius: 50%; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; border: 3px solid white; box-shadow: 0 2px 8px rgba(236,72,153,0.5);">🐾</div>`,
              iconSize: [30, 30],
              iconAnchor: [15, 15]
            });

            const marker = L.marker([latitude, longitude], { icon }).addTo(map);
            marker.bindPopup(createBeaconPopupContent(device, beacon));
            markers[markerKey] = marker;

            if (!firstMarker) {
              firstMarker = marker;
            }
          }
        }
      });
    }
  });

  // Center map on first marker if this is the first load
  if (firstMarker && Object.keys(markers).length === 1) {
    map.setView(firstMarker.getLatLng(), 15);
  } else if (Object.keys(markers).length > 1) {
    // Fit bounds to show all markers
    const bounds = L.latLngBounds(Object.values(markers).map(m => m.getLatLng()));
    map.fitBounds(bounds, { padding: [50, 50] });
  }
}

function createStationPopupContent(device) {
  const loc = device.stationLocation;
  return `
    <div class="popup-content">
      <h4>📱 ${device.name}</h4>
      <p><strong>Type:</strong> PupStation</p>
      <p><strong>Coordinates:</strong> ${loc.latitude.toFixed(6)}, ${loc.longitude.toFixed(6)}</p>
      <p><strong>Satellites:</strong> ${loc.sats}</p>
      <p><strong>HDOP:</strong> ${loc.hdop?.toFixed(2)}</p>
      <p><strong>Altitude:</strong> ${loc.altitude?.toFixed(1)} m</p>
      <p><strong>Updated:</strong> ${formatTimestamp(new Date(loc.timestamp))}</p>
      <button onclick="window.location.href='/station.html?deviceId=${device.id}'" style="margin-top: 10px; padding: 8px 16px; background: linear-gradient(135deg, #ec4899 0%, #8b5cf6 100%); color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 500;">View Station Interface</button>
    </div>
  `;
}

function createBeaconPopupContent(device, beacon) {
  const loc = beacon.location;
  return `
    <div class="popup-content">
      <h4>🐾 ${beacon.name || beacon.id.substring(0, 8)}</h4>
      <p><strong>Device:</strong> ${device.name}</p>
      <p><strong>Coordinates:</strong> ${loc.latitude.toFixed(6)}, ${loc.longitude.toFixed(6)}</p>
      <p><strong>Battery:</strong> ${loc.batteryVoltage?.toFixed(2)}V</p>
      <p><strong>Signal:</strong> ${loc.rssi?.toFixed(0)} dBm (SNR: ${loc.snr?.toFixed(1)})</p>
      <p><strong>Satellites:</strong> ${loc.sats}</p>
      <p><strong>HDOP:</strong> ${loc.hdop?.toFixed(2)}</p>
      <p><strong>Speed:</strong> ${loc.speed?.toFixed(1)} km/h</p>
      <p><strong>Updated:</strong> ${formatTimestamp(new Date(loc.timestamp))}</p>
    </div>
  `;
}

async function selectDevice(deviceId) {
  selectedDeviceId = deviceId;

  // Update device list UI
  document.querySelectorAll('.device-card').forEach(card => {
    card.classList.toggle('active', card.dataset.deviceId === deviceId);
  });

  // Load and show beacons for this device
  await loadBeaconsForDevice(deviceId);

  // Update control panel
  updateControlPanel(deviceId);
}

async function loadBeaconsForDevice(deviceId) {
  try {
    const response = await fetch(`/api/device/${deviceId}/beacons`);
    const data = await response.json();

    if (data.beacons) {
      showBeaconPanel(deviceId, data.beacons);
    }
  } catch (error) {
    console.error('Failed to load beacons:', error);
  }
}

function showBeaconPanel(deviceId, beacons) {
  const panel = document.getElementById('beaconPanel');
  const deviceNameSpan = document.getElementById('selectedDeviceName');
  const beaconList = document.getElementById('beaconList');

  // Get device name
  const deviceCard = document.querySelector(`[data-device-id="${deviceId}"]`);
  const deviceName = deviceCard ? deviceCard.querySelector('h3').textContent : deviceId;
  deviceNameSpan.textContent = deviceName;

  if (beacons.length === 0) {
    beaconList.innerHTML = '<p class="loading">No beacons detected yet</p>';
  } else {
    beaconList.innerHTML = beacons.map(beacon => {
      const lastSeenDate = new Date(beacon.lastSeen);
      const isRecent = (Date.now() - lastSeenDate.getTime()) < 60000;

      return `
        <div class="beacon-card" data-device-id="${deviceId}" data-beacon-id="${beacon.id}">
          <h4>🐾 ${beacon.name || beacon.id.substring(0, 8)}</h4>
          <p>ID: ${beacon.id}</p>
          ${beacon.location ? `
            <p>📍 ${beacon.location.latitude.toFixed(6)}, ${beacon.location.longitude.toFixed(6)}</p>
            <p>🔋 ${beacon.location.batteryVoltage?.toFixed(2)}V | 📡 ${beacon.location.rssi?.toFixed(0)}dBm</p>
            <p>🛰️ Sats: ${beacon.location.sats} | HDOP: ${beacon.location.hdop?.toFixed(1)}</p>
          ` : '<p>No location data</p>'}
          <p>📊 History: ${beacon.historyCount} points</p>
          <p class="history-time">Last: ${formatTimestamp(lastSeenDate)}</p>
          <span class="beacon-status ${isRecent ? 'badge-success' : 'badge-warning'}">
            ${isRecent ? '● Active' : '○ Idle'}
          </span>
        </div>
      `;
    }).join('');

    // Add click listeners to beacon cards
    document.querySelectorAll('.beacon-card').forEach(card => {
      card.addEventListener('click', () => {
        selectBeacon(card.dataset.deviceId, card.dataset.beaconId);
      });
    });
  }

  panel.style.display = 'block';
}

async function selectBeacon(deviceId, beaconId) {
  // Mark beacon as selected
  document.querySelectorAll('.beacon-card').forEach(card => {
    card.classList.toggle('selected', 
      card.dataset.deviceId === deviceId && card.dataset.beaconId === beaconId);
  });

  // Load beacon history and show info panel
  await loadBeaconHistory(deviceId, beaconId);

  // Center map on beacon if it has a marker
  const beaconMarkerKey = `${deviceId}-${beaconId}`;
  if (markers[beaconMarkerKey]) {
    map.setView(markers[beaconMarkerKey].getLatLng(), 16);
  }
}

async function loadBeaconHistory(deviceId, beaconId) {
  try {
    const response = await fetch(`/api/device/${deviceId}/beacon/${beaconId}/history?limit=20`);
    const data = await response.json();

    if (data.history) {
      showBeaconInfo(deviceId, beaconId, data);
    }
  } catch (error) {
    console.error('Failed to load beacon history:', error);
  }
}

function showBeaconInfo(deviceId, beaconId, data) {
  const panel = document.getElementById('infoPanel');
  const title = document.getElementById('infoPanelTitle');
  const content = document.getElementById('infoPanelContent');

  title.textContent = `${data.beaconName || beaconId}`;

  const latest = data.history[data.history.length - 1];
  
  let html = '<div class="info-section">';
  
  if (latest) {
    html += `
      <h4>Current Status</h4>
      <div class="info-row">
        <span class="info-label">Location</span>
        <span class="info-value">${latest.latitude.toFixed(6)}, ${latest.longitude.toFixed(6)}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Battery</span>
        <span class="info-value">${latest.batteryVoltage?.toFixed(2)}V</span>
      </div>
      <div class="info-row">
        <span class="info-label">Signal (RSSI)</span>
        <span class="info-value">${latest.rssi?.toFixed(0)} dBm</span>
      </div>
      <div class="info-row">
        <span class="info-label">SNR</span>
        <span class="info-value">${latest.snr?.toFixed(1)} dB</span>
      </div>
      <div class="info-row">
        <span class="info-label">Satellites</span>
        <span class="info-value">${latest.sats}</span>
      </div>
      <div class="info-row">
        <span class="info-label">HDOP</span>
        <span class="info-value">${latest.hdop?.toFixed(2)}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Speed</span>
        <span class="info-value">${latest.speed?.toFixed(1)} km/h</span>
      </div>
      <div class="info-row">
        <span class="info-label">Altitude</span>
        <span class="info-value">${latest.altitude?.toFixed(1)} m</span>
      </div>
    `;
  }
  
  html += '</div>';
  
  // History section
  html += `
    <div class="history-chart">
      <h4>Recent History (${data.totalPoints} total points)</h4>
      <div class="history-points">
  `;
  
  data.history.slice().reverse().forEach(point => {
    const batteryClass = point.batteryVoltage > 3.7 ? 'badge-success' : 
                         point.batteryVoltage > 3.5 ? 'badge-warning' : 'badge-danger';
    html += `
      <div class="history-point">
        <div>
          <div>${point.latitude.toFixed(6)}, ${point.longitude.toFixed(6)}</div>
          <span class="badge ${batteryClass}">${point.batteryVoltage?.toFixed(2)}V</span>
          <span class="badge badge-success">${point.sats} sats</span>
        </div>
        <div class="history-time">${formatTimestamp(new Date(point.timestamp))}</div>
      </div>
    `;
  });
  
  html += '</div></div>';
  
  content.innerHTML = html;
  panel.style.display = 'block';
}

function updateControlPanel(deviceId) {
  const controlSection = document.getElementById('controlSection');

  controlSection.innerHTML = `
    <div class="control-buttons">
      <button class="control-btn" id="ledBtn">
        <span class="indicator"></span>
        LED
      </button>
      <button class="control-btn" id="buzzerBtn">
        <span class="indicator"></span>
        Buzzer
      </button>
    </div>
  `;

  // Add click handlers
  document.getElementById('ledBtn').addEventListener('click', () => toggleControl('led'));
  document.getElementById('buzzerBtn').addEventListener('click', () => toggleControl('buzzer'));
}

let ledState = false;
let buzzerState = false;

async function toggleControl(type) {
  if (!selectedDeviceId) return;

  if (type === 'led') {
    ledState = !ledState;
    document.getElementById('ledBtn').classList.toggle('active', ledState);
  } else if (type === 'buzzer') {
    buzzerState = !buzzerState;
    document.getElementById('buzzerBtn').classList.toggle('active', buzzerState);
  }

  try {
    const response = await fetch(`/api/device/${selectedDeviceId}/control`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        ledOn: ledState,
        buzzerOn: buzzerState
      })
    });

    if (!response.ok) {
      console.error('Control command failed');
    }
  } catch (error) {
    console.error('Failed to send control command:', error);
  }
}

function connectWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws`;

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log('WebSocket connected');
  };

  ws.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);
      handleWebSocketMessage(message);
    } catch (error) {
      console.error('WebSocket message error:', error);
    }
  };

  ws.onerror = (error) => {
    console.error('WebSocket error:', error);
  };

  ws.onclose = () => {
    console.log('WebSocket disconnected, reconnecting in 5s...');
    setTimeout(connectWebSocket, 5000);
  };
}

function handleWebSocketMessage(message) {
  switch (message.type) {
    case 'beacon_update':
      // Reload devices to get updated data
      loadDevices();
      break;

    case 'control_status':
      console.log('Control status update:', message);
      break;

    case 'control_command':
      console.log('Control command sent:', message);
      break;
  }
}

function setupEventListeners() {
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    try {
      await fetch('/api/logout', { method: 'POST' });
      window.location.href = '/login.html';
    } catch (error) {
      console.error('Logout failed:', error);
    }
  });

  document.getElementById('closeBeaconPanel').addEventListener('click', () => {
    document.getElementById('beaconPanel').style.display = 'none';
  });

  document.getElementById('closeInfoPanel').addEventListener('click', () => {
    document.getElementById('infoPanel').style.display = 'none';
  });
}

function formatTimestamp(date) {
  const now = new Date();
  const diff = now - date;

  if (diff < 60000) {
    return 'Just now';
  } else if (diff < 3600000) {
    return `${Math.floor(diff / 60000)}m ago`;
  } else if (diff < 86400000) {
    return `${Math.floor(diff / 3600000)}h ago`;
  } else {
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
  }
}

// Start the application
init();
