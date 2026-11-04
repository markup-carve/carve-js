import { describe, expect, it } from 'vitest'
import { parse, toAstJson } from '../src/index.js'

type Node = { type: string; pos?: { startLine: number; startColumn?: number; endLine: number; endColumn?: number }; children?: Node[]; items?: Node[] }
const span = (node: Node | undefined) => node?.pos && `${node.pos.startLine}:${node.pos.startColumn}-${node.pos.endLine}:${node.pos.endColumn}`

describe('a comment between items and a verse comment keep their spans', () => {
  it.each([
    // The unclosed `%%%` ends the item and hides the rest (carve#4907).
    ['- x\n%%%\n- y\n', '1:1-1:4', '1:3-1:4'],
    ['- x\n%% a\n- y\n', '1:1-1:4', '2:1-2:5'],
  ])('the item above ends at the comment it holds: %j', (source, item, comment) => {
    const tree = toAstJson(parse(source)) as Node
    const first = tree.children![0]!.items![0]!
    expect(span(first)).toBe(item)
    expect(span(source.includes('%% a') ? tree.children![1] : first.children!.at(-1))).toBe(comment)
  })

  it.each([
    ['::: |\n  %%%\n  secret\n  %%%\n:::\n', '2:3-4:6'],
    ['::: |\na\n   %%%\nsecret\n%%%\nc\n:::\n', '3:4-5:4'],
  ])('a verse comment block begins at its fence: %j', (source, expected) => {
    const found: Node[] = []
    const walk = (node: Node): void => {
      if (node.type === 'comment') found.push(node)
      for (const child of [...(node.children ?? []), ...(node.items ?? [])]) walk(child)
    }
    walk(toAstJson(parse(source)) as Node)
    expect(found.map(span)).toEqual([expected])
  })
})
