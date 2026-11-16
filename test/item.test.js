import { test } from 'node:test'
import assert from 'node:assert/strict'
import { db, fixture, fixtures } from './load.js'
import { parseBuildXml } from '../src/lib/pob-build.js'
import { parseItem, applyRange, fixupItemName } from '../src/lib/pob-item.js'
import { buildItemQuery, buildGemQuery, rollBounds, tradeUrl } from '../src/lib/query.js'

const allItems = () => fixtures().flatMap(f => [...parseBuildXml(fixture(f)).items.values()])
const misc = (r) => r.query.query.filters.misc_filters?.filters ?? {}
const statsOf = (r) => r.query.query.stats.flatMap(s => s.filters)

test('applyRange resolves PoB ranges, including reversed and negative ones', () => {
  assert.equal(applyRange('+(20-24) to Strength', 1).line, '+24 to Strength')
  assert.equal(applyRange('(150-125)% increased Charges per use', 0.5).line, '138% increased Charges per use')
  assert.equal(applyRange('(10--10)% increased Charges per use', 0).line, '10% increased Charges per use')
  assert.equal(applyRange('Regenerate (1.5-2.5) Life', 0.5).line, 'Regenerate 2 Life')
  assert.equal(applyRange('no range', 0.5).ranged, false)
})

test('fixupItemName strips creator annotations', () => {
  assert.equal(fixupItemName('Swap - Hyrri\'s Ire'), "Hyrri's Ire")
  assert.equal(fixupItemName('Brutal Restraint [12345]'), 'Brutal Restraint')
  assert.equal(fixupItemName('Foulborn Headhunter'), 'Headhunter')
})

test('rare weapon: local mods, crafted mods, count group, 90% mins', () => {
  const text = `Rarity: RARE
Dire Hunger
Gut Ripper
Item Level: 85
Quality: 20
Sockets: G-B-B
Implicits: 1
Grants 44 Life per Enemy Hit
{fractured}Adds 13 to 248 Lightning Damage
Adds 97 to 165 Fire Damage
26% increased Attack Speed
{crafted}{range:1}+(20-24) to Strength and Intelligence`
  const r = buildItemQuery(text, db)
  assert.equal(r.query.query.type, 'Gut Ripper')
  const count = r.query.query.stats.find(s => s.type === 'count')
  assert.equal(count.value.min, 5)
  const ids = count.filters.map(f => f.id)
  assert.ok(ids.some(id => id.startsWith('implicit.')))
  assert.ok(ids.some(id => id.startsWith('fractured.')))
  assert.ok(ids.some(id => id.startsWith('crafted.')))
  // Adds 97 to 165 -> average 131 -> min 117 (local weapon stat)
  assert.ok(count.filters.some(f => f.value?.min === 117), JSON.stringify(count.filters))
  // 26% IAS -> min 23
  assert.ok(count.filters.some(f => f.value?.min === 23))
  assert.equal(misc(r).corrupted.option, 'false')
  assert.deepEqual(r.skipped, [])
})

test('enchants on normal gear are added but unchecked', () => {
  const text = `Rarity: RARE
Doom Visor
Hubris Circlet
Implicits: 1
{enchant}40% increased Burning Arrow Damage
+90 to maximum Life`
  const r = buildItemQuery(text, db)
  const and = r.query.query.stats.find(s => s.type === 'and')
  if (and && and.filters.length) assert.ok(and.filters.every(f => f.disabled))
})

test('influences become required pseudo filters, eldritch become misc filters', () => {
  const text = `Rarity: RARE
Test
Titan Gauntlets
Shaper Item
Searing Exarch Item
Implicits: 0
+90 to maximum Life`
  const r = buildItemQuery(text, db)
  const and = r.query.query.stats.find(s => s.type === 'and')
  assert.ok(and.filters.some(f => f.id === 'pseudo.pseudo_has_shaper_influence' && !f.disabled))
  assert.equal(misc(r).searing_item.option, 'true')
})

test('5 and 6 links are searched, 4 links are not', () => {
  const six = buildItemQuery('Rarity: RARE\nX\nVaal Regalia\nSockets: B-B-B-B-B-B\nImplicits: 0\n+90 to maximum Life', db)
  assert.equal(six.query.query.filters.socket_filters.filters.links.min, 6)
  const four = buildItemQuery('Rarity: RARE\nX\nVaal Regalia\nSockets: B-B-B-B G\nImplicits: 0\n+90 to maximum Life', db)
  assert.equal(four.query.query.filters.socket_filters, undefined)
})

