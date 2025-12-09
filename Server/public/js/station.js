// Station View JavaScript
let deviceId = null;
let map = null;
let markers = {};
let disconnectTimeout = 60000; // Default 60 seconds
let updateInterval = null;
let currentView = 'dashboard';

// Get device ID from URL
function getDeviceId() {
  const params = new URLSearchParams(window.location.search);
  return params.get('deviceId');
}

// Initialize
async function init() {
  deviceId = getDeviceId();
  if (!deviceId) {
    alert('No device ID specified');
    window.location.href = '/';
    return;
  }
  
  // Set station name
  document.getElementById('stationName').textContent = `Station ${deviceId}`;
  
  // Start data updates
  updateData();
  updateInterval = setInterval(updateData, 5000);
}

// Update data from server
async function updateData() {
  try {
    const response = await fetch(`/api/station/${deviceId}/data`);
    if (!response.ok) {
      throw new Error('Failed to fetch station data');
    }
    
    const data = await response.json();
    
    // Update disconnect timeout
    if (data.config && data.config.disconnectTimeout) {
      disconnectTimeout = data.config.disconnectTimeout * 1000;
    }
    
    // Update dashboard view
    if (currentView === 'dashboard') {
      updateDashboard(data);
    }
    
    // Update map view if visible
    if (currentView === 'map' && map) {
      updateMap(data);
    }
    
  } catch (error) {
    console.error('Error fetching data:', error);
  }
}

// Update dashboard view
function updateDashboard(data) {
  if (data.beacons && data.beacons.length > 0) {
    document.getElementById('noData').style.display = 'none';
    document.getElementById('dataContainer').style.display = 'block';
    
    // Render beacon cards
    const beaconsContainer = document.getElementById('beaconsContainer');
    beaconsContainer.innerHTML = '';
    
    data.beacons.forEach(beacon => {
      const age = Math.floor((Date.now() - beacon.lastUpdate) / 1000);
      const ageMs = Date.now() - beacon.lastUpdate;
      const isDisconnected = ageMs > disconnectTimeout;
      const ageText = age < 60 ? age + 's ago' : Math.floor(age / 60) + 'm ago';
      
      const speedText = beacon.speed < 0.5 ? 'Stationary' : beacon.speed.toFixed(1) + ' km/h';
      
      const card = document.createElement('div');
      card.className = 'card compact';
      if (isDisconnected) {
        card.style.opacity = '0.4';
        card.style.filter = 'grayscale(50%)';
      }
      card.innerHTML = `
        <h2>🐕 ${beacon.name || beacon.id} ${isDisconnected ? '<span style="color: #f87171; font-size: 0.7em;">(DISCONNECTED)</span>' : ''}</h2>
        <div style='display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; font-size: 0.9em;'>
          <div>
            <div class='label' style='font-size: 0.85em;'>Location</div>
            <div class='value' style='font-size: 0.95em;'>${beacon.latitude.toFixed(5)}°, ${beacon.longitude.toFixed(5)}°</div>
            <a href='https://www.google.com/maps?q=${beacon.latitude},${beacon.longitude}' target='_blank' style='color: #c084fc; font-size: 0.85em; text-decoration: none;'>📍 Map</a>
          </div>
          <div>
            <div class='label' style='font-size: 0.85em;'>Speed</div>
            <div class='value' style='font-size: 0.95em;'>${speedText}</div>
          </div>
          <div>
            <div class='label' style='font-size: 0.85em;'>Altitude</div>
            <div class='value' style='font-size: 0.95em;'>${beacon.altitude.toFixed(0)} m</div>
          </div>
          <div>
            <div class='label' style='font-size: 0.85em;'>Satellites</div>
            <div class='value' style='font-size: 0.95em;'>${beacon.sats}</div>
          </div>
          <div>
            <div class='label' style='font-size: 0.85em;'>Battery</div>
            <div class='value' style='font-size: 0.95em;'>${beacon.battery.toFixed(2)} V</div>
          </div>
          <div>
            <div class='label' style='font-size: 0.85em;'>Signal</div>
            <div class='value' style='font-size: 0.95em;'>${beacon.rssi.toFixed(0)} dBm</div>
          </div>
          <div style='grid-column: 1 / -1;'>
            <div class='label' style='font-size: 0.85em;'>Last Update</div>
            <div class='value' style='font-size: 0.9em; color: ${age < 30 ? '#4ade80' : age < 60 ? '#fbbf24' : '#f87171'};'>${ageText}</div>
          </div>
        </div>
      `;
      beaconsContainer.appendChild(card);
    });
    
    // Update station status
    if (data.station) {
      const statusEl = document.getElementById('stationStatus');
      if (data.station.hasValidFix) {
        statusEl.textContent = 'Fixed';
        statusEl.style.color = '#4ade80';
      } else {
        statusEl.textContent = 'No Fix';
        statusEl.style.color = '#f87171';
      }
      document.getElementById('stationSats').textContent = data.station.sats || '--';
      
      if (data.station.hasValidFix && data.station.latitude) {
        document.getElementById('stationLat').textContent = data.station.latitude.toFixed(5) + '°';
        document.getElementById('stationLon').textContent = data.station.longitude.toFixed(5) + '°';
      } else {
        document.getElementById('stationLat').textContent = '--';
        document.getElementById('stationLon').textContent = '--';
      }
    }
  } else {
    document.getElementById('noData').style.display = 'block';
    document.getElementById('dataContainer').style.display = 'none';
  }
}

