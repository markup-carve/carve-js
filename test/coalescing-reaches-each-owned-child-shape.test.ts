import { describe, expect, it } from 'vitest'
import type { BlockNode, InlineNode } from '../src/ast.js'
import { parse, resolve } from '../src/index.js'

function splitText(): InlineNode[] {
  return [{ type: 'text', value: 'a' }, { type: 'text', value: 'b' }]
}

const joined = [{ type: 'text', value: 'ab' }]

function resolved(block: BlockNode): BlockNode | undefined {
  const doc = parse('')
  doc.children = [block]
  return resolve(doc).children[0]
}

describe('resolution coalesces each owned child shape', () => {
  it('reaches both substitution arms', () => {
    expect(resolved({ type: 'paragraph', children: [
      { type: 'substitution', old: splitText(), new: splitText() },
    ] })).toMatchObject({ children: [{ old: joined, new: joined }] })
  })

  it('reaches citation prefixes, locators and suffixes', () => {
    expect(resolved({ type: 'paragraph', children: [
      { type: 'citation_group', raw: '[@k]', items: [{ type: 'citation', key: 'k', suppressAuthor: false,
        prefix: splitText(), locator: splitText(), suffix: splitText() }] },
    ] })).toMatchObject({ children: [{ items: [{ prefix: joined, locator: joined, suffix: joined }] }] })
  })

  it('reaches definition term and description matrices', () => {
    expect(resolved({ type: 'definition_list', items: [{
      terms: [splitText()], definitions: [[{ type: 'paragraph', children: splitText() }]],
    }] })).toMatchObject({ items: [{ terms: [joined], definitions: [[{ children: joined }]] }] })
  })

  it('reaches a figure target and short caption', () => {
    expect(resolved({ type: 'figure', caption: [], shortCaption: splitText(), target: {
      type: 'block_quote', children: [{ type: 'paragraph', children: splitText() }],
    } })).toMatchObject({ shortCaption: joined, target: { children: [{ children: joined }] } })
  })

  it('keeps authored escapes separate from text', () => {
    const nodes: InlineNode[] = [{ type: 'text', value: 'a' },
      { type: 'escaped_text', value: '*' }, { type: 'text', value: 'b' }]
    expect(resolved({ type: 'paragraph', children: [{ type: 'substitution', old: nodes, new: [] }] }))
      .toMatchObject({ children: [{ old: nodes }] })
  })
})
