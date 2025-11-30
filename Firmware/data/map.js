// Initialize map
var map = L.map('map').setView([0, 0], 2);

// Add OpenStreetMap tiles (free!)
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap contributors',
  maxZoom: 19
}).addTo(map);

// Custom icons
var beaconIcon = L.icon({
  iconUrl: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMTUiIGN5PSIxNSIgcj0iMTIiIGZpbGw9IiNGRjY1MDAiIHN0cm9rZT0iI2ZmZiIgc3Ryb2tlLXdpZHRoPSIyIi8+PHRleHQgeD0iMTUiIHk9IjIxIiBmb250LXNpemU9IjE2IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIj7wn5CVPC90ZXh0Pjwvc3ZnPg==',
  iconSize: [30, 40],
  iconAnchor: [15, 40],
  popupAnchor: [0, -40]
});

var stationIcon = L.icon({
  iconUrl: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMTUiIGN5PSIxNSIgcj0iMTIiIGZpbGw9IiM0Q0FGNTAiIHN0cm9rZT0iI2ZmZiIgc3Ryb2tlLXdpZHRoPSIyIi8+PHRleHQgeD0iMTUiIHk9IjIxIiBmb250LXNpemU9IjE2IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIj7wn5OxPC90ZXh0Pjwvc3ZnPg==',
  iconSize: [30, 40],
  iconAnchor: [15, 40],
  popupAnchor: [0, -40]
});

var beaconMarker = null;
var stationMarker = null;
var browserMarker = null;
var pathLine = null;
var hasInitialView = false;
var watchId = null;

// Custom icon for browser location (phone/computer)
var browserIcon = L.icon({
  iconUrl: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMTUiIGN5PSIxNSIgcj0iMTIiIGZpbGw9IiNlYzQ4OTkiIHN0cm9rZT0iI2ZmZiIgc3Ryb2tlLXdpZHRoPSIyIi8+PHRleHQgeD0iMTUiIHk9IjIxIiBmb250LXNpemU9IjE2IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIj7wn5OrPC90ZXh0Pjwvc3ZnPg==',
  iconSize: [30, 40],
  iconAnchor: [15, 40],
  popupAnchor: [0, -40]
});

// Start tracking browser location
function startBrowserLocationTracking() {
  if (!('geolocation' in navigator)) {
    console.warn('Geolocation not supported by browser');
    alert('⚠️ Geolocation not supported by your browser');
    return;
  }
  
  console.log('Requesting geolocation permission...');
  
  // Request permission and start tracking
  navigator.geolocation.getCurrentPosition(
    function(position) {
      // Success - permission granted, now start continuous tracking
      console.log('Geolocation permission granted!');
      
      watchId = navigator.geolocation.watchPosition(
        function(position) {
          var lat = position.coords.latitude;
          var lon = position.coords.longitude;
          var accuracy = position.coords.accuracy;
          
          console.log('Browser location:', lat, lon, 'accuracy:', accuracy, 'm');
          
          // Update or create browser marker
          if (browserMarker) {
            browserMarker.setLatLng([lat, lon]);
            browserMarker.getPopup().setContent('<b>📱 Your Phone</b><br>' +
                        'Lat: ' + lat.toFixed(6) + '°<br>' +
                        'Lon: ' + lon.toFixed(6) + '°<br>' +
                        'Accuracy: ± ' + accuracy.toFixed(0) + ' m');
          } else {
            browserMarker = L.marker([lat, lon], {icon: browserIcon})
              .addTo(map)
              .bindPopup('<b>📱 Your Phone</b><br>' +
                        'Lat: ' + lat.toFixed(6) + '°<br>' +
                        'Lon: ' + lon.toFixed(6) + '°<br>' +
                        'Accuracy: ± ' + accuracy.toFixed(0) + ' m');
            console.log('Browser marker added to map');
          }
          
          // Update map view
          updateMapView();
        },
        function(error) {
          console.error('Geolocation tracking error:', error.code, error.message);
        },
        {
          enableHighAccuracy: true,
          maximumAge: 5000,
          timeout: 10000
        }
      );
    },
    function(error) {
      // Permission denied or error
      console.error('Geolocation permission error:', error.code, error.message);
      
      var errorMsg = '';
      switch(error.code) {
        case error.PERMISSION_DENIED:
          errorMsg = '📍 Location permission denied. Please enable location access in your browser settings.';
          break;
        case error.POSITION_UNAVAILABLE:
          errorMsg = '📍 Location information unavailable. Make sure GPS is enabled.';
          break;
        case error.TIMEOUT:
          errorMsg = '📍 Location request timed out. Please try again.';
          break;
        default:
          errorMsg = '📍 Unknown error getting location: ' + error.message;
      }
      
      console.warn(errorMsg);
      alert(errorMsg);
    },
    {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 0
    }
  );
}

