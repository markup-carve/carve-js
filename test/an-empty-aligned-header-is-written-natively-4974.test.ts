import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, parse } from '../src/index.js'

// carve#4974: `|=< |` spells an empty left-aligned header, so the canonical
// writer needs no separator row for it (PART 11 §6h).
const strip = (key: string, value: unknown): unknown => key === 'pos' || key === 'separatorWidths' ? undefined : value
const tree = (source: string): string => JSON.stringify(parse(source).children, strip)

describe('an empty aligned header cell is written with native |= cells', () => {
  it('writes the ticket shape without a separator row', () => {
    const source = '| | b |\n|:--|---|\n| 1 | 2 |\n'
    expect(carveToCarve(source)).toBe('|={<} |= b |\n| 1 | 2 |\n')
  })

  it('keeps HTML, tree and bytes across 864 variants', () => {
    const containers: ((s: string) => string)[] = [
      s => s,
      s => s.split('\n').filter(Boolean).map(line => `> ${line}`).join('\n') + '\n',
      s => s.split('\n').filter(Boolean).map(line => `> > ${line}`).join('\n') + '\n',
      s => `::: note\n${s}:::\n`,
      s => `- item\n+\n${s}`,
      s => `1. item\n+\n${s}`,
    ]
    const colons = ['---', ':--', '--:', ':-:']
    let count = 0
    for (const wrap of containers) for (let columns = 1; columns <= 3; columns++) {
      for (let empty = 0; empty < columns; empty++) for (const colon of colons) for (const other of colons.slice(0, 3)) {
        for (let extra = 0; extra <= 1; extra++) {
          const heads = Array.from({ length: columns }, (_, i) => i === empty ? '' : `H${i}`)
          const separator = heads.map((_, i) => i === empty ? colon : other)
          const cells = Array.from({ length: columns + extra }, (_, i) => `v${i}`)
          const source = wrap(`| ${heads.join(' | ')} |\n|${separator.join('|')}|\n| ${cells.join(' | ')} |\n`)
          const once = carveToCarve(source)
          expect(once, `variant ${count}`).not.toMatch(/\|[-:]+\|/)
          expect(carveToHtml(once), `variant ${count}`).toBe(carveToHtml(source))
          expect(tree(once), `variant ${count}`).toBe(tree(source))
          expect(carveToCarve(once), `variant ${count}`).toBe(once)
          count++
        }
      }
    }
    expect(count).toBe(864)
  })
})
