// History tracking and playback
let map;
let historyData = [];
let currentMarker = null;
let pathLines = [];  // Changed to array for multiple beacon paths
let playbackTimer = null;
let currentIndex = 0;
let isPlaying = false;
let playbackSpeed = 1; // 1x speed by default

// Map layer options
const mapLayers = {
  street: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
  }),
  satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Esri, Maxar, Earthstar Geographics'
  }),
  terrain: L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenTopoMap contributors'
  })
};

// Initialize map
function initMap() {
  console.log("Initializing history map...");
  const mapContainer = document.getElementById('map');
  console.log("Map container:", mapContainer, "Dimensions:", mapContainer.offsetWidth, "x", mapContainer.offsetHeight);
  
  map = L.map('map', {
    center: [0, 0],
    zoom: 2,
    zoomControl: true
  });
  
  // Add default layer (street) with explicit maxZoom
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19
  }).addTo(map);
  
  console.log("History map initialized, tiles should be loading");
  
  // Force map to refresh multiple times to ensure tiles load
  setTimeout(() => {
    console.log("First invalidateSize");
    map.invalidateSize();
  }, 100);
  
  setTimeout(() => {
    console.log("Second invalidateSize");
    map.invalidateSize();
  }, 500);
}

// Haversine formula for distance calculation (in meters)
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth's radius in meters
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // Distance in meters
}

// Calculate statistics from history data
function calculateStats() {
  if (historyData.length === 0) return;
  
  let totalDistance = 0;
  let maxSpeed = 0;
  let totalSpeed = 0;
  let elevGain = 0;
  let elevLoss = 0;
  let minBattery = 5.0;
  let prevAlt = historyData[0].altitude;
  
  // Calculate distances and stats
  for (let i = 1; i < historyData.length; i++) {
    const prev = historyData[i - 1];
    const curr = historyData[i];
    
    // Distance
    const dist = haversineDistance(prev.latitude, prev.longitude, curr.latitude, curr.longitude);
    totalDistance += dist;
    
    // Speed
    if (curr.speed > maxSpeed) maxSpeed = curr.speed;
    totalSpeed += curr.speed;
    
    // Elevation
    const altDiff = curr.altitude - prevAlt;
    if (altDiff > 0) elevGain += altDiff;
    else elevLoss += Math.abs(altDiff);
    prevAlt = curr.altitude;
    
    // Battery
    if (curr.battery < minBattery) minBattery = curr.battery;
  }
  
  const avgSpeed = totalSpeed / historyData.length;
  const duration = historyData[historyData.length - 1].timestamp - historyData[0].timestamp;
  
  // Update UI
  document.getElementById('totalDistance').textContent = (totalDistance / 1000).toFixed(2) + ' km';
  document.getElementById('avgSpeed').textContent = avgSpeed.toFixed(1) + ' km/h';
  document.getElementById('maxSpeed').textContent = maxSpeed.toFixed(1) + ' km/h';
  document.getElementById('duration').textContent = formatDuration(duration);
  document.getElementById('elevGain').textContent = elevGain.toFixed(0) + ' m';
  document.getElementById('elevLoss').textContent = elevLoss.toFixed(0) + ' m';
  document.getElementById('dataPoints').textContent = historyData.length;
  document.getElementById('minBattery').textContent = minBattery.toFixed(2) + ' V';
  
  // Update timeline
  const timeline = document.getElementById('timeline');
  timeline.max = historyData.length - 1;
  document.getElementById('totalTime').textContent = formatTimestamp(historyData[historyData.length - 1].timestamp);
}

// Format duration in seconds to HH:MM:SS
function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// Format Unix timestamp to time string
function formatTimestamp(timestamp) {
  const date = new Date(timestamp * 1000);
  return date.toLocaleTimeString();
}

// Color palette for beacons (same as stats page)
const beaconPathColors = [
  '#8b5cf6',  // Purple
  '#3b82f6',  // Blue  
  '#10b981',  // Green
  '#f59e0b',  // Orange
  '#ef4444',  // Red
  '#06b6d4',  // Cyan
  '#a855f7',  // Violet
  '#14b8a6'   // Teal
];

