import { describe, expect, it } from 'vitest'
import { HtmlImportLimitError, htmlToAst, htmlToCarve } from '../src/index.js'

describe('HTML import', () => {
  it('builds the AST and delegates source generation to the canonical writer', () => {
    const result = htmlToCarve('<h1>Hello <em>world</em></h1><p>A <a href="https://example.com">link</a>.</p>')
    expect(result.value).toBe('# Hello /world/\n\nA [link](https://example.com).\n')
    expect(result.report.diagnostics).toEqual([])
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
  })
})
