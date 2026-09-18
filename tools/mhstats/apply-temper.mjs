// Merges the Temper rating pass into data/ratings.json.
//
// Temper is the fourth stat to lose its published source. It was the mean of damage-to-
// enrage and rage duration; both are real numbers and both measure the wrong thing, because
// the damage needed to anger a monster scales with its health pool and with its game's
// damage numbers rather than with its temperament. That formula ranked Rajang 221st of 252.
import { readFileSync, writeFileSync } from 'fs';

const DATA = new URL('./data/', import.meta.url).pathname;
const CACHE = '/home/unix/tmp/mhstats-cache/ratings/';

const roster = JSON.parse(readFileSync(`${DATA}roster.json`, 'utf8'));
const byName = new Map(roster.map(r => [r.name, r.id]));
const ratings = JSON.parse(readFileSync(`${DATA}ratings.json`, 'utf8'));
const byId = new Map(ratings.map(r => [r.id, { ...r }]));

const pass = JSON.parse(readFileSync(process.argv[2] ?? `${CACHE}pass3-temper.json`, 'utf8'));
let merged = 0;
for (const r of pass.ratings) {
  const mine = byId.get(r.id);
  if (!mine) continue;
  mine.tmp = r.tmp;
  mine.tmp_reason = r.tmp_reason;
  merged++;
}

// The calibration reviewer read the whole ranking as one list. Most of these are monsters
// two shards rated differently, or a variant that failed to sit above its base species.
const CORRECTIONS = [
  ['Rusted Kushala Daora', 190, 'the only variant rated below its base form'],
  ['Gaismagorm', 195, 'an enormous rooted siege boss, not a monster that comes looking for you'],
  ['Thunder Serpent Narwa', 145, 'stationary through long channelled phases; rated for spectacle rather than aggression'],
  ["Xeno'jiiva", 175, 'hostile and attacking from the moment it hatches; it was docked for being slow'],
  ['Old Fatalis', 265, 'no reason for it to sit below the other two Fatalis forms'],
  ['Gigginox', 110, 'two shards disagreed by 30 points; the low one was an outlier'],
  ['Gammoth', 85, 'lumbering, but the low entry undersold how readily it stomps'],
  ['Jyuratodus', 100, 'the low entry put it under Great Jagras, which is not defensible'],
  ['Jade Barroth', 148, 'the low entry left the subspecies barely above base Barroth'],
  ['Goldbeard Ceadeus', 42, 'still a migrating whale; more than double base Ceadeus was too much'],
  ['Guardian Rathalos', 180, 'a Guardian form should sit well above base Rathalos, not 15 points'],
  ['Giadrome', 115, 'its sibling dromes cluster higher; the low entry was an outlier'],
  ['Hypnocatrice', 120, 'a 20-point spread on a monster whose behaviour is not ambiguous'],
  ['Gobul', 78, 'an ambush predator, but not below Black Gravios'],
];
for (const [name, value, why] of CORRECTIONS) {
  const id = byName.get(name);
  const r = id && byId.get(id);
  if (!r) throw new Error(`temper correction names unknown monster ${name}`);
  r.tmp = value;
  r.tmp_reason = `${why} (calibration correction)`;
}

