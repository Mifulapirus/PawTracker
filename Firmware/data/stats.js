// Chart instances
let batteryChart = null;
let uptimeChart = null;

// Color palette for beacons
const beaconColors = [
  { border: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.1)' },  // Purple
  { border: '#3b82f6', bg: 'rgba(59, 130, 246, 0.1)' },  // Blue
  { border: '#10b981', bg: 'rgba(16, 185, 129, 0.1)' },  // Green
  { border: '#f59e0b', bg: 'rgba(245, 158, 11, 0.1)' },  // Orange
  { border: '#ef4444', bg: 'rgba(239, 68, 68, 0.1)' },   // Red
  { border: '#06b6d4', bg: 'rgba(6, 182, 212, 0.1)' },   // Cyan
  { border: '#a855f7', bg: 'rgba(168, 85, 247, 0.1)' },  // Violet
  { border: '#14b8a6', bg: 'rgba(20, 184, 166, 0.1)' }   // Teal
];

// Initialize charts
function initCharts() {
  // Battery Chart
  const batteryCtx = document.getElementById('batteryChart').getContext('2d');
  batteryChart = new Chart(batteryCtx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: 'Station Battery (V)',
          data: [],
          borderColor: '#ec4899',
          backgroundColor: 'rgba(236, 72, 153, 0.1)',
          borderWidth: 2,
          tension: 0.4,
          fill: true,
          spanGaps: true  // Connect points even with null values
        }
        // Beacon datasets will be added dynamically
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false,
      },
      plugins: {
        legend: {
          labels: {
            color: '#fff'
          }
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              return context.dataset.label + ': ' + context.parsed.y.toFixed(2) + 'V';
            }
          }
        }
      },
      scales: {
        x: {
          ticks: {
            color: '#c084fc'
          },
          grid: {
            color: 'rgba(192, 132, 252, 0.1)'
          }
        },
        y: {
          ticks: {
            color: '#c084fc',
            callback: function(value) {
              return value.toFixed(1) + 'V';
            }
          },
          grid: {
            color: 'rgba(192, 132, 252, 0.1)'
          },
          min: 3.0,
          max: 4.5
        }
      }
    }
  });

  // Uptime Chart
  const uptimeCtx = document.getElementById('uptimeChart').getContext('2d');
  uptimeChart = new Chart(uptimeCtx, {
    type: 'bar',
    data: {
      labels: [],
      datasets: [
        {
          label: 'Station Uptime (hours)',
          data: [],
          backgroundColor: 'rgba(236, 72, 153, 0.8)',
          borderColor: '#ec4899',
          borderWidth: 1
        },
        {
          label: 'Beacon Data Points',
          data: [],
          backgroundColor: 'rgba(139, 92, 246, 0.8)',
          borderColor: '#8b5cf6',
          borderWidth: 1,
          yAxisID: 'y1'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: {
            color: '#fff'
          }
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              const hours = context.parsed.y;
              const days = Math.floor(hours / 24);
              const remainingHours = Math.floor(hours % 24);
              if (days > 0) {
                return context.dataset.label + ': ' + days + 'd ' + remainingHours + 'h';
              } else {
                return context.dataset.label + ': ' + remainingHours + 'h';
              }
            }
          }
        }
      },
      scales: {
        x: {
          ticks: {
            color: '#c084fc'
          },
          grid: {
            color: 'rgba(192, 132, 252, 0.1)'
          }
        },
        y: {
          type: 'linear',
          position: 'left',
          ticks: {
            color: '#ec4899',
            callback: function(value) {
              const days = Math.floor(value / 24);
              const hours = Math.floor(value % 24);
              if (days > 0) {
                return days + 'd ' + hours + 'h';
              } else {
                return value + 'h';
              }
            }
          },
          grid: {
            color: 'rgba(192, 132, 252, 0.1)'
          },
          beginAtZero: true,
          title: {
            display: true,
            text: 'Station Uptime',
            color: '#ec4899'
          }
        },
        y1: {
          type: 'linear',
          position: 'right',
          ticks: {
            color: '#8b5cf6',
            callback: function(value) {
              return value;
            }
          },
          grid: {
            drawOnChartArea: false
          },
          beginAtZero: true,
          title: {
            display: true,
            text: 'Beacon Data Points',
            color: '#8b5cf6'
          }
        }
      }
    }
  });
}

