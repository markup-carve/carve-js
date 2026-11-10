import { expect, it } from 'vitest'
import { parse, toAstJson } from '../src/index.js'

it.each([
  '- [ ] {.x\n   }\n   z\n',
  '- [ ] {.x\n   }\n    word\n',
  '- {.x\n  }\n   word\n',
  '1. {.x\n   }\n    word\n',
  '- {.x\n  }\n   word\n',
])('places a refused run follower on its authored text in %j (carve-js#4872)', (source) => {
  const ast = toAstJson(parse(source))
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit)
      return
    }
    if (!node || typeof node !== 'object') return
    const record = node as Record<string, unknown>
    if (record.type === 'text' && record.pos) {
      const pos = record.pos as { startOffset: number; endOffset: number }
      expect(source.slice(pos.startOffset, pos.endOffset)).toBe(record.value)
    }
    Object.values(record).forEach(visit)
  }
  visit(ast)
})
