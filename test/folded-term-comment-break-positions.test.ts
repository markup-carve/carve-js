import { expect, it } from 'vitest'
import { parse, toAstJson } from '../src/index.js'

it.each(['\n', '\r\n', '\r'])('positions the line endings beside folded term comments (%j)', (eol) => {
  const source = ['> :: 😀', '>   %% note', '>   more', ''].join(eol)
  const breaks: Record<string, any>[] = []
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(visit); return }
    if (!value || typeof value !== 'object') return
    const node = value as Record<string, any>
    if (node.type === 'soft_break') breaks.push(node)
    for (const [key, child] of Object.entries(node)) if (key !== 'pos') visit(child)
  }
  visit(toAstJson(parse(source, { positions: true })))
  expect(breaks).toHaveLength(2)
  for (const node of breaks) {
    expect(node.pos).toBeDefined()
    expect(Array.from(source).slice(node.pos.startOffset, node.pos.endOffset).join('')).toBe(eol)
    expect(node.pos.endColumn).toBe(1)
    expect(node.pos.endLine).toBe(node.pos.startLine + 1)
  }
})
