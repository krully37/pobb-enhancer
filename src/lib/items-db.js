// Lookups over the slimmed APT items dataset (src/data/items.ndjson).

export class ItemsDb {
  constructor (ndjson) {
    this.bases = new Map()
    this.uniques = new Map()
    this.gems = new Map()
    for (const line of ndjson.split('\n')) {
      if (!line.trim()) continue
      const e = JSON.parse(line)
      if (e.namespace === 'ITEM') { if (!this.bases.has(e.name)) this.bases.set(e.name, e) } else if (e.namespace === 'UNIQUE') { if (!this.uniques.has(e.name)) this.uniques.set(e.name, e) } else if (e.namespace === 'GEM') { if (!this.gems.has(e.name)) this.gems.set(e.name, e) }
    }
    // Longest names first, so "Divine Life Flask" wins over "Life Flask".
    this.baseNamesByLength = [...this.bases.keys()].sort((a, b) => b.length - a.length)
  }

  // Finds the base type inside a magic/normal item name, e.g.
  // "Seething Divine Life Flask of Staunching" -> "Divine Life Flask".
  resolveBase (line) {
    if (this.bases.has(line)) return line
    for (const name of this.baseNamesByLength) {
      const i = line.indexOf(name)
      if (i === -1) continue
      const before = i === 0 || line[i - 1] === ' '
      const after = i + name.length === line.length || line[i + name.length] === ' '
      if (before && after) return name
    }
    return line
  }

  category (base) {
    const e = this.bases.get(base)
    return e ? e.category : undefined
  }

  unique (name) {
    return this.uniques.get(name)
  }

  // pobb.in shows support gems without the " Support" suffix the trade site uses.
  gem (name) {
    return this.gems.get(name) || this.gems.get(name + ' Support')
  }
}
