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

// Safe-by-default v2: URL scheme denylist, raw-HTML opt-out, CSS hardening.
describe('URL scheme sanitization (denylist, default on)', () => {
  it('blanks dangerous schemes on links and images', () => {
    expect(h('[x](javascript:alert(1))')).toContain('href=""')
    expect(h('![i](javascript:alert(1))')).toContain('src=""')
    expect(h('[x](data:text/html,foo)')).toContain('href=""')
    expect(h('[x](VBScript:msgbox(1))')).toContain('href=""')
  })

  it('allows ordinary and non-dangerous schemes (denylist, not allowlist)', () => {
    expect(h('[x](https://e.com)')).toContain('href="https://e.com"')
    expect(h('[c](tel:+15551234)')).toContain('href="tel:+15551234"')
    expect(h('[r](/docs/p)')).toContain('href="/docs/p"')
  })

  it('honors an explicit allowlist override', () => {
    expect(carveToHtml('[x](https://e.com)', { allowedUrlSchemes: ['tel'] }).trim()).toContain(
      'href=""',
    )
    expect(carveToHtml('[c](tel:+1)', { allowedUrlSchemes: ['tel'] }).trim()).toContain(
      'href="tel:+1"',
    )
  })

})

describe('raw HTML opt-out', () => {
  it('emits raw HTML by default (inline + block)', () => {
    expect(h('`<b>x</b>`{=html}')).toBe('<p><b>x</b></p>')
    expect(h('```=html\n<i>x</i>\n```')).toBe('<i>x</i>')
  })

  it('escapes raw HTML when allowRawHtml is false', () => {
    expect(carveToHtml('`<img src=x onerror=alert(1)>`{=html}', { allowRawHtml: false }).trim()).toBe(
      '<p>&lt;img src=x onerror=alert(1)&gt;</p>',
    )
    expect(carveToHtml('```=html\n<img onerror=alert(1)>\n```', { allowRawHtml: false }).trim()).toBe(
      '&lt;img onerror=alert(1)&gt;',
    )
  })
})

describe('CSS style hardening', () => {
  it('blanks script/fetch CSS constructs', () => {
    expect(h('[x]{style="x:expression(alert(1))"}')).toContain('style=""')
    expect(h('[x]{style="background:url(javascript:1)"}')).toContain('style=""')
    expect(h('[x]{style="@import url(evil.css)"}')).toContain('style=""')
    expect(h('[x]{style="behavior:url(x.htc)"}')).toContain('style=""')
  })

  it('keeps a plain style value', () => {
    expect(h('[x]{style="color:red"}')).toContain('style="color:red"')
  })
})
