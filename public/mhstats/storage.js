// Run persistence against an injected Web Storage-like object. Every access is guarded:
// private windows, blocked storage and quota errors must never break the game.

export const STORAGE_KEY = 'mhstats.runs.v1';
export const MAX_RUNS = 50;

export function loadRuns(storage) {
  try {
    const raw = storage && storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveRun(storage, record) {
  const runs = [record, ...loadRuns(storage)].slice(0, MAX_RUNS);
  try {
    if (storage) storage.setItem(STORAGE_KEY, JSON.stringify(runs));
  } catch {
    // storage unavailable or full: the caller still gets the in-memory list
  }
  return runs;
}

export function topRuns(records, n = 10) {
  return records
    .slice()
    .sort((a, b) => (b.score - a.score) || String(b.at).localeCompare(String(a.at)))
    .slice(0, n);
}