// Thirty-five monsters the pass skipped, placed against the same anchors.
const MISSED = [
  ['Rajang', 300, 'the series byword for unprovoked fury: hostile on sight and never lets up'],
  ['Furious Rajang', 298, 'permanently enraged, and the only thing in the series that rivals base Rajang'],
  ['Seething Bazelgeuse', 265, 'a deviant of a monster that already seeks hunters out to bomb them'],
  ['Chaotic Gore Magala', 255, 'caught between forms and lashing out constantly'],
  ['Apex Mizutsune', 250, 'an Apex form that fights at full pitch from the opening moment'],
  ['Molten Tigrex', 240, 'a deviant of a monster that charges anything that moves'],
  ['Crimson Glow Valstrax', 235, 'dives out of the sky the moment it sees a hunter and repeats without pause'],
  ['Behemoth', 230, 'fixates on a hunter and pursues them through every phase of the fight'],
  ['Ebony Odogaron', 225, 'a predator that closes immediately and keeps biting'],
  ['Deadeye Yian Garuga', 225, 'a deviant of an already ill-tempered monster, and it holds a grudge'],
  ['Thunderlord Zinogre', 225, 'permanently supercharged and aggressive throughout'],
  ['Brachydios', 215, 'punches first and keeps advancing, slime detonating behind it'],
  ['Silverwind Nargacuga', 210, 'a deviant that re-engages from a new angle rather than breaking off'],
  ['Stygian Zinogre', 210, 'pounces early and stays on a hunter once charged'],
  ['Frostfang Barioth', 210, 'a deviant that harries continuously across the ice'],
  ['Ukanlos', 200, 'bursts out of the snow at hunters and keeps coming'],
  ['Lunastra', 195, 'territorial and quick to fill the arena with blue flame'],
  ['Nu Udra', 190, 'sprawls across the arena and attacks anything within reach of a limb'],
  ['Shara Ishvalda', 185, 'placid while armoured, relentless once it unveils'],
  ['Rey Dau', 175, 'an apex that defends its storm and answers intrusion immediately'],
  ['Blackveil Vaal Hazak', 165, 'more forward than base Vaal Hazak, pushing its miasma onto hunters'],
  ['Rompopolo', 160, 'erratic and provocative, constantly jabbing and gassing'],
  ['Almudron', 150, 'hauls its mud-weighted tail at anything that enters the marsh'],
  ['Narwa the Allmother', 150, 'devastating, but it holds position through long channelled phases'],
  ['Rustrazor Ceanataur', 150, 'a deviant crab that advances behind its blades rather than guarding one spot'],
  ['Pink Rathian', 135, 'slightly more forward than Rathian in defending its nest'],
  ['Agnaktor', 130, 'surfaces to strike and burrows away again rather than pursuing'],
  ['Velocidrome', 128, 'harries in a pack but breaks off between passes'],
  ['Ash Kecha Wacha', 125, 'skittish, covering its ears and retreating as often as attacking'],
  ['Wind Serpent Ibushi', 120, 'a siege serpent that holds the sky and channels rather than chasing'],
  ['Baleful Gigginox', 120, 'an ambusher that drops and clings rather than hunting a target down'],
  ['Zamtrios', 120, 'ambushes from the ice and inflates to defend rather than press'],
  ['Purple Ludroth', 115, 'patrols its water and swipes at what comes close'],
  ['Kulu-Ya-Ku', 105, 'skittish, would rather run off with an egg'],
  ['Dodogama', 85, 'chews rocks and only lobs one when something bothers it'],
  ['Lao-Shan Lung', 5, 'ignores you entirely and keeps walking'],
];
let filled = 0;
for (const [name, value, why] of MISSED) {
  const id = byName.get(name);
  const r = id && byId.get(id);
  if (!r) throw new Error(`missed-temper entry names unknown monster ${name}`);
  r.tmp = value;
  r.tmp_reason = why;
  filled++;
}

const out = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
const gaps = [];
for (const r of out) {
  for (const k of ['spd', 'atk', 'tmp']) {
    const v = r[k];
    if (v === undefined) { gaps.push(`${r.id}.${k}`); continue; }
    if (!Number.isInteger(v) || v < 1 || v > 300) throw new Error(`${r.id}.${k} = ${v} is outside 1..300`);
    if (!r[`${k}_reason`]) throw new Error(`${r.id}.${k} has no reason`);
  }
}
if (gaps.length) throw new Error(`${gaps.length} unrated: ${gaps.slice(0, 12).join(', ')}`);

// Rajang tops Temper, by the owner's call. Nothing outside the Rajang line sits above it.
const ranked = out.slice().sort((a, b) => b.tmp - a.tmp);
if (ranked[0].name !== 'Rajang') {
  throw new Error(`Rajang must be the highest Temper; ${ranked[0].name} is at ${ranked[0].tmp}`);
}

writeFileSync(`${DATA}ratings.json`, `${JSON.stringify(out, null, 2)}\n`);
console.log(`temper: ${out.length} monsters rated (${merged} from the pass, ${CORRECTIONS.length} corrections, ${filled} filled in)`);
console.log(`top five: ${ranked.slice(0, 5).map(r => `${r.name} ${r.tmp}`).join(', ')}`);
