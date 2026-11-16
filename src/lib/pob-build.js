// Parses the Path of Building XML that pobb.in serves at /<id>/xml, and maps
// the item images pobb.in renders back to the item text they came from.
import { parseItem, isClusterJewel, imageName } from './pob-item.js'

function decodeEntities (s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e) => {
    switch (e.toLowerCase()) {
      case 'amp': return '&'
      case 'lt': return '<'
      case 'gt': return '>'
      case 'quot': return '"'
      case 'apos': return "'"
    }
    return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1)))
  })
}

function attrs (tag) {
  const out = {}
  for (const m of tag.matchAll(/([\w:-]+)="([^"]*)"/g)) out[m[1]] = decodeEntities(m[2])
  return out
}

const GEAR_SLOTS = {
  'Weapon 1': 'weapon1',
  'Weapon 2': 'weapon2',
  'Weapon 1 Swap': 'weapon1_swap',
  'Weapon 2 Swap': 'weapon2_swap',
  Helmet: 'helmet',
  'Body Armour': 'body_armour',
  Gloves: 'gloves',
  Boots: 'boots',
  Amulet: 'amulet',
  'Ring 1': 'ring1',
  'Ring 2': 'ring2',
  Belt: 'belt',
  'Flask 1': 'flask1',
  'Flask 2': 'flask2',
  'Flask 3': 'flask3',
  'Flask 4': 'flask4',
  'Flask 5': 'flask5',
  'Charm 1': 'charm1',
  'Charm 2': 'charm2',
  'Charm 3': 'charm3'
}

function parseGear (inner) {
  const gear = { sockets: [] }
  for (const m of inner.matchAll(/<Slot\b[^>]*>/g)) {
    const a = attrs(m[0])
    const id = Number(a.itemId)
    if (!id) continue
    const key = GEAR_SLOTS[a.name]
    if (key) gear[key] = id
    else gear.sockets.push(id)
  }
  return gear
}

export function parseBuildXml (xml) {
  const isPoe2 = /<PathOfBuilding2[\s>]/.test(xml)

  const items = new Map()
  for (const m of xml.matchAll(/<Item\b([^>]*)>([\s\S]*?)<\/Item>/g)) {
    const a = attrs(m[1])
    const text = decodeEntities(m[2].replace(/<ModRange\b[^>]*\/>/g, '')).trim()
    items.set(Number(a.id), text)
  }

  const itemsTag = /<Items\b([^>]*)>/.exec(xml)
  const itemsAttrs = itemsTag ? attrs(itemsTag[1]) : {}

  const itemSets = []
  for (const m of xml.matchAll(/<ItemSet\b([^>]*)>([\s\S]*?)<\/ItemSet>/g)) {
    const a = attrs(m[1])
    itemSets.push({ id: Number(a.id), title: a.title || null, gear: parseGear(m[2]) })
  }
  // Very old exports keep the slots directly under <Items>.
  if (!itemSets.length) {
    const inner = /<Items\b[^>]*>([\s\S]*?)<\/Items>/.exec(xml)
    if (inner) itemSets.push({ id: 1, title: null, gear: parseGear(inner[1].replace(/<Item\b[\s\S]*?<\/Item>/g, '')) })
  }

  const specs = []
  for (const m of xml.matchAll(/<Spec\b([^>]*)>([\s\S]*?)<\/Spec>/g)) {
    const a = attrs(m[1])
    const nodes = new Set((a.nodes || '').split(',').filter(Boolean).map(Number))
    const sockets = []
    for (const s of m[2].matchAll(/<Socket\b[^>]*>/g)) {
      const sa = attrs(s[0])
      const itemId = Number(sa.itemId)
      if (itemId) sockets.push({ nodeId: Number(sa.nodeId), itemId })
    }
    specs.push({ title: a.title || null, nodes, sockets })
  }
  const treeTag = /<Tree\b([^>]*)>/.exec(xml)
  const activeSpec = treeTag ? Math.max(0, Number(attrs(treeTag[1]).activeSpec || 1) - 1) : 0

  return {
    isPoe2,
    items,
    itemSets,
    activeItemSet: Number(itemsAttrs.activeItemSet) || (itemSets[0] && itemSets[0].id) || 1,
    specs,
    activeSpec
  }
}

const SHOWN_SLOTS = ['weapon1', 'weapon2', 'helmet', 'body_armour', 'gloves', 'boots', 'amulet', 'ring1', 'ring2', 'belt']
const FLASK_SLOTS = ['flask1', 'flask2', 'flask3', 'flask4', 'flask5']

