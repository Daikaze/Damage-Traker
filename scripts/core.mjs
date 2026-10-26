/**
 * Damage Hall of Fame - independent calculations, safe to test in Node.
 * A "damage event" is one evaluated damage-roll chat message or one target's
 * applied damage in Midi-QOL mode. Never re-evaluate a dice formula.
 */
export const DAMAGE_TYPES = [
  "acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic",
  "piercing", "poison", "psychic", "radiant", "slashing", "thunder"
];
export const UNKNOWN = "untyped";
export const TYPE_NAMES = Object.fromEntries([
  ...DAMAGE_TYPES.map(type => [type, type[0].toUpperCase() + type.slice(1)]),
  [UNKNOWN, "Other / Unknown"]
]);
export const ALL_TYPES = [...DAMAGE_TYPES, UNKNOWN];

export function number(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
}
const rounded = n => Math.round(n * 100) / 100;
export function normalizeType(value) {
  const type = String(value ?? "").trim().toLowerCase().replace(/[^a-z]/g, "");
  return DAMAGE_TYPES.includes(type) ? type : UNKNOWN;
}
const nameOfClass = roll => String(roll?.constructor?.name ?? roll?.class ?? "");
const validType = value => DAMAGE_TYPES.includes(String(value ?? "").toLowerCase());
const typeFrom = opts => [opts?.damageType, opts?.type, opts?.flavor]
  .find(validType)?.toLowerCase() ?? "";

function trySplitTerms(roll, total) {
  const terms = roll.terms;
  if (!Array.isArray(terms) || !terms.length) return null;
  const parts = {};
  let sum = 0, sign = 1, foundTyped = false;
  for (const term of terms) {
    if (typeof term.operator === "string") {
      if (term.operator !== "+" && term.operator !== "-") return null;
      sign = term.operator === "+" ? 1 : -1;
      continue;
    }
    const amount = Number(term.total ?? term.number);
    if (!Number.isFinite(amount)) return null;
    const type = typeFrom(term.options) || UNKNOWN;
    if (type !== UNKNOWN) foundTyped = true;
    parts[type] = (parts[type] ?? 0) + sign * amount;
    sum += sign * amount;
    sign = 1;
  }
  if (!foundTyped || Math.abs(sum - total) > 0.01 ||
      Object.values(parts).some(value => value < 0)) return null;
  return Object.fromEntries(Object.entries(parts)
    .filter(([, value]) => value > 0)
    .map(([key, value]) => [key, rounded(value)]));
}

/**
 * Returns {damage, types, critical, formula} or null.
 * D&D5e 3.x+ supplies separate DamageRoll objects, each with options.type.
 * V11-era 2.x can supply one combined roll with flavored terms.
 * If a combined formula cannot be split EXACTLY, assign it to "untyped".
 */
export function extractDamage(rolls, messageRollType = "") {
  if (!Array.isArray(rolls)) return null;
  const parts = {};
  const formulas = [];
  let critical = false;
  let seenDamage = false;
  for (const roll of rolls) {
    if (!roll) continue;
    const opts = roll.options ?? {};
    const optType = String(opts.type ?? opts.rollType ?? "").toLowerCase();
    if (["healing", "heal", "temphp", "temporary", "temporaryhealing"].includes(optType) ||
        opts.isHealing === true) continue;
    const damaged = nameOfClass(roll).includes("DamageRoll") ||
      String(messageRollType).toLowerCase() === "damage" ||
      String(opts.rollType ?? "").toLowerCase() === "damage";
    if (!damaged) continue;
    const amount = number(roll.total);
    if (!amount) continue;
    seenDamage = true;
    critical ||= opts.critical === true || opts.isCritical === true;
    if (roll.formula) formulas.push(String(roll.formula));
    const type = typeFrom(opts);
    const breakdown = type ? {[type]: amount} :
      trySplitTerms(roll, amount) ?? {[UNKNOWN]: amount};
    for (const [key, value] of Object.entries(breakdown)) {
      parts[key] = rounded((parts[key] ?? 0) + value);
    }
  }
  const damage = rounded(Object.values(parts).reduce((a, b) => a + b, 0));
  return seenDamage && damage > 0 ? {
    damage, types: parts, critical, formula: formulas.join(" + ")
  } : null;
}

export function filteredDamage(record, type = "all") {
  const types = record.types;
  if (types && typeof types === "object") {
    if (type !== "all") return number(types[type]);
    return rounded(Object.values(types).reduce((sum, amount) => sum + number(amount), 0));
  }
  // Legacy manually-created records.
  return type === "all" || type === (record.type ?? UNKNOWN) ? number(record.damage) : 0;
}

export function leaderboard(records, metric = "hit", type = "all") {
  const groups = new Map();
  for (const record of records ?? []) {
    const damage = filteredDamage(record, type);
    if (!damage) continue;
    const name = String(record.actorName ?? "").trim();
    if (!name) continue;
    const key = record.actorId ? "actor:" + record.actorId : "name:" + name.toLowerCase();
    let group = groups.get(key);
    if (!group) {
      group = {actorId: record.actorId || "", actorName: name,
        total: 0, bestHit: 0, bestRecord: null, bestOutside: 0, outsideRecord: null,
        rounds: new Map(), count: 0};
      groups.set(key, group);
    }
    group.actorName = name;
    group.total = rounded(group.total + damage);
    group.count++;
    if (damage > group.bestHit) {
      group.bestHit = damage;
      group.bestRecord = record;
    }
    const round = Number(record.round);
    if (record.combatId && Number.isInteger(round) && round >= 1) {
      const id = String(record.combatId) + ":" + round;
      const previous = group.rounds.get(id) ?? {amount: 0, round, count: 0};
      previous.amount = rounded(previous.amount + damage);
      previous.count++;
      group.rounds.set(id, previous);
    } else if (damage > group.bestOutside) {
      group.bestOutside = damage;
      group.outsideRecord = record;
    }
  }
  const rows = [];
  for (const group of groups.values()) {
    const bestRound = [...group.rounds.values()].sort((a, b) => b.amount - a.amount)[0];
    // Highest Hit sums each PC's applied hits inside one combat round;
    // outside combat it retains the strongest individual applied hit.
    const combatWins = (bestRound?.amount ?? 0) > group.bestOutside;
    const highest = combatWins ? bestRound.amount : group.bestOutside;
    const amount = metric === "total" ? group.total :
      metric === "round" ? (bestRound?.amount ?? 0) : highest;
    if (!amount) continue;
    const detail = metric === "total" ? group.count + " applied damage events" :
      metric === "round" ? "Round " + bestRound.round :
      combatWins ? "Combat round " + bestRound.round +
        " • " + bestRound.count + " applied " + (bestRound.count === 1 ? "hit" : "hits") :
      (group.outsideRecord?.note || "Applied hit");
    rows.push({...group, amount, detail});
  }
  return rows.sort((a, b) => b.amount - a.amount ||
    a.actorName.localeCompare(b.actorName))
    .map((row, i) => ({...row, rank: i + 1}));
}
