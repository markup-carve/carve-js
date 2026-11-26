// Named snippets beyond the clause cases: the marker parts and the carriers a document transform keeps.
import { describe, expect, it } from 'vitest'
import { type DocumentNode, parseTree, render, renderTree, renderWithDiagnostics, renderWithDocumentTransforms, resolveTree } from '../src/index.ts'
import { withSnippetLimits } from '../src/harness-limits.ts'

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

  it('C2-N-091: the staged API expands on its own copy and leaves the parsed tree its uses', () => {
    const parsed = parseTree('{$x}: Hello\n\n{{ $x }}\n')
    expect(renderTree(resolveTree(parsed))).toBe('<p>Hello</p>')
    expect(parsed.document.children.map((node) => node.type)).toEqual(['snippet_definition', 'snippet_use'])
  })

  it('C2-N-095: an authored definition with no use is no transform finding, a resolved reference in it neither', () => {
    const append = [{ name: 'append', transform: (view: DocumentNode) => {
      view.children.push({ type: 'paragraph', children: [{ type: 'text', value: 'end' }] })
      return view
    } }]
    for (const source of ['{$x}: Hello\n\nA\n', '{$x}: [l][k]\n\n[k]: /u\n\n{{ $x }}\n']) {
      expect(renderWithDocumentTransforms(source, append, { strictLosses: true }).diagnostics).toEqual([])
    }
  })

  it('C2-H-215: a lone link inside link text puts the carriers on a span, and an abbreviation in a definition writes as text', () => {
    const result = renderWithDiagnostics('*[A]: Long\n\n{$x}: [A](/inner)\n\n[{{ $x }}](/outer)\n', { roundtrip: true })
    expect(result.html).toContain('<span data-carve-snippet="1:inline:$x"><abbr title="Long">A</abbr></span>')
    expect(result.html).toContain('<template data-carve-snippets>{$x}: [A](/inner)</template>')
    expect(result.diagnostics).toEqual([])
  })

  it('C2-H-115, C2-H-215: authored snippet carriers are dropped, and a moved inline note carries its mark', () => {
    const authored = renderWithDiagnostics('{data-carve-snippet="1:inline:$z"}\nP\n', { roundtrip: true })
    expect(authored.html).toBe('<p>P</p>')
    expect(authored.diagnostics.map((entry) => entry.code)).toEqual(['carrier-attribute-dropped'])
    expect(render('{$s}: x^[note]\n\n[Go {{ $s }}](/u)\n', { roundtrip: true })).toContain('data-carve-snippet-mark="1"')
  })

  it('C2-N-094: a key of a key-value attribute counts with its value', () => {
    // Two nodes, 64, and `text`, `X`, `paragraph`, `foo` and `v`, 18: 82 bytes.
    const source = '{$x foo=v}: X\n\n{{ $x }}\n'
    expect(withSnippetLimits({ derivedTextBytes: 82 }, () => render(source))).toBe('<p foo="v">X</p>')
    const refused = withSnippetLimits({ derivedTextBytes: 81 }, () => renderWithDiagnostics(source))
    expect(refused.diagnostics.map((entry) => entry.code)).toEqual(['derived-text-budget'])
  })
})