// Initialize map
function initMap() {
  if (map) return; // Already initialized
  
  map = L.map('map').setView([0, 0], 13);
  
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19
  }).addTo(map);
}

// Update map markers
function updateMap(data) {
  if (!map) return;
  
  const bounds = [];
  
  // Clear old markers
  Object.values(markers).forEach(marker => map.removeLayer(marker));
  markers = {};
  
  // Add station marker
  if (data.station && data.station.hasValidFix && data.station.latitude) {
    const stationIcon = L.divIcon({
      html: '📱',
      className: 'custom-marker',
      iconSize: [35, 35],
      iconAnchor: [17, 35],
      popupAnchor: [0, -35]
    });
    
    const stationMarker = L.marker([data.station.latitude, data.station.longitude], { icon: stationIcon })
      .bindPopup(`
        <strong>📱 Station</strong><br>
        Lat: ${data.station.latitude.toFixed(5)}°<br>
        Lon: ${data.station.longitude.toFixed(5)}°<br>
        Sats: ${data.station.sats}<br>
        HDOP: ${data.station.hdop ? data.station.hdop.toFixed(2) : '--'}
      `)
      .addTo(map);
    
    markers['station'] = stationMarker;
    bounds.push([data.station.latitude, data.station.longitude]);
  }
  
  // Add beacon markers
  if (data.beacons) {
    data.beacons.forEach(beacon => {
      if (beacon.latitude && beacon.longitude) {
        const beaconIcon = L.divIcon({
          html: '🐾',
          className: 'custom-marker',
          iconSize: [30, 30],
          iconAnchor: [15, 30],
          popupAnchor: [0, -30]
        });
        
        const age = Math.floor((Date.now() - beacon.lastUpdate) / 1000);
        const ageText = age < 60 ? age + 's ago' : Math.floor(age / 60) + 'm ago';
        
        const beaconMarker = L.marker([beacon.latitude, beacon.longitude], { icon: beaconIcon })
          .bindPopup(`
            <strong>🐕 ${beacon.name || beacon.id}</strong><br>
            Lat: ${beacon.latitude.toFixed(5)}°<br>
            Lon: ${beacon.longitude.toFixed(5)}°<br>
            Speed: ${beacon.speed ? beacon.speed.toFixed(1) : '0'} km/h<br>
            Battery: ${beacon.battery.toFixed(2)} V<br>
            Signal: ${beacon.rssi.toFixed(0)} dBm<br>
            Updated: ${ageText}
          `)
          .addTo(map);
        
        markers[beacon.id] = beaconMarker;
        bounds.push([beacon.latitude, beacon.longitude]);
      }
    });
  }
  
  // Fit map to show all markers
  if (bounds.length > 0) {
    map.fitBounds(bounds, { padding: [50, 50] });
  }
  
  // Calculate and show distance if we have both station and beacon
  if (data.station && data.station.hasValidFix && data.beacons && data.beacons.length > 0) {
    const beacon = data.beacons[0]; // Use first beacon
    if (beacon.latitude && beacon.longitude) {
      const distance = calculateDistance(
        data.station.latitude, data.station.longitude,
        beacon.latitude, beacon.longitude
      );
      document.getElementById('distanceValue').textContent = formatDistance(distance);
      document.getElementById('distanceOverlay').classList.add('show');
      
      // Update info panel
      document.getElementById('dogSpeed').textContent = beacon.speed ? beacon.speed.toFixed(1) + ' km/h' : '0 km/h';
      document.getElementById('dogAltitude').textContent = (beacon.altitude - (data.station.altitude || 0)).toFixed(0) + ' m';
      document.getElementById('distance').textContent = formatDistance(distance);
      
      const age = Math.floor((Date.now() - beacon.lastUpdate) / 1000);
      const ageText = age < 60 ? age + 's ago' : Math.floor(age / 60) + 'm ago';
      document.getElementById('lastUpdate').textContent = ageText;
    }
  }
}

