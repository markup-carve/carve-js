// Named snippets beyond the clause cases: the marker parts and the carriers a document transform keeps.
import { describe, expect, it } from 'vitest'
import { parseTree, render, renderWithDiagnostics, renderWithDocumentTransforms } from '../src/index.ts'

describe('named snippets', () => {
  it('C2-B-236: a glued block after a quoted value holding } still reads', () => {
    const definition = parseTree('{$x title="a}b"}{.foo}: Hi', { positions: false }).document.children[0]
    expect(definition?.attrs).toEqual({ classes: ['foo'], keyValues: [['title', 'a}b']] })
  })

  it('C2-H-215: a document transform that changes the view keeps the carriers of the uses', () => {
    const result = renderWithDocumentTransforms('{$x}: Hello\n\n{{ $x }}\n', [{ name: 'append', transform: (view) => {
      view.children.push({ type: 'paragraph', children: [{ type: 'text', value: 'end' }] })
      return view
    } }], { roundtrip: true })
    expect(result.html).toContain('<p data-carve-snippet="1:block:$x">Hello</p>')
    expect(result.html).toContain('<p>end</p>')
  })

  it('C2-N-090: the definitions of an include inside a container join the registry', () => {
    const includes = ({ path }: { path: string }) => path === 'a.crv' ? { text: '{$v}: X\n', id: path } : { error: 'not_found' as const }
    const result = renderWithDiagnostics('- {{ a.crv }}\n\n{{ $v }}\n', { includes })
    expect(result.html).toContain('<p>X</p>')
    expect(result.diagnostics).toEqual([])
  })

  it('C2-H-215: a copy that renders as one link carries the carriers on its a, and a span where it writes none', () => {
    expect(render('{$v}: [x](/u)\n\nA {{ $v }}\n', { roundtrip: true })).toContain('<a href="/u" data-carve-snippet="1:inline:$v">x</a>')
    expect(render('{$v}: [x][k]\n\nA {{ $v }}\n', { roundtrip: true })).toContain('<span data-carve-snippet="1:inline:$v">[x][k]</span>')
  })
})
