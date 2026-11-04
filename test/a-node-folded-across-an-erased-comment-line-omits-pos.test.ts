/*
 * PART 12 §4 (CARVE-P12-014, CARVE-P12-022), carve#5136: S1 erases a `%%`
 * line before layout, so a paragraph folds across it while the comment stays a
 * block-level sibling with its own span. The paragraph and the soft break that
 * crosses the line omit `pos`; a container the line sits inside, where the
 * comment is not its descendant, omits `pos` too; one the line would only
 * trail ends at its last child.
 */
import { describe, it, expect } from 'vitest'
import { fromAstJson, parse, renderCarve, toAstJson } from '../src/index.js'

type Node = { type: string; pos?: { startOffset?: number; endOffset?: number }; [key: string]: unknown }

function span(node: Node): string {
  return node.pos ? `${node.pos.startOffset}..${node.pos.endOffset}` : 'none'
}

function wire(source: string): Node {
  return toAstJson(parse(source)) as unknown as Node
}

describe('a node folded across an erased comment line omits pos', () => {
  it('omits the paragraph and soft break spans and keeps the comment and text spans (corpus 662)', () => {
    const doc = wire('a\n%%\tx\nb\n')
    const [paragraph, comment] = doc.children as Node[]
    const parts = paragraph!.children as Node[]
    expect(paragraph!.type).toBe('paragraph')
    expect(parts.map((child) => `${child.type} ${span(child)}`)).toEqual(['text 0..1', 'soft_break none', 'text 7..8'])
    expect(span(paragraph!)).toBe('none')
    expect(`${comment!.type} ${span(comment!)}`).toBe('comment 2..6')
  })

  it('omits only the paragraph inside a list item that holds the comment (corpus 183)', () => {
    const doc = wire('- a\n %% c\nb\n')
    const list = (doc.children as Node[])[0]!
    const item = (list.items as Node[])[0]!
    const [paragraph, comment] = item.children as Node[]
    expect(span(list)).not.toBe('none')
    expect(span(item)).not.toBe('none')
    expect(span(paragraph!)).toBe('none')
    expect(comment!.type).toBe('comment')
  })

  it('ends an item before a trailing erased line and omits the list it sits inside (corpus 937)', () => {
    const doc = wire('- :: term\n  : payload\n\n    %% c\n- sub\n')
    const [list, comment] = doc.children as Node[]
    const [first, second] = list!.items as Node[]
    expect(span(first!)).toBe('0..21')
    expect(span(second!)).toBe('32..37')
    expect(span(list!)).toBe('none')
    expect(`${comment!.type} ${span(comment!)}`).toBe('comment 27..31')
  })

  it('does not stretch an item emptied by a marker-line note onto the erased line (corpus 585)', () => {
    const doc = wire('- [^n]: text\n    %% c\n    ```\n    code\n    ```\nafter [^n]\n')
    const item = ((doc.children as Node[])[0]!.items as Node[])[0]!
    expect(span(item)).toBe('0..2')
  })

  it('ends a description at the lazy text folded across the line (corpus 350-6)', () => {
    const doc = wire(':: t\n:  a\n   %% c\ntail\n')
    const list = (doc.children as Node[])[0]!
    const description = (list.items as Node[])[1]!
    expect(span(list)).toBe('0..22')
    expect(span(description)).toBe('5..22')
  })

  it('leaves a comment in a hoisted note to the hoisting exemption (corpus 578-3)', () => {
    const doc = wire('- [^n]: %% c\n    - child\n   ```\n   code\n   ```\nafter [^n]\n')
    const list = (doc.children as Node[])[0]!
    expect(span(list)).not.toBe('none')
  })

  it('round-trips the omitted spans and writes the comment back in place', () => {
    for (const source of ['a\n%% x\nb\n', '- :: term\n  : payload\n\n    %% c\n- sub\n', ':: a\n: b\n  :: c\n    %% note\n    more\n']) {
      const json = toAstJson(parse(source))
      const back = fromAstJson(JSON.parse(JSON.stringify(json)))
      expect(toAstJson(back)).toEqual(json)
      expect(renderCarve(back)).toBe(renderCarve(parse(source)))
    }
  })
})
