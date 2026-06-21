import { describe, expect, it } from 'vitest'

import {
  carveToHtml,
  codeGroup,
  defaultAttributes,
  details,
  listTable,
  spoiler,
  tabs,
  type CarveExtension,
} from '../src/index.js'

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

  it('drops malformed programmatic attribute names', () => {
    const out = carveToHtml('x', {
      extensions: [
        defaultAttributes({
          defaults: {
            paragraph: { 'x" autofocus onfocus="alert(1)': 'pwned', title: 'ok' },
          },
        }),
      ],
    }).trim()

    expect(out).toBe('<p title="ok">x</p>')
    expect(out).not.toContain('autofocus')
    expect(out).not.toContain('onfocus')
  })

  it('escapes programmatically-added class values', () => {
    const addClass: CarveExtension = {
      name: 'class-injection-test',
      beforeRender(doc) {
        const para = doc.children[0]
        if (para?.type === 'paragraph') {
          para.attrs = { classes: ['ok', 'x" onclick="alert(1)'] }
        }
        return doc
      },
    }
    expect(carveToHtml('x', { extensions: [addClass] })).toBe(
      '<p class="ok x&quot; onclick=&quot;alert(1)">x</p>',
    )
  })

  it('applies to list-table cells too (same core path)', () => {
    const src = ['::: list-table', '- -{onclick="x"} A', '  - B', ':::'].join('\n')
    const out = carveToHtml(src, { extensions: [listTable()] }).trim()
    expect(out).toContain('<td>A</td>')
    expect(out).not.toContain('onclick')
  })

  it('applies to extension wrapper attributes', () => {
    const attrs = '{onclick="alert(1)" style="x:expression(1)"}'
    const cases = [
      carveToHtml(`${attrs}\n::: details "T"\nx\n:::`, { extensions: [details()] }),
      carveToHtml(`${attrs}\n:::: tabs\n::: tab\nx\n:::\n::::`, { extensions: [tabs()] }),
      carveToHtml(`${attrs}\n::: code-group\n\`\`\` js\nx\n\`\`\`\n:::`, {
        extensions: [codeGroup()],
      }),
      carveToHtml(`${attrs}\n::: spoiler "T"\nx\n:::`, { extensions: [spoiler()] }),
    ]
    for (const out of cases) {
      expect(out).not.toContain('onclick=')
      expect(out).not.toContain('expression(')
      expect(out).toContain('style=""')
    }
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

  it('normalizes CSS escapes before scanning dangerous constructs', () => {
    expect(h('[x]{style="background:u\\72l(http://e/p)"}')).toBe(
      '<p><span style="">x</span></p>',
    )
    // Escaped UPPERCASE code points must fold too: `\55` -> `U` -> url(.
    expect(h('[x]{style="background:\\55rl(http://e/p)"}')).toBe(
      '<p><span style="">x</span></p>',
    )
    expect(h('[x]{style="\\45xpression(alert(1))"}')).toBe('<p><span style="">x</span></p>')
  })

  it('keeps a plain style value', () => {
    expect(h('[x]{style="color:red"}')).toContain('style="color:red"')
  })
})
