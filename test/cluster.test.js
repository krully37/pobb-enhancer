import { test } from 'node:test'
import assert from 'node:assert/strict'
import { db, fixture, fixtures } from './load.js'
import { parseBuildXml } from '../src/lib/pob-build.js'
import { parseItem } from '../src/lib/pob-item.js'
import { buildItemQuery } from '../src/lib/query.js'

const PASSIVES = 'enchant.stat_3086156145'
const SOCKETS = 'enchant.stat_4079888060'
const GRANT = 'enchant.stat_3948993189'

const item = (file, id) => parseBuildXml(fixture(file)).items.get(id)
const groups = (q) => ({
  and: q.query.stats.find(s => s.type === 'and'),
  count: q.query.stats.find(s => s.type === 'count')
})
const byId = (group, id) => group.filters.find(f => f.id === id)

test('large cluster with two-line "grant" enchant (PoB tags only the first line)', () => {
  const r = buildItemQuery(item('QFNEVieqypZt.xml', 1), db)
  const { and, count } = groups(r.query)
  assert.equal(r.query.query.type, 'Large Cluster Jewel')
  assert.equal(r.query.query.filters.type_filters.filters.rarity.option, 'nonunique')
  assert.deepEqual(byId(and, PASSIVES).value, { min: 8, max: 8 })
  assert.deepEqual(byId(and, SOCKETS).value, { min: 2, max: 2 })
  // "Claw Attacks deal 12%...\nDagger Attacks deal 12%..." is one trade option
  assert.deepEqual(byId(and, GRANT).value, { option: 3 })
  assert.ok(and.filters.every(f => !f.disabled), 'cluster enchants must be enabled')
  // +3 to All Attributes (also grant) + 3 notables
  assert.equal(count.filters.length, 4)
  assert.equal(count.value.min, 4)
  assert.equal(r.skipped.length, 0)
  assert.equal(r.matched, r.total)
})

test('medium cluster: 1 jewel socket, two "also grant" lines, two notables', () => {
  const r = buildItemQuery(item('cJtARuNOS4Xg.xml', 25), db)
  const { and, count } = groups(r.query)
  assert.equal(r.query.query.type, 'Medium Cluster Jewel')
  assert.deepEqual(byId(and, PASSIVES).value, { min: 4, max: 4 })
  assert.deepEqual(byId(and, SOCKETS).value, { min: 1, max: 1 })
  assert.equal(typeof byId(and, GRANT).value.option, 'number')
  assert.equal(count.filters.length, 4)
  // notables have no value, "also grant" rolls get the 90% min
  const valued = count.filters.filter(f => f.value)
  assert.equal(valued.length, 2)
  assert.equal(r.skipped.length, 0)
})

test('small cluster without a socket enchant', () => {
  const r = buildItemQuery(item('cJtARuNOS4Xg.xml', 27), db)
  const { and, count } = groups(r.query)
  assert.equal(r.query.query.type, 'Small Cluster Jewel')
  assert.deepEqual(byId(and, PASSIVES).value, { min: 2, max: 2 })
  assert.equal(byId(and, SOCKETS), undefined)
  assert.ok(byId(and, GRANT))
  // chaos res, cold res, evasion, Uncompromising
  assert.equal(count.filters.length, 4)
  assert.equal(r.skipped.length, 0)
})

test('small cluster "have 25% increased Effect" uses 90% min', () => {
  const r = buildItemQuery(item('cJtARuNOS4Xg.xml', 1), db)
  const { count } = groups(r.query)
  const effect = count.filters.find(f => f.value && f.value.min === 22)
  assert.ok(effect, JSON.stringify(count.filters))
})

test('every cluster jewel in every fixture build maps fully', () => {
  let seen = 0
  for (const f of fixtures()) {
    for (const [id, text] of parseBuildXml(fixture(f)).items) {
      if (!text.includes('Cluster Jewel') || text.includes('Rarity: UNIQUE')) continue
      seen++
      const r = buildItemQuery(text, db)
      const { and, count } = groups(r.query)
      assert.deepEqual(r.skipped, [], `${f} #${id}`)
      const passives = byId(and, PASSIVES)
      assert.ok(passives, `${f} #${id} has passive count`)
      assert.equal(passives.value.min, passives.value.max)
      assert.ok(byId(and, GRANT), `${f} #${id} has small passive grant`)
      assert.ok(count && count.filters.length > 0, `${f} #${id} has notables`)
      assert.equal(count.value.min, count.filters.length)
    }
  }
  assert.ok(seen >= 15, `expected many cluster fixtures, saw ${seen}`)
})

