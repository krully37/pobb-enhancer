// Mod text -> trade stat id matching, ported from Awakened PoE Trade
// (renderer/src/parser/stat-translations.ts, MIT) and simplified for PoB text,
// where rolls are already resolved to plain numbers.

const WEAPON = new Set([
  'Fishing Rod', 'Bow', 'Wand', 'One-Handed Axe', 'One-Handed Mace', 'One-Handed Sword',
  'Claw', 'Dagger', 'Rune Dagger', 'Sceptre', 'Two-Handed Axe', 'Two-Handed Mace',
  'Two-Handed Sword', 'Staff', 'Warstaff'
])
const ARMOUR = new Set(['Body Armour', 'Boots', 'Gloves', 'Helmet', 'Shield'])
const HEIST_EQUIPMENT = new Set(['Heist Tool', 'Heist Brooch', 'Heist Gear', 'Heist Cloak'])

function testCategory (actual, expected) {
  if (actual == null) return false
  switch (expected) {
    case 'WEAPON': return WEAPON.has(actual)
    case 'ARMOUR': return ARMOUR.has(actual)
    case 'HEIST_EQUIPMENT': return HEIST_EQUIPMENT.has(actual)
    default: return expected === actual
  }
}

const PLACEHOLDER_MAP = [
  [[]],
  [[0], []],
  [[0, 1], [0], [1], []],
  [[0, 1, 2], [1, 2], [0, 2], [0, 1], [2], [1], [0]],
  [[0, 1, 2, 3], [1, 2, 3], [0, 2, 3], [0, 1, 3], [0, 1, 2], [2, 3], [1, 3], [1, 2], [0, 3], [0, 2], [0, 1]]
]

// Yields the stat with some numbers kept literal and the rest replaced by '#',
// most-literal first, as APT does.
function * placeholderCombos (stat) {
  const rolls = []
  const withPlaceholders = stat.replace(/(?<!\d|\))[+-]?\d+(?:\.\d+)?/g, (roll) => {
    rolls.push({ str: roll, value: Number(roll), decimal: roll.includes('.') })
    return '#'
  })
  if (rolls.length < PLACEHOLDER_MAP.length) {
    for (const keep of PLACEHOLDER_MAP[rolls.length]) {
      let idx = -1
      const replaced = withPlaceholders.replace(/#/g, () => {
        idx += 1
        return keep.includes(idx) ? rolls[idx].str : '#'
      })
      yield { stat: replaced, values: rolls.filter((_, i) => !keep.includes(i)).map(r => ({ ...r })) }
    }
  }
  yield { stat, values: [] }
}

function cloneStat (stat) {
  return { ...stat, trade: { ...stat.trade, ids: Object.fromEntries(Object.entries(stat.trade.ids).map(([k, v]) => [k, [...v]])) } }
}

function mergeIdsInto (dest, source, prefix = '') {
  for (const modType in source.trade.ids) {
    const id = prefix + source.trade.ids[modType][0]
    if (dest.trade.ids[modType]) {
      if (!dest.trade.ids[modType].includes(id)) dest.trade.ids[modType].push(id)
    } else {
      dest.trade.ids[modType] = [id]
    }
  }
}

const hasMatcher = (stat, str) => stat.matchers.some(m => m.string === str || m.advanced === str)

function resolveGroup (group, { matchStr, modType, category, roll }) {
  const { resolve, stats } = group
  if (resolve.strat === 'select') {
    let idx = resolve.test.findIndex(t => t !== null && testCategory(category, t))
    if (idx === -1) idx = resolve.test.indexOf(null)
    return idx !== -1 ? stats[idx] : undefined
  }
  const onTrade = stats.filter(s => modType in s.trade.ids)
  if (onTrade.length === 1) return onTrade[0]

  if (resolve.strat === 'trivial-merge') {
    const withStr = onTrade.filter(s => hasMatcher(s, matchStr))
    if (!withStr.length) return undefined
    const merged = cloneStat(withStr[0])
    for (const s of withStr.slice(1)) mergeIdsInto(merged, s)
    return merged
  }
  if (resolve.strat === 'percent-merge') {
    const pct = stats[resolve.kind.indexOf('percent')]
    const matcher = pct.matchers.find(m => m.string === matchStr || m.advanced === matchStr)
    if (matcher && matcher.value === 100) {
      const other = stats[resolve.kind.indexOf('value')]
      const flag = other.matchers.length === 1 && !other.matchers[0].string.includes('#')
      const merged = cloneStat(pct)
      mergeIdsInto(merged, other, flag ? '{empty_if_100}' : '{div_by_100}')
      return merged
    }
    return stats.find(s => hasMatcher(s, matchStr))
  }
  if (resolve.strat === 'flag-merge') {
    if (roll === undefined) return undefined
    const val = stats[resolve.kind.indexOf('value')]
    const flagStat = stats[resolve.kind.indexOf('flag')]
    if (roll === flagStat.matchers[0].value) {
      const merged = cloneStat(val)
      mergeIdsInto(merged, flagStat, '{empty}')
      return merged
    }
    return val
  }
  return undefined
}