function updateBeaconData() {
  fetch('/api/data')
    .then(response => response.json())
    .then(data => {
      // Update station location from GPS
      console.log('Station data:', data.station);
      
      // Only show station if it has valid fix with satellites and non-zero coordinates
      var stationHasValidFix = data.station && 
                               data.station.hasValidFix && 
                               data.station.sats > 0 &&
                               data.station.latitude !== 0.0 &&
                               data.station.longitude !== 0.0;
      
      if (stationHasValidFix) {
        var stationLat = data.station.latitude;
        var stationLon = data.station.longitude;
        
        console.log('Station has valid fix:', stationLat, stationLon, 'sats:', data.station.sats);
        
        // Update or create station marker
        if (stationMarker) {
          stationMarker.setLatLng([stationLat, stationLon]);
        } else {
          stationMarker = L.marker([stationLat, stationLon], {icon: stationIcon})
            .addTo(map)
            .bindPopup('<b>📱 Station (You)</b><br>' +
                      'Lat: ' + stationLat.toFixed(6) + '°<br>' +
                      'Lon: ' + stationLon.toFixed(6) + '°<br>' +
                      'Satellites: ' + data.station.sats);
        }
        
        document.getElementById('stationInfo').textContent = 
          stationLat.toFixed(6) + '°, ' + stationLon.toFixed(6) + '° (' + data.station.sats + ' sats)';
      } else {
        // Remove marker if it exists and we lost fix
        if (stationMarker) {
          map.removeLayer(stationMarker);
          stationMarker = null;
        }
        
        var debugInfo = 'Getting GPS fix...';
        if (data.station) {
          debugInfo += ' (sats: ' + data.station.sats + ')';
          console.log('Station GPS data present but no valid fix:', data.station);
        } else {
          console.log('No station data in API response');
        }
        document.getElementById('stationInfo').textContent = debugInfo;
      }
      
      // Update beacon location - only show if valid fix with satellites and non-zero coordinates
      var beaconHasValidFix = data.hasData && 
                              data.sats > 0 &&
                              data.latitude !== 0.0 &&
                              data.longitude !== 0.0;
      
      // Update last contact time whenever we have data from beacon (regardless of GPS fix)
      if (data.hasData) {
        if (!window.lastBeaconUpdate || data.lastUpdate !== window.lastBeaconUpdate) {
          window.lastBeaconUpdate = data.lastUpdate;
          window.lastBeaconUpdateTime = Date.now();
        }
        
        // Calculate age based on local time
        var age = Math.floor((Date.now() - window.lastBeaconUpdateTime) / 1000);
        document.getElementById('lastUpdate').textContent = age + ' seconds ago';
      } else {
        document.getElementById('lastUpdate').textContent = 'No beacon data yet';
      }
      
      if (beaconHasValidFix) {
        var beaconLat = data.latitude;
        var beaconLon = data.longitude;
        
        // Update or create beacon marker
        if (beaconMarker) {
          beaconMarker.setLatLng([beaconLat, beaconLon]);
        } else {
          beaconMarker = L.marker([beaconLat, beaconLon], {icon: beaconIcon})
            .addTo(map)
            .bindPopup('<b>🐕 Beacon (Dog)</b><br>' + 
                      'Lat: ' + beaconLat.toFixed(6) + '°<br>' +
                      'Lon: ' + beaconLon.toFixed(6) + '°<br>' +
                      'Satellites: ' + data.sats + '<br>' +
                      'Battery: ' + data.battery.toFixed(2) + ' V');
        }
        
        document.getElementById('beaconInfo').textContent = 
          beaconLat.toFixed(6) + '°, ' + beaconLon.toFixed(6) + '° (' + data.sats + ' sats)';
      } else {
        // Remove marker if it exists and we lost fix
        if (beaconMarker) {
          map.removeLayer(beaconMarker);
          beaconMarker = null;
        }
        
        if (data.hasData) {
          document.getElementById('beaconInfo').textContent = 'Waiting for GPS fix... (' + data.sats + ' sats)';
        } else {
          document.getElementById('beaconInfo').textContent = 'Waiting for beacon...';
        }
      }
      
      updateMapView();
      updateDistance();
      updatePath();
    })
    .catch(error => {
      console.error('Error fetching data:', error);
    });
}