function safeParse (text) {
  try { return parseItem(text) } catch { return null }
}

function cmp (a, b) {
  if (a === b) return 0
  if (a == null) return -1
  if (b == null) return 1
  return a < b ? -1 : 1
}

// Items in the order pobb.in renders them, as { slot, text, image }.
export function expectedLayout (build, itemSet, spec) {
  const out = []
  const push = (slot, id) => {
    const text = id ? build.items.get(id) : null
    const parsed = text ? safeParse(text) : null
    out.push({ slot, text: parsed ? text : null, image: parsed ? imageName(parsed) : null, parsed })
  }
  const gear = itemSet ? itemSet.gear : { sockets: [] }
  for (const slot of SHOWN_SLOTS) push(slot, gear[slot])
  for (const slot of FLASK_SLOTS) push(slot, gear[slot])

  const gearSockets = []
  for (const id of gear.sockets) {
    const text = build.items.get(id)
    const parsed = text && safeParse(text)
    if (parsed) gearSockets.push({ slot: 'socket', text, image: imageName(parsed), parsed })
  }
  const treeSockets = []
  if (spec) {
    for (const s of spec.sockets) {
      if (!spec.nodes.has(s.nodeId)) continue
      const text = build.items.get(s.itemId)
      const parsed = text && safeParse(text)
      if (parsed) treeSockets.push({ slot: 'socket', text, image: imageName(parsed), parsed })
    }
  }
  // pobb.in: Cluster Jewels -> Unique -> Base Name -> Name
  treeSockets.sort((x, y) => {
    const a = x.parsed
    const b = y.parsed
    return cmp(!isClusterJewel(a), !isClusterJewel(b)) ||
      cmp(a.rarity !== 'UNIQUE', b.rarity !== 'UNIQUE') ||
      cmp(a.base, b.base) ||
      cmp(a.name, b.name)
  })
  return out.concat(gearSockets, treeSockets)
}

function imageMatches (entry, alt) {
  if (!entry || !entry.text || alt == null) return false
  return entry.image === alt || entry.text.includes(alt)
}

/**
 * Maps the rendered <img class="item ..."> list to item texts.
 * @param build parsed build
 * @param imgs array of { slot, alt } in DOM order (slot = second class, e.g. "helmet", "socket")
 * @returns array (same length as imgs) of item text or null
 */
export function mapImagesToItems (build, imgs) {
  // pobb.in lets the viewer switch item sets / trees, so pick the combination
  // whose rendered images best match what is on screen.
  let best = null
  const sets = build.itemSets.length ? build.itemSets : [null]
  const specs = build.specs.length ? build.specs : [null]
  for (const set of sets) {
    for (let si = 0; si < specs.length; si++) {
      const layout = expectedLayout(build, set, specs[si])
      const result = assign(layout, imgs)
      let score = result.score
      if (set && set.id === build.activeItemSet) score += 0.5
      if (si === build.activeSpec) score += 0.25
      if (!best || score > best.score) best = { score, texts: result.texts }
    }
  }
  return best ? best.texts : imgs.map(() => null)
}

function assign (layout, imgs) {
  const texts = imgs.map(() => null)
  let score = 0
  const gearBySlot = new Map()
  const sockets = []
  for (const e of layout) {
    if (e.slot === 'socket') sockets.push(e)
    else gearBySlot.set(e.slot, e)
  }
  const used = new Set()
  let si = 0
  imgs.forEach((img, idx) => {
    if (img.slot !== 'socket') {
      const e = gearBySlot.get(img.slot)
      if (e && e.text) {
        texts[idx] = e.text
        if (imageMatches(e, img.alt)) score++
      }
      return
    }
    // Sockets: expected order first, then any unused jewel with the same image.
    let pick = null
    if (si < sockets.length && !used.has(si) && imageMatches(sockets[si], img.alt)) {
      pick = si
    } else {
      for (let j = 0; j < sockets.length; j++) {
        if (!used.has(j) && imageMatches(sockets[j], img.alt)) { pick = j; break }
      }
    }
    if (pick == null && si < sockets.length && !used.has(si)) pick = si
    if (pick != null) {
      used.add(pick)
      texts[idx] = sockets[pick].text
      if (imageMatches(sockets[pick], img.alt)) score++
      si = pick + 1
    }
  })
  return { texts, score }
}
