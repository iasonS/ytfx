// Turns the rating pass into data/ratings.json.
//
// Speed has no published source for any monster, and Attack has none for the 130 monsters
// whose games do not publish per-move damage. Both are judged here, against a fixed anchor
// table, and every value carries the reason that justifies it.
//
// Applies three things on top of the raw rating pass:
//   1. The calibration reviewer's corrections. It read all 252 placements as one ranking
//      and caught the specific failure this rating exists to avoid: large monsters rated
//      slow for being large. Fatalis, Ukanlos, Shara Ishvalda and Anjanath were all it.
//   2. Fourteen Attack values the rating pass missed.
//   3. Removal of one non-monster artifact an agent emitted.
import { readFileSync, writeFileSync } from 'fs';
import { baseSpeciesOf } from './merge.js';

const DATA = new URL('./data/', import.meta.url).pathname;
const roster = JSON.parse(readFileSync(`${DATA}roster.json`, 'utf8'));
const ids = new Set(roster.map(r => r.id));
const raw = JSON.parse(readFileSync(process.argv[2] ?? '/tmp/ratings.json', 'utf8'));

const byId = new Map();
for (const r of raw.ratings) {
  if (!ids.has(r.id)) continue; // drops the agent's "ukanlos_dup_guard" artifact
  byId.set(r.id, { ...r });
}

// 1. Calibration corrections, each with the reviewer's own reason.
const CORRECTIONS = [
  ['ancient-leshen', 'spd', 180, 'shares Leshen\'s moveset but attacks faster and more often'],
  ['agnaktor', 'spd', 135, 'lava-diving ambusher with quick beam sweeps; its own subspecies already sits higher'],
  ['ukanlos', 'spd', 150, 'near-identical animation set to Akantor; the gap was a bulk penalty, not a tempo difference'],
  ['shara-ishvalda', 'spd', 160, 'only the armoured first phase is ponderous; unveiled it dashes, swipes and sweeps rapidly'],
  ['anjanath', 'spd', 150, 'its lunge-bite combos are brisk; it was rated on bulk while its own subspecies sat 55 higher'],
  ['tidal-najarala', 'spd', 165, 'same coil-and-whip tempo as Najarala; a palette and element swap does not slow it'],
  ['fatalis', 'spd', 190, 'repositions constantly and chains fast bites and fireballs: classic bulk-rated-slow'],
  ['old-fatalis', 'spd', 190, 'the most mobile of the three Fatalis forms on the ground'],
  ['amatsu', 'spd', 205, 'airborne elder that repositions continuously with fast wind-dashes'],
  ['ahtal-ka', 'spd', 215, 'leaps, wall-scales and scuttles at insect tempo, and the mech phase fires rapid barrages'],
  ['arzuros', 'spd', 120, 'its own Redhelm and Apex forms run the same animations and were rated far higher'],
  ['soulseer-mizutsune', 'atk', 165, 'a deviant should not sit below its own base species'],
  ['desert-seltas-queen', 'atk', 170, 'same slam, charge and drill-mount set as Seltas Queen, and the tougher encounter'],
  ['boltreaver-astalos', 'atk', 170, 'Astalos is a light, fast striker; its deviant was placed above far heavier monsters'],
];
let corrected = 0;
for (const [id, stat, value, why] of CORRECTIONS) {
  const r = byId.get(id);
  if (!r) throw new Error(`correction names unknown monster ${id}`);
  r[stat] = value;
  r[`${stat}_reason`] = `${why} (calibration correction)`;
  corrected++;
}