// Draw path on map
function drawPath() {
  if (historyData.length === 0) return;
  
  // Clear existing paths
  pathLines.forEach(line => map.removeLayer(line));
  pathLines = [];
  
  // Group data by beaconId
  const beaconPaths = {};
  historyData.forEach(entry => {
    const beaconId = entry.beaconId || 'unknown';
    if (!beaconPaths[beaconId]) {
      beaconPaths[beaconId] = [];
    }
    beaconPaths[beaconId].push(entry);
  });
  
  // Draw separate path for each beacon
  let colorIndex = 0;
  const allBounds = [];
  
  Object.keys(beaconPaths).forEach(beaconId => {
    const beaconData = beaconPaths[beaconId];
    if (beaconData.length === 0) return;
    
    const color = beaconPathColors[colorIndex % beaconPathColors.length];
    const coords = beaconData.map(entry => [entry.latitude, entry.longitude]);
    
    // Draw path for this beacon
    const pathLine = L.polyline(coords, {
      color: color,
      weight: 3,
      opacity: 0.7
    }).addTo(map);
    
    pathLine.bindPopup(`<b>Beacon ${beaconId.substring(0, 8)}</b><br>${beaconData.length} points`);
    pathLines.push(pathLine);
    allBounds.push(...coords);
    
    // Add start marker for this beacon
    const startIcon = L.divIcon({
      html: `<div style="background: ${color}; color: white; border-radius: 50%; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; font-weight: bold; border: 2px solid white;">S</div>`,
      iconSize: [30, 30],
      className: 'beacon-marker'
    });
    
    const endIcon = L.divIcon({
      html: `<div style="background: ${color}; color: white; border-radius: 50%; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; font-weight: bold; border: 2px solid #333;">E</div>`,
      iconSize: [30, 30],
      className: 'beacon-marker'
    });
    
    L.marker(coords[0], { icon: startIcon }).addTo(map)
      .bindPopup(`<b>Start - Beacon ${beaconId.substring(0, 8)}</b><br>${formatTimestamp(beaconData[0].timestamp)}`);
    
    L.marker(coords[coords.length - 1], { icon: endIcon }).addTo(map)
      .bindPopup(`<b>End - Beacon ${beaconId.substring(0, 8)}</b><br>${formatTimestamp(beaconData[beaconData.length - 1].timestamp)}`);
    
    colorIndex++;
  });
  
  // Fit map to all paths
  if (allBounds.length > 0) {
    map.fitBounds(allBounds, { padding: [50, 50] });
  }
}

// Update current position marker
function updateMarker(index) {
  if (index < 0 || index >= historyData.length) return;
  
  const entry = historyData[index];
  
  // Remove old marker
  if (currentMarker) map.removeLayer(currentMarker);
  
  // Create new marker
  const markerIcon = L.divIcon({
    html: '<div style="background: #ffc107; color: black; border-radius: 50%; width: 20px; height: 20px; border: 3px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3);"></div>',
    iconSize: [20, 20],
    className: 'beacon-marker'
  });
  
  currentMarker = L.marker([entry.latitude, entry.longitude], { icon: markerIcon }).addTo(map);
  
  // Create popup content
  const popupContent = `
    <b>Time:</b> ${formatTimestamp(entry.timestamp)}<br>
    <b>Speed:</b> ${entry.speed.toFixed(1)} km/h<br>
    <b>Altitude:</b> ${entry.altitude.toFixed(1)} m<br>
    <b>Battery:</b> ${entry.battery.toFixed(2)} V<br>
    <b>RSSI:</b> ${entry.rssi.toFixed(1)} dBm<br>
    <b>SNR:</b> ${entry.snr.toFixed(1)} dB
  `;
  
  currentMarker.bindPopup(popupContent).openPopup();
  
  // Update timeline
  document.getElementById('timeline').value = index;
  document.getElementById('currentTime').textContent = formatTimestamp(entry.timestamp);
}

// Playback controls
function playTrack() {
  if (historyData.length === 0) return;
  
  isPlaying = true;
  document.getElementById('playBtn').disabled = true;
  document.getElementById('pauseBtn').disabled = false;
  document.getElementById('stopBtn').disabled = false;
  
  // Start playback from current position
  playbackTimer = setInterval(() => {
    if (currentIndex >= historyData.length - 1) {
      stopTrack();
      return;
    }
    
    currentIndex++;
    updateMarker(currentIndex);
  }, 1000 / playbackSpeed); // Adjust interval based on speed
}

