import { expect, it } from 'vitest'
import { carveToAstJson } from '../src/index.js'

function codeBlocks(value: unknown): Array<{ content: string; pos?: { startOffset: number; endOffset: number } }> {
  if (!value || typeof value !== 'object') return []
  const node = value as Record<string, unknown>
  if (node.type === 'code_block') return [node as { content: string; pos?: { startOffset: number; endOffset: number } }]
  return Object.entries(node).flatMap(([key, child]) => key === 'pos' ? [] :
    Array.isArray(child) ? child.flatMap(codeBlocks) : codeBlocks(child))
}

it('places an unclosed attached fence at its authored source span in every marker host (#4685)', () => {
  let checked = 0
  for (const host of ['[^a]: +', ':: t\n: +']) {
    for (const fence of ['```', '~~~']) {
      for (let i = 0; i < 250; i++) {
        const payload = `body${i.toString(36)}`
        const source = `${host}\n${fence}\n${payload}\n\nsee[^a]\n`
        const code = codeBlocks(carveToAstJson(source))[0]
        const startOffset = source.indexOf(fence)
        const endOffset = source.indexOf(payload) + payload.length
        expect(code?.content, source).toBe(`${payload}\n`)
        expect(code?.pos, source).toMatchObject({ startOffset, endOffset })
        checked++
      }
    }
  }
  expect(checked).toBe(1000)
})

it('places consecutive code blocks across an attached fence boundary (#4685)', () => {
  const source = '[^a]: +\n```\na\n\n  ```\n  c\nsee\n\nx[^a]\n'
  expect(codeBlocks(carveToAstJson(source)).map(node => node.pos)).toMatchObject([
    { startLine: 2, endLine: 3, startOffset: 8, endOffset: 13 },
    { startLine: 5, endLine: 6, startOffset: 17, endOffset: 24 },
  ])
})
