import { test } from 'node:test'
import assert from 'node:assert/strict'
import { db, fixture } from './load.js'
import { parseBuildXml, mapImagesToItems } from '../src/lib/pob-build.js'
import { parseItem, imageName } from '../src/lib/pob-item.js'
import { buildItemQuery } from '../src/lib/query.js'

// Captured from the live pobb.in pages: document.querySelectorAll('.inventory img.item')
const LAYOUTS = {
  'cJtARuNOS4Xg.xml': [
    ['weapon1', "Hellion's Paw"], ['weapon2', 'Crusader Buckler'], ['helmet', "Voll's Vision"],
    ['body_armour', 'Triumphant Lamellar'], ['gloves', "Kaom's Spirit"], ['boots', 'TwoTonedArEv'],
    ['amulet', 'Onyx Amulet'], ['ring1', 'Diamond Ring'], ['ring2', 'Amethyst Ring'], ['belt', 'Perseverance'],
    ['flask1', 'Diamond Flask'], ['flask2', 'Jade Flask'], ['flask3', 'Granite Flask'],
    ['flask4', 'Divine Life Flask'], ['flask5', 'Divine Life Flask'],
    ['socket', 'Large Cluster Jewel'], ['socket', 'Medium Cluster Jewel'], ['socket', 'Small Cluster Jewel'],
    ['socket', 'Lethal Pride'], ['socket', 'Crimson Jewel'], ['socket', 'Viridian Jewel']
  ],
  'QFNEVieqypZt.xml': [
    ['weapon1', 'Pneumatic Dagger'], ['weapon2', 'Dawnbreaker'], ['helmet', 'Eternal Burgonet'],
    ['body_armour', 'Loreweave'], ['gloves', 'Tanu Ahi'], ['boots', 'Goliath Greaves'],
    ['amulet', "Ungil's Harmony"], ['ring1', 'Circle of Nostalgia'], ['ring2', 'Unset Ring'],
    ['belt', 'Chains of Emancipation'], ['flask1', 'Progenesis'], ['flask2', 'Ruby Flask'],
    ['flask3', 'Taste of Hate'], ['flask4', 'Divine Life Flask'], ['flask5', 'Granite Flask'],
    ['socket', 'Megalomaniac'], ['socket', 'Large Cluster Jewel'], ['socket', 'Medium Cluster Jewel'],
    ['socket', "Watcher's Eye"], ['socket', 'Militant Faith'], ['socket', 'Impossible Escape'],
    ['socket', 'Murderous Eye Jewel']
  ]
}

for (const [file, layout] of Object.entries(LAYOUTS)) {
  test(`maps every rendered image to its item: ${file}`, () => {
    const build = parseBuildXml(fixture(file))
    assert.equal(build.isPoe2, false)
    const imgs = layout.map(([slot, alt]) => ({ slot, alt }))
    const texts = mapImagesToItems(build, imgs)
    texts.forEach((text, i) => {
      assert.ok(text, `no item for ${imgs[i].slot} ${imgs[i].alt}`)
      const img = imageName(parseItem(text))
      assert.ok(img === imgs[i].alt || text.includes(imgs[i].alt), `${imgs[i].alt} -> ${img}`)
    })
    // Each socket image maps to a different jewel.
    const sockets = texts.filter((_, i) => imgs[i].slot === 'socket')
    assert.equal(new Set(sockets).size, sockets.length)
  })
}

test('real Megalomaniac export searches its notables', () => {
  const build = parseBuildXml(fixture('QFNEVieqypZt.xml'))
  const text = [...build.items.values()].find(t => t.includes('Megalomaniac'))
  const r = buildItemQuery(text, db)
  assert.equal(r.query.query.name, 'Megalomaniac')
  const count = r.query.query.stats.find(s => s.type === 'count')
  assert.equal(count.filters.length, 3, JSON.stringify(r.query.query.stats))
  assert.deepEqual(r.skipped, [])
})

test('Impossible Escape keystone is matched despite PoB wording', () => {
  const build = parseBuildXml(fixture('QFNEVieqypZt.xml'))
  const text = [...build.items.values()].find(t => t.includes('Impossible Escape'))
  const r = buildItemQuery(text, db)
  assert.deepEqual(r.skipped, [])
  assert.ok(r.query.query.stats.some(s => s.filters.length > 0))
})

test('Militant Faith searches leader (any seed) and devotion mod', () => {
  const build = parseBuildXml(fixture('NXfeUsLxkgQn.xml'))
  const r = buildItemQuery(build.items.get(13), db)
  const filters = r.query.query.stats.flatMap(s => s.filters)
  const leader = filters.find(f => f.id === 'explicit.pseudo_timeless_jewel_avarius')
  assert.ok(leader)
  assert.equal(leader.value, undefined)
  assert.equal(filters.length, 2)
  assert.deepEqual(r.skipped, [])
})

test('imported Timeless jewel searches its exact seed', () => {
  const build = parseBuildXml(fixture('QFNEVieqypZt.xml'))
  const text = [...build.items.values()].find(t => t.includes('Militant Faith'))
  const r = buildItemQuery(text, db)
  const filters = r.query.query.stats.flatMap(s => s.filters)
  const seed = filters.find(f => f.id.includes('pseudo_timeless_jewel'))
  assert.ok(seed.value && seed.value.min === seed.value.max, JSON.stringify(seed))
  assert.ok(filters.filter(f => f !== seed).every(f => !f.value))
})

test('detects PoE2 builds', () => {
  const b = parseBuildXml('<?xml version="1.0"?><PathOfBuilding2><Items activeItemSet="1"></Items></PathOfBuilding2>')
  assert.equal(b.isPoe2, true)
})

test('decodes XML entities in item text', () => {
  const build = parseBuildXml(fixture('cJtARuNOS4Xg.xml'))
  const all = [...build.items.values()].join('\n')
  assert.ok(!all.includes('&apos;'))
  assert.ok(all.includes("Hits can't be Evaded"))
})
