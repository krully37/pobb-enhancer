// Downloads Awakened PoE Trade's stat + item datasets (MIT) and writes
// slimmed copies into src/data/. Run once per league: `npm run update-data`.
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'src', 'data')
const BASE = 'https://raw.githubusercontent.com/SnosMe/awakened-poe-trade/master/renderer/public/data/en/'

async function get (name) {
  const res = await fetch(BASE + name)
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`)
  return (await res.text()).trim().split('\n').map(line => JSON.parse(line))
}

function slimStat (s) {
  const out = { ref: s.ref, better: s.better, matchers: s.matchers, trade: s.trade }
  if (s.dp) out.dp = true
  return out
}

const stats = await get('stats.ndjson')
const statLines = []
for (const s of stats) {
  if (s.stats) {
    statLines.push(JSON.stringify({ resolve: s.resolve, stats: s.stats.map(slimStat) }))
  } else if (!s.mercenary) {
    statLines.push(JSON.stringify(slimStat(s)))
  }
}

const KEEP_NS = new Set(['ITEM', 'UNIQUE', 'GEM'])
const items = await get('items.ndjson')
const itemLines = []
for (const i of items) {
  if (!KEEP_NS.has(i.namespace)) continue
  const out = { name: i.name, namespace: i.namespace }
  if (i.craftable) out.category = i.craftable.category
  if (i.unique) {
    out.base = i.unique.base
    if (i.unique.fixedStats) out.fixedStats = i.unique.fixedStats
  }
  if (i.tradeDisc) out.tradeDisc = i.tradeDisc
  if (i.gem) {
    out.gem = { maxLevel: i.gem.maxLevel }
    if (i.gem.normalVariant) out.gem.normalVariant = i.gem.normalVariant
    if (i.gem.transfigured) out.gem.transfigured = true
    if (i.gem.vaal) out.gem.vaal = true
  }
  itemLines.push(JSON.stringify(out))
}

mkdirSync(OUT, { recursive: true })
writeFileSync(join(OUT, 'stats.ndjson'), statLines.join('\n') + '\n')
writeFileSync(join(OUT, 'items.ndjson'), itemLines.join('\n') + '\n')
console.log(`stats: ${statLines.length} lines, items: ${itemLines.length} lines -> ${OUT}`)
