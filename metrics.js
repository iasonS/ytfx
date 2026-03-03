// Performance metrics collection
// Tracks timing for each operation to identify bottlenecks

const metrics = {
  operations: [], // Array of operation timing records
  MAX_RECORDS: 1000, // Keep last 1000 operations for memory efficiency
};

/**
 * Record a timed operation
 * @param {string} operation - Operation name (e.g., 'oEmbed', 'yt-dlp', 'cache-hit')
 * @param {number} durationMs - Duration in milliseconds
 * @param {object} metadata - Additional metadata (videoId, type, status)
 */
function recordOperation(operation, durationMs, metadata = {}) {
  const record = {
    timestamp: Date.now(),
    operation,
    durationMs: Math.round(durationMs),
    ...metadata,
  };

  metrics.operations.push(record);

  // Keep only last MAX_RECORDS to prevent memory bloat
  if (metrics.operations.length > metrics.MAX_RECORDS) {
    metrics.operations.shift();
  }

  // Log slow operations (>2 seconds)
  if (durationMs > 2000) {
    console.log(`[SLOW] ${operation}: ${durationMs.toFixed(0)}ms`, metadata);
  }
}

/**
 * Get aggregated metrics summary
 * @param {number} limitHours - Look back this many hours (default: 24)
 * @returns {object} Aggregated statistics
 */
function getMetricsSummary(limitHours = 24) {
  const now = Date.now();
  const cutoffTime = now - limitHours * 60 * 60 * 1000;

  // Filter to recent records
  const recent = metrics.operations.filter(r => r.timestamp > cutoffTime);

  if (recent.length === 0) {
    return {
      summary: 'No data',
      total_operations: 0,
      time_range_hours: limitHours,
    };
  }

  // Group by operation type
  const byOperation = {};
  recent.forEach(r => {
    if (!byOperation[r.operation]) {
      byOperation[r.operation] = [];
    }
    byOperation[r.operation].push(r.durationMs);
  });

  // Calculate statistics per operation
  const stats = {};
  for (const [op, durations] of Object.entries(byOperation)) {
    const sorted = durations.sort((a, b) => a - b);
    const sum = durations.reduce((a, b) => a + b, 0);
    const count = durations.length;

    stats[op] = {
      count,
      avg: Math.round(sum / count),
      min: Math.min(...durations),
      max: Math.max(...durations),
      p50: sorted[Math.floor(count * 0.5)],
      p95: sorted[Math.floor(count * 0.95)],
      p99: sorted[Math.floor(count * 0.99)],
    };
  }

  // Calculate request flow times (oEmbed + yt-dlp durations for same videoId)
  const requestFlows = {};
  recent.forEach(r => {
    if (r.videoId && (r.operation === 'oEmbed' || r.operation === 'yt-dlp')) {
      if (!requestFlows[r.videoId]) {
        requestFlows[r.videoId] = {};
      }
      requestFlows[r.videoId][r.operation] = r.durationMs;
    }
  });

  // Calculate combined times
  const combinedTimes = Object.values(requestFlows)
    .filter(flow => flow.oEmbed && flow['yt-dlp'])
    .map(flow => {
      // They run in parallel, so total is max of both
      return Math.max(flow.oEmbed, flow['yt-dlp']);
    });

  return {
    time_range_hours: limitHours,
    total_operations: recent.length,
    operations: stats,
    request_flow: {
      sample_count: combinedTimes.length,
      avg_parallel_time: combinedTimes.length
        ? Math.round(combinedTimes.reduce((a, b) => a + b, 0) / combinedTimes.length)
        : 0,
      max_parallel_time: combinedTimes.length ? Math.max(...combinedTimes) : 0,
      p95_parallel_time: combinedTimes.length
        ? combinedTimes.sort((a, b) => a - b)[Math.floor(combinedTimes.length * 0.95)]
        : 0,
    },
    raw_recent: recent.slice(-20), // Last 20 operations for debugging
  };
}

/**
 * Get detailed operation records (for advanced debugging)
 * @param {string} filterOperation - Optional: filter by operation name
 * @param {number} limit - Max records to return (default: 100)
 * @returns {array} Operation records
 */
function getOperationHistory(filterOperation = null, limit = 100) {
  let filtered = metrics.operations;

  if (filterOperation) {
    filtered = filtered.filter(r => r.operation === filterOperation);
  }

  return filtered.slice(-limit);
}

/**
 * Reset all metrics (useful for testing)
 */
function resetMetrics() {
  metrics.operations = [];
}

export { recordOperation, getMetricsSummary, getOperationHistory, resetMetrics };