// Format uptime duration
function formatUptime(seconds) {
  if (!seconds || seconds < 0) return '--';
  
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  let result = '';
  if (days > 0) result += days + 'd ';
  if (hours > 0 || days > 0) result += hours + 'h ';
  if (minutes > 0 || hours > 0 || days > 0) result += minutes + 'm ';
  result += secs + 's';
  
  return result.trim();
}

// Format bytes to human readable
function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  else if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  else return (bytes / 1048576).toFixed(2) + ' MB';
}

// Update memory statistics
function updateMemoryStats(data) {
  if (data.memory) {
    document.getElementById('freeHeap').textContent = formatBytes(data.memory.freeHeap);
    document.getElementById('totalHeap').textContent = formatBytes(data.memory.totalHeap);
    
    const heapUsagePercent = ((data.memory.totalHeap - data.memory.freeHeap) / data.memory.totalHeap * 100).toFixed(1);
    document.getElementById('heapUsage').textContent = heapUsagePercent + '%';
    
    document.getElementById('configFileSize').textContent = formatBytes(data.memory.configFileSize || 0);
    document.getElementById('historyFileSize').textContent = formatBytes(data.memory.historyFileSize || 0);
    document.getElementById('statsFileSize').textContent = formatBytes(data.memory.statsFileSize || 0);
  }
}

// Update current statistics
function updateCurrentStats(data, dataResponse) {
  // Station stats
  if (data.station) {
    document.getElementById('stationUptime').textContent = formatUptime(data.station.uptime || 0);
    document.getElementById('stationBattery').textContent = data.station.battery ? data.station.battery.toFixed(2) + 'V' : '--';
    document.getElementById('stationReboots').textContent = data.station.rebootCount || 0;
  }
  
  // Render beacon cards dynamically
  const beaconsContainer = document.getElementById('beaconsStatsContainer');
  beaconsContainer.innerHTML = '';
  
  if (dataResponse && dataResponse.beacons && dataResponse.beacons.length > 0) {
    const disconnectTimeout = dataResponse.disconnectTimeout ? dataResponse.disconnectTimeout * 1000 : 60000;
    
    dataResponse.beacons.forEach(beacon => {
      const ageMs = dataResponse.serverTime - beacon.lastUpdate;
      const age = Math.floor(ageMs / 1000);
      const isDisconnected = ageMs > disconnectTimeout;
      
      let lastSeenText = '';
      if (age === 0) {
        lastSeenText = 'Never';
      } else if (age < 60) {
        lastSeenText = age + 's ago';
      } else if (age < 3600) {
        lastSeenText = Math.floor(age / 60) + 'm ago';
      } else {
        lastSeenText = Math.floor(age / 3600) + 'h ago';
      }
      
      // Signal quality percentage
      const signalPercent = Math.max(0, Math.min(100, Math.round((beacon.rssi + 120) * 100 / 90)));
      let signalText = signalPercent + '%';
      if (signalPercent >= 70) signalText += ' (Excellent)';
      else if (signalPercent >= 40) signalText += ' (Good)';
      else if (signalPercent > 0) signalText += ' (Poor)';
      else signalText = 'No Signal';
      
      const statCard = document.createElement('div');
      statCard.className = 'stat-card';
      if (isDisconnected) {
        statCard.style.opacity = '0.4';
        statCard.style.filter = 'grayscale(50%)';
      }
      
      statCard.innerHTML = `
        <h3>🐕 ${beacon.name} ${isDisconnected ? '<span style="color: #f87171; font-size: 0.7em;">(DISCONNECTED)</span>' : ''}</h3>
        <div class='stat-item'>
          <span class='stat-label'>Last Seen</span>
          <span class='stat-value'>${lastSeenText}</span>
        </div>
        <div class='stat-item'>
          <span class='stat-label'>Battery Voltage</span>
          <span class='stat-value'>${beacon.battery ? beacon.battery.toFixed(2) + 'V' : '--'}</span>
        </div>
        <div class='stat-item'>
          <span class='stat-label'>Signal Quality</span>
          <span class='stat-value'>${signalText}</span>
        </div>
      `;
      
      beaconsContainer.appendChild(statCard);
    });
  }
}

