import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { StatIndex } from '../src/lib/stats.js'
import { ItemsDb } from '../src/lib/items-db.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const db = {
  stats: new StatIndex(readFileSync(join(ROOT, 'src/data/stats.ndjson'), 'utf8')),
  items: new ItemsDb(readFileSync(join(ROOT, 'src/data/items.ndjson'), 'utf8'))
}
export const fixture = (name) => readFileSync(join(ROOT, 'test/fixtures', name), 'utf8')
export const fixtures = () => readdirSync(join(ROOT, 'test/fixtures')).filter(f => f.endsWith('.xml'))
