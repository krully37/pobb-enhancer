// Parser for Path of Building item text (the body of <Item> in PoB XML).

const INFLUENCE_LINES = {
  'Shaper Item': 'shaper',
  'Elder Item': 'elder',
  'Crusader Item': 'crusader',
  'Redeemer Item': 'redeemer',
  'Hunter Item': 'hunter',
  'Warlord Item': 'warlord',
  'Searing Exarch Item': 'searing',
  'Eater of Worlds Item': 'tangled'
}

const FLAG_LINES = new Set([
  'Corrupted', 'Mirrored', 'Split', 'Unidentified', 'Fractured Item', 'Synthesised Item',
  ...Object.keys(INFLUENCE_LINES)
])

// pobb.in's own cleanup of creator-annotated names, e.g.
// "Weapon Swap - Hyrri's Ire" -> "Hyrri's Ire", "Brutal Restraint [Seed]" -> "Brutal Restraint"
export function fixupItemName (name) {
  const dash = name.lastIndexOf('- ')
  if (dash !== -1) name = name.slice(dash + 2)
  const end = name.search(/[[(]/)
  if (end !== -1) name = name.slice(0, end)
  return name.trim().replace(/^Foulborn /, '')
}

const RANGE_RE = /\((-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)\)/g

function decimals (s) {
  const i = s.indexOf('.')
  return i === -1 ? 0 : s.length - i - 1
}

// "+(20-24) to Strength" with range 1 -> "+24 to Strength"
export function applyRange (line, range) {
  let ranged = false
  const out = line.replace(RANGE_RE, (_, a, b) => {
    ranged = true
    const min = Number(a)
    const max = Number(b)
    const dp = Math.max(decimals(a), decimals(b))
    const f = 10 ** dp
    const v = Math.round((min + (max - min) * range) * f) / f
    return String(v)
  })
  // "+-5 to ..." can appear after substituting a negative into "+(…)"
  return { line: out.replace(/\+-/g, '-'), ranged }
}

// Splits the "{tag}{tag:arg}" prefix off a mod line.
export function parseModLine (raw) {
  const tags = {}
  let line = raw
  for (;;) {
    const m = /^\{(\w+)(?::([^}]*))?\}/.exec(line)
    if (!m) break
    tags[m[1]] = m[2] ?? true
    line = line.slice(m[0].length)
  }
  return { line: line.trim(), tags }
}

function variantMatches (tags, sel) {
  if (tags.variant == null) return true
  const list = String(tags.variant).split(',').map(s => s.trim())
  if (list.includes(sel.variant)) return true
  if (sel.altVariant && list.includes(sel.altVariant)) return true
  if (sel.altVariantTwo && list.includes(sel.altVariantTwo)) return true
  return false
}

function socketInfo (s) {
  const groups = s.trim().split(/\s+/).filter(Boolean)
  let links = 0
  let count = 0
  for (const g of groups) {
    const n = g.split('-').filter(Boolean).length
    count += n
    links = Math.max(links, n)
  }
  return { sockets: count, links }
}

const HEADER_RE = /^([A-Za-z][A-Za-z ]*?): (.*)$/

// Non-mod lines that show up when items are copied from the game client.
const PROPERTY_RE = /\(augmented\)|^Quality( \([^)]*\))?: |^Recovers \d|^Consumes \d+ of \d+ Charges|^Currently has \d+ Charges|^Abyss$/

function isPropertyLine (raw, item) {
  const { line } = parseModLine(raw)
  if (PROPERTY_RE.test(line)) return true
  if (line.startsWith('Synthesised ') && line.endsWith(item.base)) {
    item.synthesised = true
    return true
  }
  return false
}

