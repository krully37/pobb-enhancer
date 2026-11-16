// Builds pathofexile.com/trade search queries from parsed PoB items and gems.
import { parseItem, fixupItemName, isClusterJewel } from './pob-item.js'
import { matchMods } from './stats.js'

export const DEFAULT_OPTIONS = {
  rollPercent: 90, // min = roll * 90%
  countOffset: 0, // count group min = N - offset
  status: 'available' // Instant Buyout and In Person (Online)
}

export const STATUSES = ['available', 'securable', 'online', 'any']

const TRADE_BASE = 'https://www.pathofexile.com/trade/search/'

export function tradeUrl (league, query) {
  return TRADE_BASE + encodeURIComponent(league) + '?q=' + encodeURIComponent(JSON.stringify(query))
}

const INFLUENCE_PSEUDO = {
  shaper: 'pseudo.pseudo_has_shaper_influence',
  elder: 'pseudo.pseudo_has_elder_influence',
  crusader: 'pseudo.pseudo_has_crusader_influence',
  redeemer: 'pseudo.pseudo_has_redeemer_influence',
  hunter: 'pseudo.pseudo_has_hunter_influence',
  warlord: 'pseudo.pseudo_has_warlord_influence'
}
const INFLUENCE_MISC = { searing: 'searing_item', tangled: 'tangled_item' }

function roundDown (x, dp) { const f = dp ? 10 : 1; return Math.floor(x * f + 1e-9) / f }
function roundUp (x, dp) { const f = dp ? 10 : 1; return Math.ceil(x * f - 1e-9) / f }

// Loosens a roll towards "worse" by (100 - rollPercent)%.
export function rollBounds (stat, rollPercent) {
  if (stat.value == null) return {}
  const tol = Math.abs(stat.value) * (1 - rollPercent / 100)
  if (stat.better === -1) return { max: roundUp(stat.value + tol, stat.dp) }
  return { min: roundDown(stat.value - tol, stat.dp) }
}

function exactBounds (stat) {
  return stat.value == null ? {} : { min: stat.value, max: stat.value }
}

// One trade filter per trade id of the stat (local/global variants get merged by APT).
export function statFilters (stat, bounds, disabled = false) {
  return stat.ids.map(raw => {
    let id = raw
    let b = bounds
    let div = 1
    if (id.startsWith('{div_by_100}')) div = 100
    if (id.startsWith('{empty}') || (id.startsWith('{empty_if_100}') && stat.value === 100)) b = {}
    if (id.startsWith('{')) id = id.slice(id.indexOf('}') + 1)
    const [baseId, opt] = id.split('|')
    const value = {}
    if (opt != null) {
      value.option = /^\d+$/.test(opt) ? Number(opt) : opt
    } else {
      const sign = stat.inverted ? -1 : 1
      let min = b.min != null ? b.min * sign / div : undefined
      let max = b.max != null ? b.max * sign / div : undefined
      if (stat.inverted) [min, max] = [max, min]
      if (min != null) value.min = min
      if (max != null) value.max = max
    }
    const f = { id: baseId }
    if (Object.keys(value).length) f.value = value
    if (disabled) f.disabled = true
    return f
  })
}

function setPath (obj, path, value) {
  const keys = path.split('.')
  let o = obj
  for (const k of keys.slice(0, -1)) o = (o[k] ??= {})
  o[keys[keys.length - 1]] = value
}

function newQuery (status = DEFAULT_OPTIONS.status) {
  if (!STATUSES.includes(status)) status = DEFAULT_OPTIONS.status
  return { query: { status: { option: status }, stats: [], filters: {} }, sort: { price: 'asc' } }
}

// Counts on cluster jewels are searched exactly: 8 passives is a different jewel from 12.
const CLUSTER_EXACT_REFS = new Set([
  'Adds # Passive Skills',
  '# Added Passive Skills are Jewel Sockets',
  'Adds # Small Passive Skills which grant nothing',
  'Adds # Jewel Socket Passive Skills'
])

/**
 * @returns {{ query, matched: number, total: number, skipped: string[], label: string }}
 */