function updateMapView() {
  var markers = [];
  if (beaconMarker) markers.push(beaconMarker);
  if (stationMarker) markers.push(stationMarker);
  if (browserMarker) markers.push(browserMarker);
  
  if (markers.length >= 2) {
    // Multiple markers - fit map to show all
    var group = L.featureGroup(markers);
    map.fitBounds(group.getBounds().pad(0.2));
    hasInitialView = true;
  } else if (markers.length === 1 && !hasInitialView) {
    // Only one marker - zoom to it
    var markerLatLng = markers[0].getLatLng();
    map.setView(markerLatLng, 16);
    hasInitialView = true;
  }
}

function updateDistance() {
  if (beaconMarker && stationMarker) {
    var beaconLatLng = beaconMarker.getLatLng();
    var stationLatLng = stationMarker.getLatLng();
    
    // Calculate distance in meters
    var distance = map.distance(beaconLatLng, stationLatLng);
    
    // Format distance for info panel
    var distanceText;
    if (distance < 1000) {
      distanceText = distance.toFixed(0) + ' meters';
    } else {
      distanceText = (distance / 1000).toFixed(2) + ' km';
    }
    
    document.getElementById('distance').textContent = distanceText;
    
    // Update fullscreen overlay with distance in meters
    var distanceOverlay = document.getElementById('distanceValue');
    if (distance < 1000) {
      distanceOverlay.textContent = distance.toFixed(0) + ' m';
    } else {
      distanceOverlay.textContent = (distance / 1000).toFixed(2) + ' km';
    }
  } else {
    document.getElementById('distance').textContent = '--';
    document.getElementById('distanceValue').textContent = '--';
  }
}

function updatePath() {
  if (beaconMarker && stationMarker) {
    var beaconLatLng = beaconMarker.getLatLng();
    var stationLatLng = stationMarker.getLatLng();
    
    if (pathLine) {
      pathLine.setLatLngs([beaconLatLng, stationLatLng]);
    } else {
      pathLine = L.polyline([beaconLatLng, stationLatLng], {
        color: '#ec4899',
        weight: 3,
        opacity: 0.7,
        dashArray: '10, 10'
      }).addTo(map);
    }
  } else if (pathLine) {
    // Remove path line if either marker is missing
    map.removeLayer(pathLine);
    pathLine = null;
  }
}

// Fullscreen functionality
var isFullscreen = false;

function toggleFullscreen() {
  var mapElement = document.getElementById('map');
  var overlay = document.getElementById('distanceOverlay');
  var btn = document.querySelector('.fullscreen-btn');
  
  isFullscreen = !isFullscreen;
  
  if (isFullscreen) {
    mapElement.classList.add('fullscreen');
    overlay.classList.add('show');
    btn.textContent = '⛶';
    btn.style.position = 'fixed';
    btn.style.zIndex = '10000';
    
    // Invalidate map size after fullscreen transition
    setTimeout(function() {
      map.invalidateSize();
    }, 100);
  } else {
    mapElement.classList.remove('fullscreen');
    overlay.classList.remove('show');
    btn.textContent = '⛶';
    btn.style.position = 'absolute';
    btn.style.zIndex = '1000';
    
    // Invalidate map size after exiting fullscreen
    setTimeout(function() {
      map.invalidateSize();
    }, 100);
  }
}

// Exit fullscreen on escape key
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape' && isFullscreen) {
    toggleFullscreen();
  }
});

// Start browser location tracking
// Disabled for now
// startBrowserLocationTracking();

// Update beacon data every 1 seconds
setInterval(updateBeaconData, 1000);

// Initial load
updateBeaconData();
