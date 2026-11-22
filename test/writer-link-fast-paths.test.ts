import { expect, it } from 'vitest'
import { foldLabel } from '../src/ast-attributes.ts'
import { mergeLinkEscapes } from '../src/write-inline.ts'

it('reuses an unchanged escape list throughout nested link writes', () => {
  const escapes = [1, 4, 9]
  expect(mergeLinkEscapes(escapes, [4, 9])).toBe(escapes)
  expect(mergeLinkEscapes(escapes, [])).toBe(escapes)
  expect(mergeLinkEscapes(escapes, [4, 7, 9])).toEqual([1, 4, 7, 9])
})

it('folds a long label without rescanning each character in JavaScript', () => {
  const source = 'label'.repeat(26_215)
  const scan = (value: string): string => {
    let out = ''
    let gap = false
    let start = 0
    for (let at = 0; at < value.length; at++) {
      const code = value.charCodeAt(at)
      if (code !== 32 && code !== 9 && code !== 10) continue
      if (at > start) out += (gap && out !== '' ? ' ' : '') + value.slice(start, at)
      gap = true
      start = at + 1
    }
    if (start < value.length) out += (gap && out !== '' ? ' ' : '') + value.slice(start)
    return out
  }
  expect(foldLabel(source)).toBe(source)
  expect(foldLabel(` \t${source}\n`)).toBe(source)
  for (let warm = 0; warm < 10; warm++) { foldLabel(source); scan(source) }
  const cpu = (operation: (value: string) => string): number => {
    const before = process.cpuUsage()
    for (let call = 0; call < 300; call++) operation(source)
    const after = process.cpuUsage(before)
    return after.user + after.system
  }
  expect(cpu(foldLabel)).toBeLessThan(cpu(scan) / 5)
})