function pauseTrack() {
  isPlaying = false;
  clearInterval(playbackTimer);
  document.getElementById('playBtn').disabled = false;
  document.getElementById('pauseBtn').disabled = true;
}

function stopTrack() {
  isPlaying = false;
  clearInterval(playbackTimer);
  currentIndex = 0;
  updateMarker(0);
  document.getElementById('playBtn').disabled = false;
  document.getElementById('pauseBtn').disabled = true;
  document.getElementById('stopBtn').disabled = true;
}

function updatePlaybackSpeed() {
  playbackSpeed = parseFloat(document.getElementById('speedSelect').value);
  
  // Restart playback with new speed if currently playing
  if (isPlaying) {
    clearInterval(playbackTimer);
    playbackTimer = setInterval(() => {
      if (currentIndex >= historyData.length - 1) {
        stopTrack();
        return;
      }
      
      currentIndex++;
      updateMarker(currentIndex);
    }, 1000 / playbackSpeed);
  }
}

function updateTimeline() {
  const timeline = document.getElementById('timeline');
  currentIndex = parseInt(timeline.value);
  updateMarker(currentIndex);
  
  // Pause playback when manually scrubbing
  if (isPlaying) {
    pauseTrack();
  }
}

// Export functions
function exportGPX() {
  window.location.href = '/api/history/export/gpx';
}

function exportCSV() {
  window.location.href = '/api/history/export';
}

function clearHistory() {
  if (!confirm('Are you sure you want to clear all history data? This cannot be undone.')) {
    return;
  }
  
  fetch('/api/history/clear', { method: 'POST' })
    .then(response => {
      if (response.ok) {
        alert('History cleared successfully');
        location.reload();
      } else {
        alert('Failed to clear history');
      }
    })
    .catch(error => {
      console.error('Error clearing history:', error);
      alert('Error clearing history');
    });
}

// Parse CSV data
function parseCSV(csvText) {
  const lines = csvText.trim().split('\n');
  const entries = [];
  
  // Skip header line
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.length === 0) continue;
    
    const parts = line.split(',');
    // New format: timestamp,beaconId,latitude,longitude,speed,altitude,battery,rssi,snr
    if (parts.length >= 9) {
      const lat = parseFloat(parts[2]);
      const lon = parseFloat(parts[3]);
      
      // Skip invalid GPS coordinates (0, 0)
      if (lat === 0 && lon === 0) continue;
      
      entries.push({
        timestamp: parseInt(parts[0]),
        beaconId: parts[1].trim(),
        latitude: lat,
        longitude: lon,
        speed: parseFloat(parts[4]),
        altitude: parseFloat(parts[5]),
        battery: parseFloat(parts[6]),
        rssi: parseFloat(parts[7]),
        snr: parseFloat(parts[8])
      });
    } else if (parts.length >= 8) {
      // Old format fallback: timestamp,latitude,longitude,speed,altitude,battery,rssi,snr
      const lat = parseFloat(parts[1]);
      const lon = parseFloat(parts[2]);
      
      // Skip invalid GPS coordinates (0, 0)
      if (lat === 0 && lon === 0) continue;
      
      entries.push({
        timestamp: parseInt(parts[0]),
        beaconId: '',
        latitude: lat,
        longitude: lon,
        speed: parseFloat(parts[3]),
        altitude: parseFloat(parts[4]),
        battery: parseFloat(parts[5]),
        rssi: parseFloat(parts[6]),
        snr: parseFloat(parts[7])
      });
    }
  }
  
  return entries;
}

// Load history data
function loadHistory() {
  fetch('/api/history')
    .then(response => response.text())
    .then(csvText => {
      historyData = parseCSV(csvText);
      
      if (historyData.length === 0) {
        document.querySelector('.controls-panel').style.display = 'none';
        document.getElementById('map').style.display = 'none';
        document.getElementById('noData').style.display = 'block';
        return;
      }
      
      console.log(`Loaded ${historyData.length} history entries`);
      
      // Calculate and display statistics
      calculateStats();
      
      // Draw path on map
      drawPath();
      
      // Show first position
      updateMarker(0);
    })
    .catch(error => {
      console.error('Error loading history:', error);
      document.querySelector('.controls-panel').style.display = 'none';
      document.getElementById('map').style.display = 'none';
      document.getElementById('noData').style.display = 'block';
    });
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  initMap();
  loadHistory();
});