// Update detailed statistics table
function updateDetailedStats(data) {
  if (data.stats) {
    // Station statistics
    document.getElementById('stationAvgBat').textContent = 
      data.stats.station.avgBattery ? data.stats.station.avgBattery.toFixed(2) + 'V' : '--';
    document.getElementById('stationMinBat').textContent = 
      data.stats.station.minBattery ? data.stats.station.minBattery.toFixed(2) + 'V' : '--';
    document.getElementById('stationMaxBat').textContent = 
      data.stats.station.maxBattery ? data.stats.station.maxBattery.toFixed(2) + 'V' : '--';
    document.getElementById('stationTotalUptime').textContent = 
      formatUptime(data.stats.station.totalUptime);
    
    // Beacon statistics
    document.getElementById('beaconAvgBat').textContent = 
      data.stats.beacon.avgBattery ? data.stats.beacon.avgBattery.toFixed(2) + 'V' : '--';
    document.getElementById('beaconMinBat').textContent = 
      data.stats.beacon.minBattery ? data.stats.beacon.minBattery.toFixed(2) + 'V' : '--';
    document.getElementById('beaconMaxBat').textContent = 
      data.stats.beacon.maxBattery ? data.stats.beacon.maxBattery.toFixed(2) + 'V' : '--';
    document.getElementById('beaconTotalUptime').textContent = 
      data.stats.beacon.dataPoints ? data.stats.beacon.dataPoints + ' readings' : '--';
  }
}

// Update charts with historical data
function updateCharts(data, dataResponse) {
  if (!data.history || !data.history.length) return;
  
  // Get beacon names from dataResponse
  const beaconNames = {};
  if (dataResponse && dataResponse.beacons) {
    dataResponse.beacons.forEach(beacon => {
      beaconNames[beacon.id] = beacon.name;
    });
  }
  
  // Group data by time buckets (5 minute intervals) for last 24 entries
  const timeBuckets = {};
  const beaconLastValues = {}; // Track last known value for each beacon
  
  data.history.forEach((entry, index) => {
    if (index < data.history.length - 24) return;
    
    const date = new Date(entry.timestamp * 1000);
    const timeLabel = date.getHours() + ':' + String(date.getMinutes()).padStart(2, '0');
    
    if (!timeBuckets[timeLabel]) {
      timeBuckets[timeLabel] = {
        stationBattery: entry.stationBattery || null,
        beacons: {}
      };
    }
    
    // Update station battery (use latest value for this time bucket)
    if (entry.stationBattery) {
      timeBuckets[timeLabel].stationBattery = entry.stationBattery;
    }
    
    // Update beacon battery
    if (entry.beaconId && entry.beaconBattery) {
      timeBuckets[timeLabel].beacons[entry.beaconId] = entry.beaconBattery;
      beaconLastValues[entry.beaconId] = entry.beaconBattery;
    }
  });
  
  // Convert to arrays for Chart.js
  const labels = Object.keys(timeBuckets);
  const stationBatteryData = [];
  const beaconBatteryDataMap = {};
  
  // Initialize beacon data arrays
  Object.keys(beaconLastValues).forEach(beaconId => {
    beaconBatteryDataMap[beaconId] = [];
  });
  
  // Fill data arrays, using last known value for beacons when no data in bucket
  const currentValues = {}; // Track current value for each beacon
  labels.forEach(timeLabel => {
    const bucket = timeBuckets[timeLabel];
    stationBatteryData.push(bucket.stationBattery);
    
    // For each beacon, use value from bucket or carry forward last value
    Object.keys(beaconBatteryDataMap).forEach(beaconId => {
      if (bucket.beacons[beaconId] !== undefined) {
        currentValues[beaconId] = bucket.beacons[beaconId];
      }
      beaconBatteryDataMap[beaconId].push(currentValues[beaconId] || null);
    });
  });
  
  // Uptime data processing (unchanged)
  const uptimeLabels = [];
  const uptimeData = [];
  const beaconDataPoints = [];
  
  data.history.forEach((entry) => {
    const date = new Date(entry.timestamp * 1000);
    const dayLabel = (date.getMonth() + 1) + '/' + date.getDate();
    const uptimeHours = (entry.stationUptime || 0) / 3600;
    const hasBeaconData = entry.beaconBattery && entry.beaconBattery > 0;
    
    const existingIndex = uptimeLabels.indexOf(dayLabel);
    if (existingIndex >= 0) {
      // Update existing day with max uptime seen
      uptimeData[existingIndex] = Math.max(uptimeData[existingIndex], uptimeHours);
      // Count beacon data points for this day
      if (hasBeaconData) {
        beaconDataPoints[existingIndex] = (beaconDataPoints[existingIndex] || 0) + 1;
      }
    } else if (uptimeLabels.length < 7) {
      // Add new day (keep only last 7 days)
      uptimeLabels.push(dayLabel);
      uptimeData.push(uptimeHours);
      beaconDataPoints.push(hasBeaconData ? 1 : 0);
    }
  });
  
  // Update battery chart datasets
  batteryChart.data.labels = labels;
  batteryChart.data.datasets[0].data = stationBatteryData;
  
  // Remove old beacon datasets and add new ones
  batteryChart.data.datasets = batteryChart.data.datasets.slice(0, 1); // Keep only station
  
  // Add dataset for each beacon
  let colorIndex = 0;
  Object.keys(beaconBatteryDataMap).forEach(beaconId => {
    const color = beaconColors[colorIndex % beaconColors.length];
    const beaconName = beaconNames[beaconId] || `Beacon ${beaconId.substring(0, 4)}`;
    
    batteryChart.data.datasets.push({
      label: beaconName + ' Battery (V)',
      data: beaconBatteryDataMap[beaconId],
      borderColor: color.border,
      backgroundColor: color.bg,
      borderWidth: 2,
      tension: 0.4,
      fill: true,
      spanGaps: true  // Connect points even when some data is missing
    });
    
    colorIndex++;
  });
  
  batteryChart.update('none'); // Update without animation for smoother updates
  
  // Update uptime chart
  uptimeChart.data.labels = uptimeLabels;
  uptimeChart.data.datasets[0].data = uptimeData;
  uptimeChart.data.datasets[1].data = beaconDataPoints;
  uptimeChart.update('none');
}

