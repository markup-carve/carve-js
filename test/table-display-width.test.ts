import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { tableDisplayWidth, tableGraphemeClusters } from '../src/table/table-display-width.js'

const cases = readFileSync(new URL('./fixtures/grapheme-break-18.txt', import.meta.url), 'utf8')
  .split('\n')
  .map(line => line.split('#')[0]!.trim())
  .filter(Boolean)

function decoded(line: string): string[] {
  return line.split('÷').slice(1, -1).map(group =>
    group.trim().split('×').join(' ').trim().split(/\s+/).map(hex => String.fromCodePoint(parseInt(hex, 16))).join(''))
}

describe('Unicode 18 table display width', () => {
  test('matches the Unicode grapheme break suite', () => {
    for (const line of cases) {
      const clusters = decoded(line)
      expect(tableGraphemeClusters(clusters.join('')), line).toEqual(clusters)
    }
  })

  test('counts W/F clusters twice and other clusters once', () => {
    expect(tableDisplayWidth('山田太郎')).toBe(8)
    expect(tableDisplayWidth('e\u0301')).toBe(1)
    expect(tableDisplayWidth('💻')).toBe(2)
    expect(tableDisplayWidth('·')).toBe(1)
    expect(tableDisplayWidth('')).toBe(0)
  })
})
