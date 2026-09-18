// The observation row contract. Extractors only ever produce these; no derived
// stats, no scaling, no judgement. One row is one fact read from one source.
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

export const RAW_INPUTS = [
  'base_hp', 'size_base', 'size_gold',
  'enrage_attack_mult', 'enrage_speed_mult', 'enrage_trigger', 'enrage_duration',
  'hitzone_max_raw', 'head_stagger',
  'tolerance_poison', 'tolerance_paralysis', 'tolerance_sleep', 'tolerance_stun',
  'move_power_max',
];

const COLUMNS = ['monster', 'game', 'input', 'value', 'unit', 'source'];

export function obsRow({ monster, game, input, value, unit, source }) {
  if (!monster) throw new Error('observation needs a monster id');
  if (!game) throw new Error('observation needs a game');
  if (!RAW_INPUTS.includes(input)) throw new Error(`unknown input ${input}`);
  if (!Number.isFinite(value)) throw new Error(`observation ${monster}/${input} needs a numeric value`);
  if (!unit) throw new Error('observation needs a unit');
  if (!source) throw new Error('observation needs a source URL');
  return { monster, game, input, value, unit, source };
}

function esc(v) {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function splitCsvLine(line) {
  const out = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

export function writeObservations(rows, path) {
  const sorted = rows.slice().sort((a, b) =>
    a.monster.localeCompare(b.monster) || a.input.localeCompare(b.input) || a.game.localeCompare(b.game));
  const body = sorted.map(r => COLUMNS.map(c => esc(r[c])).join(',')).join('\n');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${COLUMNS.join(',')}\n${body}\n`);
  return sorted;
}

export function readObservations(path) {
  const lines = readFileSync(path, 'utf8').trim().split('\n');
  return lines.slice(1).map(line => {
    const cells = splitCsvLine(line);
    const row = Object.fromEntries(COLUMNS.map((c, i) => [c, cells[i]]));
    row.value = Number(row.value);
    return row;
  });
}