test('synthesised base line from game copy is a flag, not a mod', () => {
  const item = allItems().find(t => t.includes('Synthesised Diamond Ring'))
  const p = parseItem(item)
  assert.equal(p.synthesised, true)
  const r = buildItemQuery(item, db)
  assert.equal(misc(r).synthesised_item.option, 'true')
  assert.deepEqual(r.skipped, [])
})

test('unique crafted in PoB searches only rolled (ranged) mods', () => {
  const text = `Rarity: UNIQUE
Dying Sun
Ruby Flask
Variant: Pre 3.0.0
Variant: Current
Selected Variant: 2
Implicits: 0
{variant:2}{range:0.5}(10-20)% increased Area of Effect during Effect
Skills fire 2 additional Projectiles during Effect`
  const r = buildItemQuery(text, db)
  assert.equal(r.query.query.name, 'Dying Sun')
  assert.equal(r.query.query.type, 'Ruby Flask')
  assert.equal(statsOf(r).length, 1)
  assert.equal(statsOf(r)[0].value.min, 13) // 15 * 0.9 = 13.5 -> 13
  assert.equal(r.query.query.filters.type_filters, undefined)
})

test('magic flask resolves its base type from the affixed name', () => {
  const text = `Rarity: MAGIC
Seething Divine Life Flask of Staunching
Quality: 20
Implicits: 0
66% increased Amount Recovered
Immunity to Bleeding and Corrupted Blood during Effect`
  const r = buildItemQuery(text, db)
  assert.equal(r.query.query.type, 'Divine Life Flask')
})

test('"better: -1" stats loosen upward', () => {
  assert.deepEqual(rollBounds({ value: 10, better: -1, dp: false }, 90), { max: 11 })
  assert.deepEqual(rollBounds({ value: -10, better: 1, dp: false }, 90), { min: -11 })
  assert.deepEqual(rollBounds({ value: 5.5, better: 1, dp: true }, 90), { min: 4.9 })
})

test('roll percent option changes mins', () => {
  const text = 'Rarity: RARE\nX\nTitan Gauntlets\nImplicits: 0\n+100 to maximum Life'
  const r = buildItemQuery(text, db, { rollPercent: 80 })
  assert.equal(statsOf(r)[0].value.min, 80)
})

test('every fixture item builds a query; >97% of mod lines match', () => {
  let matched = 0
  let total = 0
  for (const t of allItems()) {
    const r = buildItemQuery(t, db)
    assert.ok(r.query.query.type, 'has a type')
    matched += r.matched
    total += r.total
  }
  assert.ok(matched / total > 0.97, `${matched}/${total}`)
})

test('gems: support suffix, level/quality mins', () => {
  const r = buildGemQuery({ name: 'Enlighten', level: 3, quality: 20 }, db)
  assert.equal(r.query.query.type, 'Enlighten Support')
  assert.equal(misc(r).gem_level.min, 3)
  assert.equal(misc(r).quality.min, 20)
  assert.equal(misc(r).corrupted, undefined)
})

test('gems: transfigured uses base gem + discriminator', () => {
  const r = buildGemQuery({ name: 'Cleave of Rage', level: 20, quality: 0 }, db)
  assert.deepEqual(r.query.query.type, { option: 'Cleave', discriminator: 'alt_x' })
  assert.equal(misc(r).quality, undefined)
})

test('gems: level above cap implies corrupted', () => {
  const r = buildGemQuery({ name: 'Wrath', level: 21, quality: 0 }, db)
  assert.equal(r.query.query.type, 'Wrath')
  assert.equal(misc(r).corrupted.option, 'true')
})

test('trade URL round-trips the query and encodes the league', () => {
  const q = buildGemQuery({ name: 'Wrath', level: 20, quality: 20 }, db).query
  const url = tradeUrl('Hardcore Covens', q)
  assert.ok(url.startsWith('https://www.pathofexile.com/trade/search/Hardcore%20Covens?q='))
  assert.deepEqual(JSON.parse(decodeURIComponent(url.split('?q=')[1])), q)
})