// Fetch statistics from server
function fetchStats() {
  // Fetch both /api/data for beacon info and /api/stats for statistics
  Promise.all([
    fetch('/api/data').then(r => r.json()),
    fetch('/api/stats').then(r => r.json()),
    fetch('/api/beacons/list').then(r => r.json())
  ])
    .then(([dataResponse, statsResponse, beaconsConfig]) => {
      // Merge disconnect timeout from config
      if (beaconsConfig.disconnectTimeout) {
        dataResponse.disconnectTimeout = beaconsConfig.disconnectTimeout;
      }
      if (beaconsConfig.serverTime) {
        dataResponse.serverTime = beaconsConfig.serverTime;
      }
      
      // Update stats using /api/stats data
      updateMemoryStats(statsResponse);
      updateCurrentStats(statsResponse, dataResponse);
      updateDetailedStats(statsResponse);
      updateCharts(statsResponse, dataResponse);
    })
    .catch(error => {
      console.error('Error fetching stats:', error);
    });
}

// Export statistics as CSV
function exportStats() {
  fetch('/api/stats/export')
    .then(response => response.blob())
    .then(blob => {
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'pawtracker_stats_' + new Date().toISOString().split('T')[0] + '.csv';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    })
    .catch(error => {
      console.error('Error exporting stats:', error);
      alert('Failed to export statistics');
    });
}

// Clear statistics
function clearStats() {
  if (confirm('⚠️ This will delete all historical statistics data.\n\nCurrent uptime will be preserved, but all historical data will be lost.\n\nContinue?')) {
    fetch('/api/stats/clear', { method: 'POST' })
      .then(response => {
        if (response.ok) {
          alert('✓ Statistics cleared successfully');
          location.reload();
        } else {
          alert('❌ Failed to clear statistics');
        }
      })
      .catch(error => {
        console.error('Error clearing stats:', error);
        alert('❌ Error clearing statistics');
      });
  }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', function() {
  initCharts();
  fetchStats();
  
  // Update every 10 seconds
  setInterval(fetchStats, 10000);
});