// Calculate distance between two GPS coordinates (Haversine formula)
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// Format distance for display
function formatDistance(km) {
  if (km < 1) {
    return (km * 1000).toFixed(0) + ' m';
  }
  return km.toFixed(2) + ' km';
}

// Toggle fullscreen map
function toggleFullscreen() {
  const mapEl = document.getElementById('map');
  mapEl.classList.toggle('fullscreen');
  setTimeout(() => {
    if (map) map.invalidateSize();
  }, 100);
}

// Show different views
function showView(view) {
  // Update nav links
  document.querySelectorAll('.nav-link').forEach(link => link.classList.remove('active'));
  event.target.classList.add('active');
  
  // Hide all views
  document.getElementById('dataContainer').style.display = 'none';
  document.getElementById('noData').style.display = 'none';
  document.getElementById('mapView').style.display = 'none';
  document.getElementById('historyView').style.display = 'none';
  document.getElementById('statsView').style.display = 'none';
  document.getElementById('configView').style.display = 'none';
  
  currentView = view;
  
  // Show selected view
  switch(view) {
    case 'dashboard':
      updateData(); // Refresh data
      break;
    case 'map':
      document.getElementById('mapView').style.display = 'block';
      if (!map) {
        initMap();
      }
      updateData(); // This will call updateMap
      setTimeout(() => {
        if (map) map.invalidateSize();
      }, 100);
      break;
    case 'history':
      document.getElementById('historyView').style.display = 'block';
      loadHistory();
      break;
    case 'stats':
      document.getElementById('statsView').style.display = 'block';
      break;
    case 'config':
      document.getElementById('configView').style.display = 'block';
      break;
  }
}

// Load history data
async function loadHistory() {
  try {
    const response = await fetch(`/api/station/${deviceId}/history`);
    if (!response.ok) return;
    
    const data = await response.json();
    
    if (!data.history || data.history.length === 0) {
      document.getElementById('noHistoryData').style.display = 'block';
      document.getElementById('historyStats').style.display = 'none';
      document.getElementById('historyMap').style.display = 'none';
      return;
    }
    
    document.getElementById('noHistoryData').style.display = 'none';
    document.getElementById('historyStats').style.display = 'grid';
    document.getElementById('historyMap').style.display = 'block';
    
    // Calculate statistics
    const stats = calculateHistoryStats(data.history);
    
    // Display stats
    document.getElementById('totalDistance').textContent = (stats.totalDistance / 1000).toFixed(2) + ' km';
    document.getElementById('avgSpeed').textContent = stats.avgSpeed.toFixed(1) + ' km/h';
    document.getElementById('maxSpeed').textContent = stats.maxSpeed.toFixed(1) + ' km/h';
    document.getElementById('dataPoints').textContent = data.totalPoints;
    document.getElementById('timeRange').textContent = data.timeRange;
    document.getElementById('minBattery').textContent = stats.minBattery.toFixed(2) + ' V';
    
    // Draw map
    drawHistoryMap(data.history);
    
  } catch (error) {
    console.error('Error loading history:', error);
  }
}

