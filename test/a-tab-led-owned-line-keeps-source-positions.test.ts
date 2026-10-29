import { expect, it } from 'vitest'
import { parse } from '../src/index.js'

// The walk writes a tab lead as spaces; a negative cut maps only those synthetic columns.
it.each([
  '- a\n\t- b\n',
  '- a\n\t\t- b\n',
  ':: t\n\t: body\n',
  '> - a\n>\t- b\n',
])('keeps every node on its source text: %j', (source) => {
  const visit = (node: unknown): void => {
    if (node === null || typeof node !== 'object') return
    const record = node as Record<string, unknown>
    const pos = record['pos'] as { startOffset: number, endOffset: number } | undefined
    if (pos && record['type'] === 'text') expect(source.slice(pos.startOffset, pos.endOffset)).toBe(record['value'])
    if (pos) expect(pos.startOffset).toBeGreaterThanOrEqual(0)
    for (const [key, value] of Object.entries(record)) if (key !== 'pos') visit(value)
  }
  visit(parse(source))
})
