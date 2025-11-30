function updateData() {
  fetch('/api/data')
    .then(response => response.json())
    .then(data => {
      if (data.hasData) {
        document.getElementById('noData').style.display = 'none';
        document.getElementById('dataContainer').style.display = 'block';
        
        // GPS Location
        document.getElementById('latitude').textContent = data.latitude.toFixed(6) + '°';
        document.getElementById('longitude').textContent = data.longitude.toFixed(6) + '°';
        document.getElementById('mapLink').href = 'https://www.google.com/maps?q=' + data.latitude + ',' + data.longitude;
        
        // Store last update time for age calculation
        if (!window.lastBeaconUpdate || data.lastUpdate !== window.lastBeaconUpdate) {
          window.lastBeaconUpdate = data.lastUpdate;
          window.lastBeaconUpdateTime = Date.now();
        }
        
        // Calculate age based on local time
        let age = Math.floor((Date.now() - window.lastBeaconUpdateTime) / 1000);
        document.getElementById('lastUpdate').textContent = 'Last update: ' + age + ' seconds ago';
        
        // Beacon Status
        document.getElementById('sats').textContent = data.sats;
        document.getElementById('hdop').textContent = data.hdop.toFixed(1);
        document.getElementById('battery').textContent = data.battery.toFixed(2) + ' V';
        document.getElementById('signal').textContent = data.rssi.toFixed(0) + ' dBm (SNR: ' + data.snr.toFixed(1) + ' dB)';
        
        // Actuators
        let ledStatus = document.getElementById('ledStatus');
        ledStatus.textContent = 'LED: ' + (data.ledOn ? 'ON' : 'OFF');
        ledStatus.className = 'status ' + (data.ledOn ? 'on' : 'off');
        
        let buzzerStatus = document.getElementById('buzzerStatus');
        buzzerStatus.textContent = 'Buzzer: ' + (data.buzzerOn ? 'ON' : 'OFF');
        buzzerStatus.className = 'status ' + (data.buzzerOn ? 'on' : 'off');
        
        // Last control command received
        let lastCmd = '--';
        if (data.lastControlReceived !== undefined) {
          if (data.lastControlReceived === 0) lastCmd = 'None';
          else if (data.lastControlReceived === 1) lastCmd = 'LED';
          else if (data.lastControlReceived === 2) lastCmd = 'Buzzer';
          else if (data.lastControlReceived === 3) lastCmd = 'LED + Buzzer';
        }
        document.getElementById('lastCommand').textContent = lastCmd;
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
