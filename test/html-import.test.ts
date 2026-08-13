import { describe, expect, it } from 'vitest'
import { HtmlImportLimitError, htmlToAst, htmlToCarve } from '../src/index.js'

describe('HTML import', () => {
  it('builds the AST and delegates source generation to the canonical writer', () => {
    const result = htmlToCarve('<h1>Hello <em>world</em></h1><p>A <a href="https://example.com">link</a>.</p>')
    expect(result.value).toBe('# Hello /world/\n\nA [link](https://example.com).\n')
    expect(result.report.diagnostics).toEqual([])
  })

  // PART 9 §4a, carve#1159. The renderer emits a quote's attribution as a
  // `<footer>` inside the `<blockquote>`, so an importer that read it as an
  // ordinary second paragraph made the engine's own HTML un-round-trippable.
  it('reads a trailing footer in a blockquote as the attribution', () => {
    const result = htmlToCarve('<blockquote><p>To be</p><footer>Hamlet</footer></blockquote>')
    expect(result.value).toBe('> To be\n^ Hamlet\n')
  })

  it('reads a figure wrapping a quote as that quote with an attribution', () => {
    // The shape this renderer used to emit. A quote is no longer a figure
    // target, so it comes back as a quote rather than as a node the schema
    // would refuse on ingest.
    const result = htmlToAst('<figure><blockquote><p>To be</p></blockquote><figcaption>Hamlet</figcaption></figure>')
    expect(result.value.children).toMatchObject([
      { type: 'block_quote', attribution: [{ type: 'text', value: 'Hamlet' }] },
    ])
  })

  it('takes the LAST footer when a quote carries more than one', () => {
    // A quote has ONE attribution and the slot holds inline content, so a
    // second footer cannot join it. The last is the one this renderer emits
    // and the one an author puts after the quoted text; the earlier footer
    // stays an ordinary block rather than being dropped.
    const result = htmlToAst('<blockquote><footer>First</footer><p>To be</p><footer>Hamlet</footer></blockquote>')
    expect(result.value.children).toMatchObject([
      {
        type: 'block_quote',
        children: [{ type: 'paragraph', children: [{ type: 'text', value: 'First' }] }, { type: 'paragraph' }],
        attribution: [{ type: 'text', value: 'Hamlet' }],
      },
    ])
  })

  it('drops active content and reports every lossy decision', () => {
    const result = htmlToAst('<p onclick="evil()">safe<script>alert(1)</script><span title="lost"> text</span></p>')
    expect(result.value.children).toMatchObject([{ type: 'paragraph', children: [{ type: 'text', value: 'safe' }, { type: 'span' }] }])
    expect(result.report.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'attribute-dropped', 'element-dropped',
    ])
  })

  it('keeps portable attributes in semantic mode', () => {
    const result = htmlToCarve('<p id="lead" class="intro" data-x="1">Text</p>', { mode: 'semantic' })
    expect(result.value).toContain('{#lead .intro data-x=1}')
  })

  it('preserves unsupported trusted inline markup only in roundtrip mode', () => {
    const result = htmlToAst('<p><kbd>x</kbd></p>', { mode: 'roundtrip' })
    expect(result.value.children[0]).toMatchObject({ children: [{ type: 'raw_inline', format: 'html', content: '<kbd>x</kbd>' }] })
    expect(result.report.diagnostics[0]?.code).toBe('raw-preserved')
  })

  it('enforces resource limits with a typed error', () => {
    expect(() => htmlToAst('<p>x</p>', { maxNodes: 1 })).toThrow(HtmlImportLimitError)
    expect(() => htmlToAst('<p onclick="x()">x</p>', { maxDiagnostics: 0 })).toThrow(HtmlImportLimitError)
  })
})
