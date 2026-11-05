import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, parse, toAstJson } from '../src/index.js'

// carve#5178: an erased `%%` line is a child of the innermost container whose content
// column it reaches, else the document, whatever follows it (CARVE-P0-005).
type Node = { type: string; pos?: { startOffset?: number; endOffset?: number }; children?: Node[]; items?: Node[] }

function parentOf(node: Node, path = '$'): string | null {
  for (const key of ['children', 'items'] as const) {
    for (const [i, child] of (node[key] ?? []).entries()) {
      if (child.type === 'comment') return `${path} ${node.type}`
      const found = parentOf(child, `${path}.${key}[${i}]`)
      if (found) return found
    }
  }
  return null
}

const span = (node: Node | undefined): string => node?.pos ? `${node.pos.startOffset}..${node.pos.endOffset}` : 'none'
const wire = (source: string): Node => toAstJson(parse(source)) as unknown as Node

describe('an erased comment line is a child of the container its column reaches', () => {
  it.each([
    ['the simple case', '- a\n\n  %% n\n- b\n', '$.children[0].items[0] list_item'],
    ['corpus 620-14', '- - a\n\n  %% just a note\n- b\n', '$.children[0].items[0] list_item'],
    ['corpus 504-18', ':: a\n: b\n  :: c\n  %% note\n  more\n', '$.children[0].items[1] definition_description'],
    ['corpus 937', '- :: term\n  : payload\n\n    %% c\n- sub\n', '$.children[0].items[0].children[0].items[1] definition_description'],
    ['a column that reaches no container', '- a\n\n%% n\n  z\n', '$ document'],
    ['below the description column', ':: t\n: a\n\n %% n\n  z\n', '$ document'],
    ['below the column of a folded paragraph', '- a\n%% c\nb\n', '$ document'],
    ['in a quote', '> - a\n>\n>   %% n\n> - b\n', '$.children[0].children[0].items[0] list_item'],
    ['in a div', '::: note\n- a\n\n  %% n\n- b\n:::\n', '$.children[0].children[0].items[0] list_item'],
  ])('%s', (_name, source, parent) => {
    expect(parentOf(wire(source))).toBe(parent)
    const written = carveToCarve(source)
    expect(carveToHtml(written)).toBe(carveToHtml(source))
    expect(parentOf(wire(written))).toBe(parent)
  })

  it('gives corpus 620-14 the outer item its span and the list its pos', () => {
    const [list] = wire('- - a\n\n  %% just a note\n- b\n').children!
    expect(span(list)).toBe('0..27')
    expect(span(list!.items![0])).toBe('0..23')
  })

  it('gives corpus 504-18 the description its span from the marker to the paragraph', () => {
    const [list] = wire(':: a\n: b\n  :: c\n  %% note\n  more\n').children!
    expect(span(list)).toBe('0..32')
    expect(span(list!.items![1])).toBe('5..32')
  })

  it('writes corpus 504-18 with the comment between the nested list and the paragraph', () => {
    expect(carveToCarve(':: a\n: b\n  :: c\n  %% note\n  more\n')).toBe(':: a\n: b\n\n  :: c\n\n  %% note\n\n  more\n')
  })
})
