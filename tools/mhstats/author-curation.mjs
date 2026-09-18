// Authors data/curation.json for the stats no source and no base species supplies.
// Every entry carries the reason it exists. Run: node tools/mhstats/author-curation.mjs
//
// Three kinds of gap, and they are filled on different grounds:
//  1. Status-immune monsters. Will is the sum of poison/paralysis/sleep/stun tolerance.
//     A monster that cannot be afflicted at all has effectively infinite tolerance, so
//     it sits at the top of the scale. This is a fact about the game, not a judgement.
//  2. Fixed-size monsters. The siege monsters have no crown data because they do not
//     vary in size, but their size is well known and extreme in one direction.
//  3. Generations Ultimate records no enrage data at all, and 3 Ultimate records no base
//     HP, so Attack, Speed, Temper and HP for those monsters are placed by judgement
//     against comparable monsters that do have the number.
import { readFileSync, writeFileSync } from 'fs';

const DATA = new URL('./data/', import.meta.url).pathname;
const roster = JSON.parse(readFileSync(`${DATA}roster.json`, 'utf8'));
const byName = new Map(roster.map(r => [r.name, r.id]));

const out = [];
const add = (name, stat, value, reason) => {
  const id = byName.get(name);
  if (!id) throw new Error(`author-curation: no roster monster named ${name}`);
  out.push({ id, stat, value, reason });
};

// ---- 1. Status immunity: Will at the top of the scale -----------------------------
const IMMUNE = {
  'Zorah Magdaros': 'every status cell is blank in World data: it cannot be poisoned, paralysed, slept or stunned',
  'Jhen Mohran': '3U lists every status as 無効 (no effect)',
  'Hallowed Jhen Mohran': '3U lists every status as 無効 (no effect)',
  'Dalamadur': '4U records a tolerance of 0 for every status, meaning immune',
  'Shah Dalamadur': '4U records a tolerance of 0 for every status, meaning immune',
  "Dah'ren Mohran": '4U records a tolerance of 0 for every status, meaning immune',
  'Lao-Shan Lung': 'siege monster with no status rows in any source; cannot be afflicted',
  'Ashen Lao-Shan Lung': 'siege monster with no status rows in any source; cannot be afflicted',
  'Shen Gaoren': 'siege monster with no status rows in any source; cannot be afflicted',
  'Yama Tsukami': 'siege monster with no status rows in any source; cannot be afflicted',
  'Ceadeus': 'underwater siege elder; 3U records no status tolerances for it',
  'Goldbeard Ceadeus': 'underwater siege elder; 3U records no status tolerances for it',
  'Dire Miralis': 'siege elder dragon; 3U records no status tolerances for it',
};
for (const [name, why] of Object.entries(IMMUNE)) add(name, 'wil', 298, `immune to status: ${why}`);
add('Gobul', 'wil', 150, 'mid-tier 3U monster whose tolerance table is blank; placed with its 3U peers');

// ---- 2. Fixed-size monsters: no crowns, but the size is not in doubt ---------------
const SIZE = [
  ['Dalamadur', 300, 'the longest monster in the series, measured in the thousands of centimetres'],
  ['Shah Dalamadur', 300, 'the elder form of the longest monster in the series'],
  ['Jhen Mohran', 288, 'a sand whale large enough to be fought from a ship'],
  ['Hallowed Jhen Mohran', 288, 'a sand whale large enough to be fought from a ship'],
  ["Dah'ren Mohran", 282, 'a sand whale fought from the deck of a ship, slightly below Jhen'],
  ['Dire Miralis', 280, 'a volcano-sized siege elder dragon'],
  ['Ceadeus', 276, 'a whale-like elder fought across several underwater areas'],
  ['Goldbeard Ceadeus', 278, 'the older, larger form of an already whale-sized elder'],
  ['Shen Gaoren', 266, 'a castle-sized carapaceon that wears a fortress as a shell'],
  ['Yama Tsukami', 254, 'a floating whale-sized elder that carries a forest on its back'],
  ['King Shakalaka', 6, 'a Shakalaka: among the smallest large monsters in the series'],
  ['Vespoid Queen', 34, 'an oversized insect, small even among low-rank monsters'],
];
for (const [name, value, why] of SIZE) add(name, 'siz', value, `fixed-size monster with no crown data; ${why}`);

