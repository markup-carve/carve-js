import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, parse } from '../src/index.js'

// carve#4974 ruling A: fmt writes a separator row only for a placeholder with no
// origin in the head row (a `^`, or a `<` in column 0) or one carrying an alignment.
// A placeholder's `header` flag follows its spelling, so the tree check ignores it.
const strip = (key: string, value: unknown): unknown => {
  if (key === 'pos' || key === 'separatorWidths') return undefined
  const cell = value as { span?: string, header?: boolean } | null
  return cell && typeof cell === 'object' && cell.span !== undefined ? { ...cell, header: undefined } : value
}
const tree = (source: string): string => JSON.stringify(parse(source).children, strip)
const separatorRow = /^(?:[> ]*|\s*)\|[-:|]+\|$/m

describe('a head row with spans is written with native |= cells', () => {
  it('writes a real cell after a header span natively', () => {
    expect(carveToCarve('| A | < | B |\n|---|---|:--|\n| 1 | 2 | 3 |\n')).toBe('|= A | < |=< B |\n| 1 | 2 | 3 |\n')
  })

  it('keeps the separator for an aligned covered placeholder', () => {
    const source = '| A | < |\n|---|:--|\n| 1 | 2 |\n'
    const once = carveToCarve(source)
    expect(once).toMatch(separatorRow)
    expect(carveToHtml(once)).toBe(carveToHtml(source))
  })

  it('keeps HTML, tree and bytes across head-row span variants', () => {
    const containers: ((s: string) => string)[] = [
      s => s,
      s => s.split('\n').filter(Boolean).map(line => `> ${line}`).join('\n') + '\n',
      s => `::: note\n${s}:::\n`,
      s => `- item\n+\n${s}`,
    ]
    const heads = ['A', '', '<', '^']
    const colons = ['---', ':--', '--:', ':-:']
    let count = 0
    containers.forEach((wrap, containerIndex) => {
      for (let columns = 1; columns <= (containerIndex === 0 ? 3 : 2); columns++) {
        for (let k = 0; k < 16 ** columns; k++) {
          let x = k
          const head: string[] = []
          const separator: string[] = []
          for (let i = 0; i < columns; i++) {
            head.push(heads[x % 4]!); x = Math.floor(x / 4)
            separator.push(colons[x % 4]!); x = Math.floor(x / 4)
          }
          const source = wrap(`| ${head.join(' | ')} |\n|${separator.join('|')}|\n| ${head.map((_, i) => `v${i}`).join(' | ')} |\n`)
          const ruled = head.includes('^') || head[0] === '<' || head.some((cell, i) => cell === '<' && separator[i] !== '---')
          const once = carveToCarve(source)
          const label = `variant ${count}: ${JSON.stringify(source)}`
          expect(separatorRow.test(once), label).toBe(ruled)
          expect(carveToHtml(once), label).toBe(carveToHtml(source))
          expect(tree(once), label).toBe(tree(source))
          expect(carveToCarve(once), label).toBe(once)
          count++
        }
      }
    })
    expect(count).toBe(16 + 256 + 4096 + 3 * (16 + 256))
  })
})
