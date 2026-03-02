import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';

let SQL = null;
let db = null;

// Initialize SQL.js
async function initDb() {
  try {
    SQL = await initSqlJs();
    const dbPath = getDbPath();

    // Try to load existing database
    if (dbPath !== ':memory:' && fs.existsSync(dbPath)) {
      const buffer = fs.readFileSync(dbPath);
      db = new SQL.Database(buffer);
      console.log(`[DB] Loaded from ${dbPath}`);
    } else {
      db = new SQL.Database();
      console.log(`[DB] Created new in-memory database`);
    }

    // Create tables
    db.run(`
      CREATE TABLE IF NOT EXISTS requests (
        id          INTEGER PRIMARY KEY,
        timestamp   INTEGER NOT NULL,
        video_id    TEXT,
        type        TEXT,
        ip          TEXT,
        user_agent  TEXT,
        referer     TEXT,
        ref         TEXT,
        success     INTEGER,
        response_ms INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_requests_timestamp ON requests(timestamp);
      CREATE INDEX IF NOT EXISTS idx_requests_video_id ON requests(video_id);
      CREATE INDEX IF NOT EXISTS idx_requests_type ON requests(type);
      CREATE INDEX IF NOT EXISTS idx_requests_ref ON requests(ref);
    `);

    saveDb();
    return true;
  } catch (error) {
    console.error(`[DB] Failed to initialize:`, error.message);
    return false;
  }
}

// Determine database path
function getDbPath() {
  if (process.env.NODE_ENV === 'test') {
    return ':memory:';
  }
  if (process.env.DB_PATH) {
    return process.env.DB_PATH;
  }
  try {
    if (!fs.existsSync('/data')) {
      fs.mkdirSync('/data', { recursive: true });
    }
    return '/data/ytfx.db';
  } catch (error) {
    return '/tmp/ytfx.db';
  }
}

// Save database to disk
function saveDb() {
  try {
    const dbPath = getDbPath();
    if (dbPath !== ':memory:' && db) {
      const data = db.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(dbPath, buffer);
    }
  } catch (error) {
    console.error(`[DB] Failed to save database:`, error.message);
  }
}

// Log a request
function logRequest(req, videoId, type, success = 1, responseMs = 0) {
  if (!db) return;

  try {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const userAgent = req.get('user-agent') || '';
    const referer = req.get('referer') || '';
    const ref = req.query?.ref || null;
    const timestamp = Date.now();

    db.run(
      `INSERT INTO requests (timestamp, video_id, type, ip, user_agent, referer, ref, success, response_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [timestamp, videoId, type, ip, userAgent, referer, ref, success ? 1 : 0, responseMs]
    );

    // Save periodically to avoid constant I/O
    if (Math.random() < 0.1) {
      saveDb();
    }
  } catch (error) {
    console.error(`[DB] Failed to log request:`, error.message);
  }
}

// Get statistics
function getStats() {
  if (!db) return null;

  try {
    const now = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;
    const oneHourMs = 60 * 60 * 1000;

    // All time requests
    const allTimeCount = db.exec(`SELECT COUNT(*) as count FROM requests`)[0]?.values[0]?.[0] || 0;

    // Today's requests
    const todayCount = db.exec(`SELECT COUNT(*) as count FROM requests WHERE timestamp > ?`, [now - oneDayMs])[0]?.values[0]?.[0] || 0;

    // Last hour requests
    const lastHourCount = db.exec(`SELECT COUNT(*) as count FROM requests WHERE timestamp > ?`, [now - oneHourMs])[0]?.values[0]?.[0] || 0;

    // Top videos
    const topVideosResult = db.exec(
      `SELECT video_id, COUNT(*) as count FROM requests WHERE video_id IS NOT NULL GROUP BY video_id ORDER BY count DESC LIMIT 10`
    );
    const topVideos = topVideosResult[0]?.values?.map(([video_id, count]) => ({ video_id, count })) || [];

    // By type
    const byTypeResult = db.exec(
      `SELECT type, COUNT(*) as count FROM requests WHERE type IS NOT NULL GROUP BY type ORDER BY count DESC`
    );
    const byType = byTypeResult[0]?.values?.map(([type, count]) => ({ type, count })) || [];

    // Success rate
    const successResult = db.exec(
      `SELECT COUNT(*) as total, SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successful FROM requests`
    )[0]?.values[0] || [0, 0];
    const [total, successful] = successResult;
    const successRate = total > 0 ? ((successful / total) * 100).toFixed(2) : 0;

    // Top refs
    const topRefsResult = db.exec(
      `SELECT ref, COUNT(*) as count FROM requests WHERE ref IS NOT NULL GROUP BY ref ORDER BY count DESC LIMIT 10`
    );
    const topRefs = topRefsResult[0]?.values?.map(([ref, count]) => ({ ref, count })) || [];

    return {
      requests: {
        all_time: allTimeCount,
        today: todayCount,
        last_hour: lastHourCount,
      },
      top_videos: topVideos,
      by_type: byType,
      success_rate: parseFloat(successRate),
      top_refs: topRefs,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error(`[DB] Failed to get stats:`, error.message);
    return null;
  }
}

// Check if database is connected
function isConnected() {
  return db !== null;
}

// Close and save database
function closeDb() {
  if (db) {
    saveDb();
    db.close();
    db = null;
    console.log('[DB] Closed and saved');
  }
}

export { initDb, logRequest, getStats, isConnected, closeDb };
