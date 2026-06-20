import { describe, expect, it } from 'vitest'

import { carveToHtml, listTable } from '../src/index.js'

/** Render to HTML, trimmed. */
const h = (s: string): string => carveToHtml(s).trim()

// Attribute XSS hardening: dangerous attribute names and values are stripped
// from ALL rendered attributes, unconditionally (no opt-in needed). See the
// security audit; this is core renderAttrs behavior, so every element that
// carries `{...}` attributes (spans, divs, headings, list-table cells, ...)
// is covered.
describe('attribute XSS hardening (always on)', () => {
  it('strips on* event-handler attributes', () => {
    expect(h('[x]{onclick="alert(1)"}')).toBe('<p><span>x</span></p>')
    expect(h('[x]{onmouseover="x" class="c"}')).toBe('<p><span class="c">x</span></p>')
  })

  it('strips srcdoc and formaction', () => {
    expect(h('[x]{srcdoc="<script>" formaction="y" title="ok"}')).toBe(
      '<p><span title="ok">x</span></p>',
    )
  })

  it('blanks a dangerous URL scheme in any attribute value', () => {
    expect(h('[x]{background="javascript:alert(1)"}')).toBe('<p><span background="">x</span></p>')
    expect(h('[x]{poster="vbscript:x"}')).toBe('<p><span poster="">x</span></p>')
  })

  it('defeats scheme obfuscation (control chars / spaces before the colon)', () => {
    expect(h('[x]{background="java\tscript:alert(1)"}')).toBe('<p><span background="">x</span></p>')
  })

  it('blanks a CSS expression() style value but keeps plain styles', () => {
    expect(h('[x]{style="x:expression(alert(1))"}')).toBe('<p><span style="">x</span></p>')
    expect(h('[x]{style="color:red"}')).toBe('<p><span style="color:red">x</span></p>')
  })

  it('keeps safe attributes untouched', () => {
    expect(h('[x]{title="hello" data-id="42" class="a b"}')).toBe(
      '<p><span title="hello" data-id="42" class="a b">x</span></p>',
    )
  })

  it('applies to list-table cells too (same core path)', () => {
    const src = ['::: list-table', '- -{onclick="x"} A', '  - B', ':::'].join('\n')
    const out = carveToHtml(src, { extensions: [listTable()] }).trim()
    expect(out).toContain('<td>A</td>')
    expect(out).not.toContain('onclick')
  })
})
