import { describe, expect, it } from 'vitest'
import { format, parse, treesEqual, writeWithDiagnostics } from '../src/index.ts'
import type { Node } from '../src/index.ts'

function shape(node: Node): string {
  if (node.type === 'text') return `text ${JSON.stringify(node.value)}`
  const key = 'key' in node && typeof node.key === 'string' ? ` key=${JSON.stringify(node.key)}` : ''
  const children = 'children' in node && Array.isArray(node.children) ? (node.children as Node[]).map(shape).join(', ') : ''
  return `${node.type}${key}(${children})`
}

function first(source: string): string {
  return shape(parse(source).children[0]!)
}

describe('C2-I-089: a note that would close only because a caret pair inside it opens is text (carve#6453)', () => {
  it.each([
    ['^[[[^\\}[]]]', 'paragraph(text "^[[[^}[]]]")'],
    ['^[a [^1]\n\n[^1]: n', 'paragraph(text "^[a ", footnote_ref key="1"())'],
    ['x ^[a ^[b] c', 'paragraph(text "x ^[a ", inline_footnote(text "b"), text " c")'],
    ['^[^[[^]\\[]', 'paragraph(text "^[^[[^][]")'],
  ])('reads %j as the ruling says', (source, tree) => {
    expect(first(source)).toBe(tree)
  })

  it('demotes only the caret pairs up to where the note would have closed', () => {
    expect(first('^[[^][^1]^[\n\n[^1]: n')).toBe('paragraph(text "^[[^]", footnote_ref key="1"(), text "^[")')
  })

  it('keeps an image alt whose note is text as source', () => {
    expect(first('![^[^[[^]\\[]](u)')).toBe('paragraph(image())')
  })

  it.each([
    '^[\\[^\\][^1]^[\n\n[^1]: n\n', '^[^[b][^[[^[^1]\\]\n\n[^1]: n\n', '^[}^\\[[^[^1]a\\]\\[^[\n\n[^1]: n\n',
    '^[^[[^]\\[]\n',
  ])('C2-W-125: writes %j with the bracket of each text `^[` before a node escaped', (source) => {
    const out = writeWithDiagnostics(parse(source))
    expect(out.diagnostics).toEqual([])
    expect(treesEqual(parse(out.source), parse(source))).toBe(true)
    expect(format(out.source)).toBe(out.source)
  })

  it('C2-W-091: prunes the backslash of an empty reference behind a note opener that closed before it', () => {
    expect(format('^\\[x] \\[^]\n')).toBe('^\\[x] [^]\n')
  })
})