export function buildItemQuery (itemText, { stats, items }, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options }
  const item = typeof itemText === 'string' ? parseItem(itemText) : itemText
  const q = newQuery(opts.status)
  const skipped = []
  let matched = 0
  let total = 0

  const isUnique = item.rarity === 'UNIQUE' || item.rarity === 'RELIC'
  const uniqueName = isUnique ? fixupItemName(item.name) : null
  const uniqueEntry = isUnique ? items.unique(uniqueName) : null
  let base = isUnique && uniqueEntry ? uniqueEntry.base : item.base
  if (item.rarity === 'MAGIC' || item.rarity === 'NORMAL') base = items.resolveBase(item.base)
  const category = items.category(base)
  const cluster = isClusterJewel(item)
  const timeless = base === 'Timeless Jewel'

  if (isUnique) {
    q.query.name = uniqueName
    q.query.type = base
    if (item.rarity === 'RELIC') setPath(q.query.filters, 'type_filters.filters.rarity.option', 'uniquefoil')
  } else {
    q.query.type = base
    setPath(q.query.filters, 'type_filters.filters.rarity.option', 'nonunique')
  }

  const andFilters = []
  const countFilters = []
  let countStats = 0

  // Enchants: required on cluster jewels (they define the jewel), otherwise added but unchecked.
  const ench = matchMods(stats, item.enchants, category)
  for (const { stat } of ench.matched) {
    if (cluster) {
      const bounds = CLUSTER_EXACT_REFS.has(stat.ref) ? exactBounds(stat) : rollBounds(stat, opts.rollPercent)
      andFilters.push(...statFilters(stat, bounds))
    } else {
      andFilters.push(...statFilters(stat, rollBounds(stat, opts.rollPercent), true))
    }
  }
  total += item.enchants.length
  matched += ench.matched.reduce((n, r) => n + r.mods.length, 0)
  skipped.push(...ench.unmatched.map(m => m.line))

  // Implicits + explicits. Crucible tree and PoE2 rune lines aren't tradeable mods.
  let mods = [...item.implicits, ...item.explicits].filter(m => m.type !== 'crucible' && m.type !== 'rune')
  if (isUnique && timeless) {
    // Keep the leader + devotion lines (the leader stat spans two PoB lines).
    const fixed = new Set(uniqueEntry?.fixedStats ?? [])
    mods = mods.filter(m => !fixed.has(m.line))
  } else if (isUnique) {
    // Only rolls that vary. PoB-crafted uniques carry ranges; imported ones
    // don't, so fall back to APT's list of fixed unique stats.
    const anyRanged = mods.some(m => m.ranged || m.variantPicked)
    if (anyRanged) {
      mods = mods.filter(m => m.ranged || m.variantPicked)
    } else {
      const fixed = new Set(uniqueEntry?.fixedStats ?? [])
      if (fixed.size) {
        mods = mods.filter(m => {
          const r = matchMods(stats, [m], category).matched[0]
          return !r || !fixed.has(r.stat.ref)
        })
      }
    }
  }
  const res = matchMods(stats, mods, category)
  for (const { stat, mods: srcMods } of res.matched) {
    let bounds
    if (timeless) {
      // Seeds are exact. PoB-made jewels carry a placeholder seed (a range), so search any seed;
      // devotion lines are fixed per variant and need no value.
      const isSeed = stat.ids.some(id => id.includes('pseudo_timeless_jewel'))
      bounds = isSeed && !srcMods.some(m => m.ranged) ? exactBounds(stat) : {}
    } else if (cluster && CLUSTER_EXACT_REFS.has(stat.ref)) {
      bounds = exactBounds(stat)
    } else {
      bounds = rollBounds(stat, opts.rollPercent)
    }
    countFilters.push(...statFilters(stat, bounds))
    countStats++
  }
  total += mods.length
  matched += res.matched.reduce((n, r) => n + r.mods.length, 0)
  skipped.push(...res.unmatched.map(m => m.line))

  // Influences.
  for (const inf of item.influences) {
    if (INFLUENCE_PSEUDO[inf]) andFilters.push({ id: INFLUENCE_PSEUDO[inf] })
    if (INFLUENCE_MISC[inf]) setPath(q.query.filters, `misc_filters.filters.${INFLUENCE_MISC[inf]}.option`, 'true')
  }
  if (item.synthesised) setPath(q.query.filters, 'misc_filters.filters.synthesised_item.option', 'true')

  setPath(q.query.filters, 'misc_filters.filters.corrupted.option', String(item.corrupted))
  if (item.links >= 5) setPath(q.query.filters, 'socket_filters.filters.links.min', item.links)

  if (andFilters.length) q.query.stats.push({ type: 'and', filters: andFilters })
  if (countFilters.length) {
    q.query.stats.push({
      type: 'count',
      value: { min: Math.max(1, countStats - opts.countOffset) },
      filters: countFilters
    })
  }
  if (!q.query.stats.length) q.query.stats.push({ type: 'and', filters: [] })

  const label = isUnique ? uniqueName : (item.rarity === 'RARE' ? `${item.name} (${base})` : base)
  return { query: q, matched, total, skipped, label }
}

/**
 * @param gem { name, level, quality }
 */
export function buildGemQuery (gem, { items }, options = {}) {
  const q = newQuery(options.status)
  const entry = items.gem(gem.name)
  if (entry && entry.gem && entry.gem.transfigured && entry.tradeDisc && entry.gem.normalVariant) {
    q.query.type = { option: entry.gem.normalVariant, discriminator: entry.tradeDisc }
  } else {
    q.query.type = entry ? entry.name : gem.name
  }
  const level = Number(gem.level) || 0
  const quality = Number(gem.quality) || 0
  if (level > 1) setPath(q.query.filters, 'misc_filters.filters.gem_level.min', level)
  if (quality > 0) setPath(q.query.filters, 'misc_filters.filters.quality.min', quality)
  // PoB doesn't store corruption for gems; levels/quality above the cap imply it.
  const maxLevel = entry?.gem?.maxLevel ?? 20
  if (level > maxLevel || quality > 20) setPath(q.query.filters, 'misc_filters.filters.corrupted.option', 'true')
  q.query.stats.push({ type: 'and', filters: [] })
  return { query: q, matched: 0, total: 0, skipped: [], label: entry ? entry.name : gem.name, known: !!entry }
}