// Calculate statistics from history data
function calculateHistoryStats(history) {
  let totalDistance = 0;
  let maxSpeed = 0;
  let totalSpeed = 0;
  let minBattery = 5.0;
  
  for (let i = 1; i < history.length; i++) {
    const prev = history[i - 1];
    const curr = history[i];
    
    // Only calculate distance if same beacon
    if (prev.beaconId === curr.beaconId) {
      const dist = calculateDistance(prev.latitude, prev.longitude, curr.latitude, curr.longitude);
      totalDistance += dist;
    }
    
    if (curr.speed > maxSpeed) maxSpeed = curr.speed;
    totalSpeed += curr.speed;
    if (curr.battery < minBattery && curr.battery > 0) minBattery = curr.battery;
  }
  
  const avgSpeed = totalSpeed / history.length;
  
  return {
    totalDistance,
    avgSpeed,
    maxSpeed,
    minBattery
  };
}

// Color palette for different beacons
const beaconColors = [
  '#8b5cf6',  // Purple
  '#3b82f6',  // Blue  
  '#10b981',  // Green
  '#f59e0b',  // Orange
  '#ef4444',  // Red
  '#06b6d4',  // Cyan
  '#a855f7',  // Violet
  '#14b8a6'   // Teal
];

// Draw history map
let historyMap = null;
function drawHistoryMap(history) {
  const mapEl = document.getElementById('historyMap');
  
  // Initialize map if needed
  if (!historyMap) {
    historyMap = L.map('historyMap').setView([0, 0], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19
    }).addTo(historyMap);
  } else {
    // Clear existing layers
    historyMap.eachLayer(layer => {
      if (layer instanceof L.Marker || layer instanceof L.Polyline) {
        historyMap.removeLayer(layer);
      }
    });
  }
  
  // Group history by beacon
  const beaconPaths = {};
  history.forEach(point => {
    if (!beaconPaths[point.beaconId]) {
      beaconPaths[point.beaconId] = [];
    }
    beaconPaths[point.beaconId].push(point);
  });
  
  // Draw path for each beacon
  const allBounds = [];
  let colorIndex = 0;
  
  Object.keys(beaconPaths).forEach(beaconId => {
    const points = beaconPaths[beaconId];
    if (points.length === 0) return;
    
    const color = beaconColors[colorIndex % beaconColors.length];
    colorIndex++;
    
    // Create path
    const coords = points.map(p => [p.latitude, p.longitude]);
    const polyline = L.polyline(coords, {
      color: color,
      weight: 3,
      opacity: 0.7
    }).addTo(historyMap);
    
    polyline.bindPopup(`<strong>Beacon ${beaconId.substring(0, 8)}</strong><br>${points.length} points`);
    
    allBounds.push(...coords);
    
    // Add start marker
    if (points.length > 0) {
      const startIcon = L.divIcon({
        html: `<div style="background: ${color}; color: white; border-radius: 50%; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; font-weight: bold; border: 2px solid white;">S</div>`,
        iconSize: [30, 30],
        className: 'custom-marker'
      });
      
      L.marker([points[0].latitude, points[0].longitude], { icon: startIcon })
        .bindPopup(`<strong>Start</strong><br>Beacon: ${beaconId.substring(0, 8)}`)
        .addTo(historyMap);
      
      // Add end marker
      const endIcon = L.divIcon({
        html: `<div style="background: ${color}; color: white; border-radius: 50%; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; font-weight: bold; border: 2px solid #333;">E</div>`,
        iconSize: [30, 30],
        className: 'custom-marker'
      });
      
      const lastPoint = points[points.length - 1];
      L.marker([lastPoint.latitude, lastPoint.longitude], { icon: endIcon })
        .bindPopup(`<strong>End</strong><br>Beacon: ${beaconId.substring(0, 8)}`)
        .addTo(historyMap);
    }
  });
  
  // Fit bounds to show all paths
  if (allBounds.length > 0) {
    historyMap.fitBounds(allBounds, { padding: [50, 50] });
  }
  
  // Ensure map renders correctly
  setTimeout(() => {
    if (historyMap) historyMap.invalidateSize();
  }, 100);
}

// Initialize on page load
window.addEventListener('DOMContentLoaded', init);

// Add Leaflet CSS link dynamically
const link = document.createElement('link');
link.rel = 'stylesheet';
link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
document.head.appendChild(link);