// 2. Attack values the rating pass left out, placed against the same anchors.
const MISSING_ATK = [
  ['baleful-gigginox', 100, 'works through poison and grabs rather than force, a shade above base Gigginox'],
  ['dreadking-rathalos', 175, 'a deviant Rathalos whose fireball barrages hit well above the base'],
  ['goldbeard-ceadeus', 230, 'a siege elder whose body slams land in Deviljho territory'],
  ['hirabami', 130, 'a slender ice leviathan trading on chilling rather than raw force'],
  ['hypnocatrice', 95, 'a bird wyvern with light pecks and a sleep gimmick, near Arzuros'],
  ['king-shakalaka', 55, 'tiny, and does its damage through magic tricks rather than weight'],
  ['lao-shan-lung', 70, 'enormous but its attacks are simple, slow shoves rather than strikes'],
  ['plesioth', 155, 'the hip check is infamous precisely because it hits far harder than it looks'],
  ['plum-daimyo-hermitaur', 135, 'slams a heavy borrowed skull shell, above Rathian but short of Diablos'],
  ['purple-ludroth', 115, 'a mid-tier leviathan subspecies, around the Rathian baseline'],
  ['shrouded-nerscylla', 145, 'a deviant spider leaning on webs and poison more than impact'],
  ['thunderlord-zinogre', 215, 'a permanently charged deviant whose thunder hits near Deviljho weight'],
  ['ukanlos', 250, 'an Akantor-scale digger whose charges and slams rank among the heaviest'],
  ['vespoid-queen', 85, 'an oversized insect that paralyses rather than overpowers'],
];
let added = 0;
for (const [id, value, why] of MISSING_ATK) {
  const r = byId.get(id);
  if (!r) throw new Error(`missing-attack entry names unknown monster ${id}`);
  if (r.atk !== undefined) continue;
  r.atk = value;
  r.atk_reason = why;
  added++;
}

// 4. Five Attack values the rating pass returned without the reason the contract requires.
// The numbers are sound against the anchors, so the reasoning is supplied rather than the
// values discarded.
const RESCUED = [
  ['gravios', 'the heat beam and belly slam land near Glavenus weight, though it commits to them rarely'],
  ['gypceros', 'light pecks and tail flails that work through poison and flashes rather than force'],
  ['stonefist-hermitaur', 'swings a borrowed shell and oversized claws for weight well above Rathalos'],
  ['tidal-najarala', 'coil-and-whip strikes land above Rathalos, but it leans on sound and binding'],
  ['vaal-hazak', 'drains through effluvium more than it strikes, so mid-range despite being an elder'],
];
for (const [id, why] of RESCUED) {
  const r = byId.get(id);
  if (!r || r.atk === undefined || r.atk_reason) continue;
  r.atk_reason = why;
}

// 5. Drop any Attack rating for a monster whose game DOES publish per-move damage. A couple
// of agents rated beyond their brief; measured damage always wins over a judgement.
// A variant counts as measured when its BASE SPECIES has the damage figure, because
// inheritance gives it that value before curation runs. Bloodbath Diablos takes Diablos's.
const measuredDirect = new Set(
  readFileSync(`${DATA}observations.csv`, 'utf8').trim().split('\n').slice(1)
    .map(l => l.split(','))
    .filter(c => c[2] === 'move_power_max')
    .map(c => c[0]),
);
const measured = new Set(measuredDirect);
for (const entry of roster) {
  const base = baseSpeciesOf(entry.id, roster);
  if (base && measuredDirect.has(base)) measured.add(entry.id);
}
let dropped = 0;
for (const r of byId.values()) {
  if (r.atk !== undefined && measured.has(r.id)) {
    delete r.atk;
    delete r.atk_reason;
    dropped++;
  }
}

const out = [...byId.values()]
  .sort((a, b) => a.id.localeCompare(b.id))
  .map(r => (r.atk === undefined
    ? { id: r.id, name: r.name, spd: r.spd, spd_reason: r.spd_reason }
    : { id: r.id, name: r.name, spd: r.spd, spd_reason: r.spd_reason, atk: r.atk, atk_reason: r.atk_reason }));

for (const r of out) {
  for (const [k, v] of [['spd', r.spd], ['atk', r.atk]]) {
    if (v === undefined) continue;
    if (!Number.isInteger(v) || v < 1 || v > 300) throw new Error(`${r.id}.${k} = ${v} is outside 1..300`);
    if (!r[`${k}_reason`]) throw new Error(`${r.id}.${k} has no reason`);
  }
}

writeFileSync(`${DATA}ratings.json`, `${JSON.stringify(out, null, 2)}\n`);
console.log(`ratings: ${out.length} monsters rated for Speed, ${out.filter(r => r.atk !== undefined).length} for Attack ` +
  `(${corrected} calibration corrections, ${added} attack values filled in, ${dropped} dropped for having measured damage)`);