test('fractured notable on a cluster uses the fractured stat id', () => {
  const text = `Rarity: RARE
Test Name
Medium Cluster Jewel
Item Level: 84
Implicits: 3
{crafted}Adds 5 Passive Skills
{crafted}1 Added Passive Skill is a Jewel Socket
{crafted}Added Small Passive Skills grant: 12% increased Fire Damage
{fractured}1 Added Passive Skill is Burning Bright
1 Added Passive Skill is Prismatic Heart`
  const r = buildItemQuery(text, db)
  const { and, count } = groups(r.query)
  assert.deepEqual(byId(and, PASSIVES).value, { min: 5, max: 5 })
  assert.ok(count.filters[0].id.startsWith('fractured.'), count.filters[0].id)
  assert.ok(count.filters[1].id.startsWith('explicit.'))
  assert.deepEqual(r.skipped, [])
})

test('Megalomaniac searches its three selected notables', () => {
  const notables = ['Adrenaline', 'Blessed Rebirth', 'Calamitous', 'Cooked Alive', 'Disorienting Display']
  const text = [
    'Rarity: UNIQUE', 'Megalomaniac', 'Medium Cluster Jewel', 'League: Delirium',
    'Has Alt Variant: true', 'Has Alt Variant Two: true',
    ...notables.map(n => `Variant: ${n}`),
    'Selected Variant: 1', 'Selected Alt Variant: 3', 'Selected Alt Variant Two: 5',
    'Implicits: 0',
    'Adds 4 Passive Skills', 'Added Small Passive Skills grant Nothing',
    ...notables.map((n, i) => `{variant:${i + 1}}1 Added Passive Skill is ${n}`)
  ].join('\n')
  const r = buildItemQuery(text, db)
  assert.equal(r.query.query.name, 'Megalomaniac')
  assert.equal(r.query.query.type, 'Medium Cluster Jewel')
  const { count } = groups(r.query)
  assert.equal(count.filters.length, 3)
  assert.equal(count.value.min, 3)
  assert.deepEqual(r.skipped, [])
})

test('Voices searches the small-passive count exactly', () => {
  const text = `Rarity: UNIQUE
Voices
Large Cluster Jewel
Variant: Adds 1 Small Passive Skill
Variant: Adds 3 Small Passive Skills
Variant: Adds 5 Small Passive Skills
Variant: Adds 7 Small Passive Skills
Selected Variant: 1
Implicits: 0
Adds 3 Jewel Socket Passive Skills
{variant:1}Adds 1 Small Passive Skill which grants nothing
{variant:2}Adds 3 Small Passive Skills which grant nothing
{variant:3}Adds 5 Small Passive Skills which grant nothing
{variant:4}Adds 7 Small Passive Skills which grant nothing`
  const r = buildItemQuery(text, db)
  const all = r.query.query.stats.flatMap(s => s.filters)
  const small = all.find(f => f.value && f.value.min === 1 && f.value.max === 1)
  assert.ok(small, JSON.stringify(all))
  assert.equal(r.query.query.name, 'Voices')
})

test('count offset loosens only the notable group, not the enchants', () => {
  const r = buildItemQuery(item('QFNEVieqypZt.xml', 1), db, { countOffset: 1 })
  const { and, count } = groups(r.query)
  assert.equal(count.value.min, count.filters.length - 1)
  assert.equal(and.filters.length, 3)
})

test('corrupted cluster is searched as corrupted', () => {
  const text = item('cJtARuNOS4Xg.xml', 27) + '\nCorrupted'
  assert.equal(parseItem(text).corrupted, true)
  const r = buildItemQuery(text, db)
  assert.equal(r.query.query.filters.misc_filters.filters.corrupted.option, 'true')
})