export function parseItem (text) {
  const lines = text.replace(/\r/g, '').split('\n').map(l => l.trim()).filter(l => l.length)
  let i = 0
  const rarityLine = lines[i++] || ''
  const rarity = rarityLine.startsWith('Rarity: ') ? rarityLine.slice(8).trim().toUpperCase() : 'NORMAL'

  let name = null
  if (rarity === 'RARE' || rarity === 'UNIQUE' || rarity === 'RELIC') name = lines[i++] || ''
  const baseLine = lines[i++] || ''

  const item = {
    rarity,
    name: name != null ? name : baseLine,
    baseLine,
    base: fixupItemName(baseLine),
    itemLevel: 0,
    quality: 0,
    levelReq: 0,
    armour: 0,
    evasion: 0,
    energyShield: 0,
    sockets: 0,
    links: 0,
    influences: [],
    corrupted: false,
    mirrored: false,
    split: false,
    synthesised: false,
    fracturedItem: false,
    enchants: [],
    implicits: [],
    explicits: []
  }

  const sel = { variant: null, altVariant: null, altVariantTwo: null }
  let variantCount = 0
  let hasAltVariant = false
  let implicitCount = null

  const flag = (l) => {
    if (!FLAG_LINES.has(l)) return false
    if (l === 'Corrupted') item.corrupted = true
    else if (l === 'Mirrored') item.mirrored = true
    else if (l === 'Split') item.split = true
    else if (l === 'Synthesised Item') item.synthesised = true
    else if (l === 'Fractured Item') item.fracturedItem = true
    else if (INFLUENCE_LINES[l]) item.influences.push(INFLUENCE_LINES[l])
    return true
  }

  // Header: "Key: value" lines, flags and repeated base names, until "Implicits: N".
  for (; i < lines.length; i++) {
    const l = lines[i]
    if (flag(l) || l === baseLine) continue
    const m = HEADER_RE.exec(l)
    if (!m || m[1].endsWith('grant')) break
    const [, key, val] = m
    switch (key) {
      case 'Item Level': item.itemLevel = Number(val) || 0; break
      case 'Quality': item.quality = Number(val) || 0; break
      case 'LevelReq': item.levelReq = Number(val) || 0; break
      case 'Armour': item.armour = Number(val) || 0; break
      case 'Evasion': item.evasion = Number(val) || 0; break
      case 'Energy Shield': item.energyShield = Number(val) || 0; break
      case 'Sockets': Object.assign(item, socketInfo(val)); break
      case 'Variant': variantCount++; break
      case 'Selected Variant': sel.variant = val.trim(); break
      case 'Selected Alt Variant': sel.altVariant = val.trim(); break
      case 'Selected Alt Variant Two': sel.altVariantTwo = val.trim(); break
      case 'Has Alt Variant': hasAltVariant = val.trim() === 'true'; break
      case 'Implicits': implicitCount = Number(val) || 0; break
    }
    if (key === 'Implicits') { i++; break }
  }
  // PoB defaults to the newest variant when none is selected.
  if (sel.variant == null && variantCount > 0) sel.variant = String(variantCount)

  const rest = lines.slice(i)
  const implicitRaw = implicitCount != null ? rest.slice(0, implicitCount) : []
  const explicitRaw = implicitCount != null ? rest.slice(implicitCount) : rest

  const toMod = (raw, section) => {
    const { line: body, tags } = parseModLine(raw)
    if (!variantMatches(tags, sel)) return null
    const range = tags.range != null ? Number(tags.range) : 0.5
    const { line, ranged } = applyRange(body, range)
    let type = section
    if (tags.enchant) type = 'enchant'
    else if (section === 'implicit' && tags.crafted) type = 'enchant' // PoB stores enchants as crafted implicits
    else if (tags.fractured) type = 'fractured'
    else if (tags.crafted) type = 'crafted'
    else if (tags.crucible) type = 'crucible'
    else if (tags.scourge) type = 'scourge'
    if (tags.rune) type = 'rune'
    // Lines picked by a variant on items like Megalomaniac or Militant Faith.
    const variantPicked = tags.variant != null && hasAltVariant
    return { line, type, ranged, variantPicked, tags }
  }

  // Cluster jewels have no real implicits: every implicit line is part of the
  // enchant (PoB only tags the first line of two-line "grant" enchants).
  const clusterJewel = item.base.includes('Cluster Jewel')
  for (const raw of implicitRaw) {
    const mod = toMod(raw, 'implicit')
    if (!mod) continue
    if (clusterJewel && mod.type === 'implicit') mod.type = 'enchant'
    if (mod.type === 'enchant') item.enchants.push(mod)
    else item.implicits.push(mod)
  }
  for (const raw of explicitRaw) {
    if (flag(raw) || isPropertyLine(raw, item)) continue
    const mod = toMod(raw, 'explicit')
    if (!mod) continue
    if (mod.type === 'enchant') item.enchants.push(mod)
    else item.explicits.push(mod)
  }
  if (item.explicits.some(m => m.type === 'fractured')) item.fracturedItem = true
  return item
}

export function isClusterJewel (item) {
  return item.base.includes('Cluster Jewel')
}

// The name pobb.in uses for an item's image, which is also the <img alt>.
export function imageName (item) {
  if ((item.rarity === 'UNIQUE' || item.rarity === 'RELIC') && item.name) {
    return fixupItemName(item.name)
  }
  if (item.base.startsWith('Two-Toned')) {
    if (item.armour >= 126 && item.evasion >= 126) return 'TwoTonedArEv'
    if (item.evasion >= 126) return 'TwoTonedEvEs'
    return 'TwoTonedArEs'
  }
  if (item.base.startsWith('Two-Stone')) {
    let fire = false
    let cold = false
    for (const m of item.implicits) {
      fire = fire || m.line.includes('Fire')
      cold = cold || m.line.includes('Cold')
      if (fire || cold) break
    }
    if (fire && cold) return 'TwoStoneFC'
    if (cold) return 'TwoStoneCL'
    return 'TwoStoneFL'
  }
  return item.base
}
