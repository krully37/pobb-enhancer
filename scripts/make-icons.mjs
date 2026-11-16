// Renders icons/icon-{16,32,48,128}.png: two gold trade arrows on a dark rounded square.
// Zero dependencies (hand-rolled PNG encoder). Run: node scripts/make-icons.mjs
import { writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync, crc32 } from 'node:zlib'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons')
const BG = [30, 27, 24]
const FG = [200, 162, 107]

// Shape in unit coordinates (0..1). Returns 0 = transparent, 1 = background, 2 = arrow.
function shape (x, y) {
  const r = 0.2
  const cx = Math.min(Math.max(x, r), 1 - r)
  const cy = Math.min(Math.max(y, r), 1 - r)
  if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) return 0
  // Top arrow pointing right, bottom arrow pointing left.
  const arrow = (yc, dir) => {
    const shaftHalf = 0.055
    const headLen = 0.2
    const headHalf = 0.15
    const x0 = 0.2
    const x1 = 0.8
    const tip = dir > 0 ? x1 : x0
    const headBase = tip - dir * headLen
    const inShaft = Math.abs(y - yc) <= shaftHalf && (dir > 0 ? x >= x0 && x <= headBase : x <= x1 && x >= headBase)
    const t = (x - headBase) * dir // 0 at head base, headLen at tip
    const inHead = t >= 0 && t <= headLen && Math.abs(y - yc) <= headHalf * (1 - t / headLen)
    return inShaft || inHead
  }
  if (arrow(0.34, 1) || arrow(0.66, -1)) return 2
  return 1
}

function render (size) {
  const SS = 4
  const rows = []
  for (let py = 0; py < size; py++) {
    const row = Buffer.alloc(1 + size * 4)
    for (let px = 0; px < size; px++) {
      let a = 0; let rr = 0; let gg = 0; let bb = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const s = shape((px + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size)
          if (!s) continue
          const c = s === 2 ? FG : BG
          a++; rr += c[0]; gg += c[1]; bb += c[2]
        }
      }
      const o = 1 + px * 4
      if (a) { row[o] = rr / a; row[o + 1] = gg / a; row[o + 2] = bb / a }
      row[o + 3] = Math.round(255 * a / (SS * SS))
    }
    rows.push(row)
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type), data])
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td))
    return Buffer.concat([len, td, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0))
  ])
}

mkdirSync(OUT, { recursive: true })
for (const size of [16, 32, 48, 128]) writeFileSync(join(OUT, `icon-${size}.png`), render(size))
console.log('icons written to', OUT)