// ---- 3a. Generations Ultimate: no enrage data exists at all ------------------------
// [name, attack, speed, temper, character]
const GU = [
  ['Agnaktor', 190, 120, 140, 'armoured lava wyvern that fights deliberately, burrowing and surfacing'],
  ['Ahtal-Ka', 265, 235, 250, 'the Generations final boss, relentless and constantly aggressive'],
  ['Bulldrome', 95, 205, 250, 'a charging boar that spends most of the fight enraged and rushing'],
  ['Duramboros', 175, 75, 105, 'enormously heavy, slow to turn, built around a hammer tail'],
  ['Gammoth', 200, 70, 110, 'a mammoth: huge, deliberate, and hard to provoke into speed'],
  ['Elderfrost Gammoth', 225, 85, 135, 'the deviant mammoth, harder hitting and quicker to anger than the base'],
  ['Giadrome', 60, 160, 165, 'a small pack leader; quick but hits for very little'],
  ['Great Maccao', 90, 225, 185, 'a leaping bird wyvern built entirely around fast kicks'],
  ['Lao-Shan Lung', 70, 20, 15, 'a walking siege monster that never truly enrages and cannot be stopped or hurried'],
  ['Malfestio', 150, 210, 155, 'an owl that flits erratically and confuses rather than overpowers'],
  ['Nightcloak Malfestio', 170, 225, 180, 'the deviant owl, faster and more aggressive than the base'],
  ['Nakarkos', 235, 155, 200, 'an elder dragon that fights with bone-armoured tentacles at close range'],
  ['Nibelsnarf', 110, 145, 150, 'a sand shark that ambushes from below rather than pressing an attack'],
  ['Plesioth', 155, 150, 160, 'an amphibious wyvern best known for a heavy body check'],
  ['Rustrazor Ceanataur', 185, 130, 170, 'a deviant crab with bladed claws; armoured rather than fast'],
  ['Stonefist Hermitaur', 195, 110, 165, 'a deviant crab that fights from behind a shell, slow but heavy'],
  ['Valstrax', 275, 285, 235, 'an elder dragon with rocket wings, the fastest in its generation'],
];
for (const [name, , , tmp, why] of GU) {
  // Attack and Speed for these monsters now come from data/ratings.json.
  add(name, 'tmp', tmp, `Generations Ultimate records no enrage threshold or duration; ${why}`);
}
// (Lao-Shan Lung's Will is already covered by the immunity table above.)

// ---- 3b. 3 Ultimate: base HP is not published anywhere -----------------------------
const HP_3U = [
  ['Gigginox', 150, 'a mid-tier 3U flying wyvern, comparable to its generation peers'],
  ['Baleful Gigginox', 170, 'the subspecies, tougher than the base Gigginox'],
  ['Qurupeco', 120, 'an early-game bird wyvern, among the weaker monsters of its generation'],
  ['Crimson Qurupeco', 145, 'the subspecies, a step above the base bird wyvern'],
  ['Purple Ludroth', 140, 'a mid-tier leviathan subspecies'],
  ['Gobul', 145, 'a mid-tier ambush leviathan'],
  ['Ceadeus', 270, 'a siege elder fought across multiple underwater areas over a long hunt'],
  ['Goldbeard Ceadeus', 285, 'the elder form of an already siege-scale whale'],
  ['Jhen Mohran', 280, 'a siege monster fought from a ship, with a health pool to match'],
  ['Hallowed Jhen Mohran', 290, 'the subspecies of a siege monster, tougher than the base'],
  ['Dire Miralis', 292, 'the 3 Ultimate final boss, a volcano-scale elder dragon'],
];
for (const [name, hp, why] of HP_3U) {
  add(name, 'hp', hp, `3 Ultimate publishes no base HP in any source; ${why}`);
}
add('Dire Miralis', 'tmp', 190, '3U enrage cells are blank; aggressive but too vast to be quick to anger');
add('Jhen Mohran', 'tmp', 25, '3U duration cell reads ？; a siege whale that never truly rages');
add('Hallowed Jhen Mohran', 'tmp', 35, '3U enrage cells are blank; marginally hotter than base Jhen');

// ---- 3c. Freedom Unite: no speed, trigger or duration in the source ----------------
const FU = [
  ['Hypnocatrice', 195, 175, 'a bird wyvern that darts and pecks, quick but not enormous'],
  ['King Shakalaka', 165, 210, 'a tiny Shakalaka that scurries constantly and provokes easily'],
  ['Vespoid Queen', 150, 140, 'a hovering insect queen: mobile in the air, unhurried on the ground'],
  ['Shen Gaoren', 45, 30, 'a castle-sized siege crab that advances at a crawl'],
  ['Yama Tsukami', 25, 20, 'a floating elder that drifts rather than moves, and barely reacts'],
  ['Ashen Lao-Shan Lung', 25, 18, 'a walking siege monster that cannot be hurried or truly enraged'],
];
for (const [name, , tmp, why] of FU) {
  add(name, 'tmp', tmp, `Freedom Unite records no enrage trigger or duration; ${why}`);
}

out.sort((a, b) => a.id.localeCompare(b.id) || a.stat.localeCompare(b.stat));
writeFileSync(`${DATA}curation.json`, `${JSON.stringify(out, null, 2)}\n`);

const byStat = {};
for (const c of out) byStat[c.stat] = (byStat[c.stat] ?? 0) + 1;
console.log(`curation: ${out.length} entries`, byStat);
