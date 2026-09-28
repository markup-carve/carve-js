import { describe, expect, it } from 'vitest'
import { parse } from '../src/parse.js'
import type { InlineNode } from '../src/ast.js'

function stanza(source: string): InlineNode[] {
  const block = parse(source).children[0]
  if (block?.type !== 'line_block') throw new Error('Expected line block')
  const paragraph = block.children[0]
  if (paragraph?.type !== 'paragraph') throw new Error('Expected stanza')
  return paragraph.children
}

describe('line block boundaries in editorial branches', () => {
  it('hardens the breaks in both substitution halves', () => {
    const source = '::: |\n{~old\ntext~>new\ntext~}\n:::\n'
    const nodes = stanza(source)
    expect(nodes[0]?.type).toBe('substitution')
    if (nodes[0]?.type !== 'substitution') return
    expect(nodes[0].old.map(node => node.type)).toEqual(['text', 'hard_break', 'text'])
    expect(nodes[0].new.map(node => node.type)).toEqual(['text', 'hard_break', 'text'])
    for (const branch of [nodes[0].old, nodes[0].new]) {
      const pos = branch[1]?.pos
      expect(source.slice(pos?.startOffset, pos?.endOffset)).toBe('\n')
    }
  })

  it('reinserts a comment inside a substitution branch', () => {
    const source = '::: |\n{~old\n%% note\ntext~>new~}\n:::\n'
    const nodes = stanza(source)
    if (nodes[0]?.type !== 'substitution') throw new Error('Expected substitution')
    expect(nodes[0].old.map(node => node.type)).toEqual(['text', 'hard_break', 'comment', 'hard_break', 'text'])
  })

})
