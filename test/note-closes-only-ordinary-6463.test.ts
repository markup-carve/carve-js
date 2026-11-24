import { describe, expect, it } from 'vitest'
import { format, parse, render, treesEqual, writeWithDiagnostics } from '../src/index.ts'

// carve#6463: a note that closes only with its caret pairs read as brackets is a note (C2-I-089).
describe('C2-I-089: a note closes at its match with its caret pairs read as brackets (carve#6463)', () => {
  it('forms the note of a block-image line, so the image does not form', () => {
    expect(render('![^[[^]](u)\n')).toBe([
      '<p>![<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a>(u)</p>',
      '<section role="doc-endnotes" aria-label="Footnotes">',
      '  <hr>',
      '  <ol>',
      '    <li id="fn1">',
      '      <p>[^]<a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>',
      '    </li>',
      '  </ol>',
      '</section>',
    ].join('\n'))
  })

  it.each(['![^[[^]](u)', 'x ![^[[^]](u)', '![ ^[[^1][[^1]a](u)', 'x ![ ^[[^1][[^1]a](u)'])('reads %j as text, a note and text', (line) => {
    const paragraph = parse(`${line}\n\n[^1]: n\n`).children[0] as { role?: string, children: { type: string }[] }
    expect(paragraph.role).toBeUndefined()
    expect(paragraph.children.map((node) => node.type)).toEqual(['text', 'inline_footnote', 'text'])
    expect(paragraph.children.at(-1)).toMatchObject({ value: '(u)' })
  })

  it('takes the note of input 2 with the full reference shape and the text in it', () => {
    const note = (parse('![ ^[[^1][[^1]a](u)\n\n[^1]: n\n').children[0] as { children: { type: string }[] }).children[1]!
    expect(note).toMatchObject({ type: 'inline_footnote' })
    expect(JSON.stringify(note)).not.toContain('footnote_ref')
  })

  it('leaves a note that closes in neither reading as text, and reads on behind its `^[`', () => {
    expect(render('^[a [^1]\n\n[^1]: n\n')).toContain('<p>^[a <a id="fnref1"')
    expect(render('x ^[a ^[b] c\n')).toContain('<p>x ^[a <a id="fnref1"')
  })

  it.each(['![^[[^]](u)\n', '![ ^[[^1][[^1]a](u)\n\n[^1]: n\n', 'x ![^[a[^]](u)\n'])('writes the tree of %j with no loss', (source) => {
    const tree = parse(source)
    const written = writeWithDiagnostics(tree)
    expect(written.diagnostics).toEqual([])
    expect(treesEqual(parse(written.source), tree)).toBe(true)
    expect(format(written.source)).toBe(written.source)
  })
})
