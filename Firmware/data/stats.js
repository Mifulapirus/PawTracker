// Chart instances
let batteryChart = null;
let uptimeChart = null;

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
          fill: true
        },
        {
          label: 'Beacon Battery (V)',
          data: [],
          borderColor: '#8b5cf6',
          backgroundColor: 'rgba(139, 92, 246, 0.1)',
          borderWidth: 2,
          tension: 0.4,
          fill: true
        }
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
    
    document.getElementById('statsFileSize').textContent = formatBytes(data.memory.statsFileSize);
    document.getElementById('sketchSize').textContent = formatBytes(data.memory.sketchSize);
    document.getElementById('freeSketch').textContent = formatBytes(data.memory.freeSketch);
  }
}

// Update current statistics
function updateCurrentStats(data) {
  // Station stats
  if (data.station) {
    document.getElementById('stationUptime').textContent = formatUptime(data.station.uptime);
    document.getElementById('stationBattery').textContent = data.station.battery.toFixed(2) + 'V';
    document.getElementById('stationReboots').textContent = data.station.rebootCount || 0;
  }
  
  // Beacon stats
  if (data.beacon) {
    const lastSeen = data.beacon.lastSeen || 0;
    if (lastSeen === 0) {
      document.getElementById('beaconLastSeen').textContent = 'Never';
    } else if (lastSeen < 60) {
      document.getElementById('beaconLastSeen').textContent = lastSeen + 's ago';
    } else if (lastSeen < 3600) {
      document.getElementById('beaconLastSeen').textContent = Math.floor(lastSeen / 60) + 'm ago';
    } else {
      document.getElementById('beaconLastSeen').textContent = Math.floor(lastSeen / 3600) + 'h ago';
    }
    
    document.getElementById('beaconBattery').textContent = data.beacon.battery.toFixed(2) + 'V';
    
    // Signal quality percentage
    const signalPercent = Math.max(0, Math.min(100, Math.round((data.beacon.rssi + 120) * 100 / 90)));
    let signalText = signalPercent + '%';
    if (signalPercent >= 70) signalText += ' (Excellent)';
    else if (signalPercent >= 40) signalText += ' (Good)';
    else if (signalPercent > 0) signalText += ' (Poor)';
    else signalText = 'No Signal';
    document.getElementById('beaconSignal').textContent = signalText;
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
function updateCharts(data) {
  if (!data.history || !data.history.length) return;
  
  // Prepare data for charts
  const labels = [];
  const stationBatteryData = [];
  const beaconBatteryData = [];
  const uptimeLabels = [];
  const uptimeData = [];
  const beaconDataPoints = [];
  
  // Process history data (last 24 hours for battery, last 7 days for uptime)
  data.history.forEach((entry, index) => {
    const date = new Date(entry.timestamp * 1000);
    const timeLabel = date.getHours() + ':' + String(date.getMinutes()).padStart(2, '0');
    
    // Battery data (show last 24 entries)
    if (index >= data.history.length - 24) {
      labels.push(timeLabel);
      stationBatteryData.push(entry.stationBattery || null);
      beaconBatteryData.push(entry.beaconBattery || null);
    }
    
    // Uptime data (aggregate by day for last 7 days)
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
  
  // Update battery chart
  batteryChart.data.labels = labels;
  batteryChart.data.datasets[0].data = stationBatteryData;
  batteryChart.data.datasets[1].data = beaconBatteryData;
  batteryChart.update('none'); // Update without animation for smoother updates
  
  // Update uptime chart
  uptimeChart.data.labels = uptimeLabels;
  uptimeChart.data.datasets[0].data = uptimeData;
  uptimeChart.data.datasets[1].data = beaconDataPoints;
  uptimeChart.update('none');
}

// Fetch statistics from server
function fetchStats() {
  fetch('/api/stats')
    .then(response => response.json())
    .then(data => {
      updateMemoryStats(data);
      updateCurrentStats(data);
      updateDetailedStats(data);
      updateCharts(data);
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