export class StatIndex {
  constructor (ndjson) {
    this.byMatcher = new Map()
    for (const line of ndjson.split('\n')) {
      if (!line.trim()) continue
      const entry = JSON.parse(line)
      const stats = entry.stats || [entry]
      for (const stat of stats) {
        for (const m of stat.matchers) {
          if (!this.byMatcher.has(m.string)) this.byMatcher.set(m.string, entry)
          if (m.advanced && !this.byMatcher.has(m.advanced)) this.byMatcher.set(m.advanced, entry)
        }
      }
    }
  }

  find (matchStr, modType, category, roll) {
    const entry = this.byMatcher.get(matchStr)
    if (!entry) return undefined
    const stat = entry.stats ? resolveGroup(entry, { matchStr, modType, category, roll }) : entry
    if (!stat) return undefined
    const matcher = stat.matchers.find(m => m.string === matchStr || m.advanced === matchStr)
    if (!matcher) return undefined
    return { stat, matcher }
  }

  /**
   * Matches one stat string (may contain '\n' for multi-line stats).
   * @returns {{ ref, ids: string[], value?: number, better, inverted, option, dp } | undefined}
   */
  match (text, modType, category) {
    for (const combo of placeholderCombos(text)) {
      const found = this.find(combo.stat, modType, category,
        combo.values.length === 1 ? combo.values[0].value : undefined)
      if (!found || !(modType in found.stat.trade.ids)) continue
      const { stat, matcher } = found
      let values = combo.values.map(v => v.value)
      if (matcher.negate) values = values.map(v => -v)
      if (!values.length && matcher.value != null) values = [matcher.value]
      const value = values.length === 0
        ? undefined
        : values.length === 2 ? (values[0] + values[1]) / 2 : values[0]
      return {
        ref: stat.ref,
        ids: stat.trade.ids[modType],
        value,
        better: stat.better,
        inverted: !!stat.trade.inverted,
        option: !!stat.trade.option,
        dp: !!stat.dp || combo.values.some(v => v.decimal)
      }
    }
    return undefined
  }
}

// Fallback order of trade mod types to try for each PoB mod type.
const TYPE_FALLBACK = {
  explicit: ['explicit'],
  implicit: ['implicit', 'explicit'],
  enchant: ['enchant', 'explicit'],
  crafted: ['crafted', 'explicit'],
  fractured: ['fractured', 'explicit'],
  crucible: [],
  scourge: ['scourge'],
  rune: []
}

// Places where PoB's wording differs from the game client's.
const POB_ALIASES = [
  // Impossible Escape
  [/^Passives in Radius of (.+) can be Allocated\nwithout being connected to your tree$/,
    'Passive Skills in Radius of $1 can be Allocated\nwithout being connected to your tree\nPassage']
]

export function pobToGameText (text) {
  for (const [re, to] of POB_ALIASES) text = text.replace(re, to)
  return text
}

/**
 * Matches a list of mods, joining consecutive lines for multi-line stats.
 * @param mods [{ line, type }]
 * @returns { matched: [{ mod, stat, modType }], unmatched: [mod] }
 */
export function matchMods (index, mods, category) {
  const matched = []
  const unmatched = []
  const used = new Set()

  const tryMatch = (group) => {
    const types = TYPE_FALLBACK[group[0].type] ?? [group[0].type]
    const text = pobToGameText(group.map(m => m.line).join('\n'))
    for (const modType of types) {
      const stat = index.match(text, modType, category)
      if (stat) return { mod: group[0], mods: group, stat, modType }
    }
    return null
  }

  for (let start = 0; start < mods.length; start++) {
    if (used.has(start)) continue
    let hit = null
    let take = []
    // Single line, then consecutive lines (multi-line stats).
    for (let end = start; end < Math.min(mods.length, start + 4) && !hit; end++) {
      if (end > start && (mods[end].type !== mods[start].type || used.has(end))) break
      const idx = []
      for (let k = start; k <= end; k++) idx.push(k)
      hit = tryMatch(idx.map(k => mods[k]))
      if (hit) take = idx
    }
    // Two-line stats whose lines aren't adjacent (e.g. Timeless jewels, where
    // PoB keeps per-variant lines in between).
    for (let j = start + 1; j < mods.length && !hit; j++) {
      if (used.has(j) || mods[j].type !== mods[start].type) continue
      hit = tryMatch([mods[start], mods[j]])
      if (hit) take = [start, j]
    }
    if (hit) {
      take.forEach(k => used.add(k))
      matched.push(hit)
    } else {
      unmatched.push(mods[start])
    }
  }
  return { matched, unmatched }
}
