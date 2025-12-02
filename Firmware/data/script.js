let disconnectTimeout = 60000; // Default 60 seconds in milliseconds

function updateData() {
  // Fetch both data and config
  Promise.all([
    fetch('/api/data').then(r => r.json()),
    fetch('/api/beacons/list').then(r => r.json())
  ])
  .then(([data, config]) => {
    // Update disconnect timeout from config
    if (config.disconnectTimeout) {
      disconnectTimeout = config.disconnectTimeout * 1000;
    }
    
    if (data.beacons && data.beacons.length > 0) {
      document.getElementById('noData').style.display = 'none';
      document.getElementById('dataContainer').style.display = 'block';
      
      // Render beacon cards dynamically
      const beaconsContainer = document.getElementById('beaconsContainer');
      beaconsContainer.innerHTML = '';
      
      data.beacons.forEach(beacon => {
        const age = Math.floor((data.serverTime - beacon.lastUpdate) / 1000);
        const ageMs = data.serverTime - beacon.lastUpdate;
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
            <h2>🐕 ${beacon.name} ${isDisconnected ? '<span style="color: #f87171; font-size: 0.7em;">(DISCONNECTED)</span>' : ''}</h2>
            <div style='display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; font-size: 0.9em;'>
              <div>
                <div class='label' style='font-size: 0.85em;'>Location</div>
                <div class='value' style='font-size: 0.95em;'>${beacon.latitude.toFixed(5)}°, ${beacon.longitude.toFixed(5)}°</div>
                <a href='https://www.google.com/maps?q=${beacon.latitude},${beacon.longitude}' target='_blank' style='color: var(--accent-purple); font-size: 0.85em; text-decoration: none;'>📍 Map</a>
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
        
        
        // Station Status
        if (data.station) {
          const statusEl = document.getElementById('stationStatus');
          if (data.station.hasValidFix) {
            statusEl.textContent = 'Fixed';
            statusEl.style.color = '#4ade80';
          } else {
            statusEl.textContent = 'No Fix';
            statusEl.style.color = '#f87171';
          }
          document.getElementById('stationSats').textContent = data.station.sats;
          
          if (data.station.hasValidFix) {
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
    })
    .catch(error => {
      console.error('Error fetching data:', error);
    });
}

function toggleLED() {
  fetch('/led').then(() => updateData());
}

function toggleBuzzer() {
  fetch('/buzzer').then(() => updateData());
}

function resetWiFi() {
  if (confirm('⚠️ This will reset WiFi credentials and reboot the device.\n\nThe device will enter setup mode and create a WiFi access point called "PawTracker-Setup".\n\nConnect to it to configure a new WiFi network.\n\nContinue?')) {
    fetch('/reset-wifi')
      .then(response => {
        if (response.ok) {
          alert('✓ WiFi reset initiated!\n\nDevice is rebooting...\n\nLook for "PawTracker-Setup" WiFi network in a few seconds.');
          // Give user time to read the message before connection drops
          setTimeout(() => {
            window.location.reload();
          }, 3000);
        } else {
          alert('❌ Failed to reset WiFi. Please try again.');
        }
      })
      .catch(error => {
        console.error('Error resetting WiFi:', error);
        alert('❌ Error resetting WiFi: ' + error.message);
      });
  }
}

// Update data every 5 seconds
setInterval(updateData, 5000);

// Initial load
updateData();
