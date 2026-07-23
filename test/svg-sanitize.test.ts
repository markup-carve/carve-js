import { describe, expect, it } from 'vitest'

import { sanitizeSvg } from '../src/svg-sanitize.js'

const wrap = (inner: string) => `<svg viewBox="0 0 10 10">${inner}</svg>`

describe('sanitizeSvg — element filtering', () => {
  it('keeps a clean presentational SVG', () => {
    const src = wrap('<path d="M0 0L10 10" fill="currentColor"/>')
    const { svg, ok } = sanitizeSvg(src)
    expect(ok).toBe(true)
    expect(svg).toContain('<path d="M0 0L10 10" fill="currentColor"')
    expect(svg).toContain('</svg>')
  })

  it('drops <script> and its content', () => {
    const { svg, ok } = sanitizeSvg(wrap('<script>alert(1)</script><circle r="5"/>'))
    expect(ok).toBe(true)
    expect(svg).not.toContain('script')
    expect(svg).not.toContain('alert')
    expect(svg).toContain('<circle r="5"')
  })

  it('drops <foreignObject> subtree', () => {
    const { svg } = sanitizeSvg(wrap('<foreignObject><body xmlns="http://www.w3.org/1999/xhtml"><img src=x onerror=alert(1)></body></foreignObject>'))
    expect(svg).not.toContain('foreignObject')
    expect(svg).not.toContain('onerror')
    expect(svg).not.toContain('<img')
  })

  it('drops SMIL animation by default (can carry onbegin / href)', () => {
    const { svg } = sanitizeSvg(wrap('<rect width="10" height="10"><animate onbegin="alert(1)" attributeName="x"/></rect>'))
    expect(svg).toContain('<rect')
    expect(svg).not.toContain('animate')
    expect(svg).not.toContain('onbegin')
  })

  it('drops comments, CDATA, PI and DOCTYPE', () => {
    const src = '<!DOCTYPE svg><?xml-stylesheet href="x"?>' + wrap('<!-- c --><![CDATA[ x ]]><path d="M0 0"/>')
    const { svg } = sanitizeSvg(src)
    expect(svg).not.toContain('<!--')
    expect(svg).not.toContain('CDATA')
    expect(svg).not.toContain('DOCTYPE')
    expect(svg).not.toContain('xml-stylesheet')
    expect(svg).toContain('<path d="M0 0"')
  })

  it('keeps nested allowed tags (groups, gradients, filters)', () => {
    const inner =
      '<defs><linearGradient id="g"><stop offset="0" stop-color="red"/></linearGradient>' +
      '<filter id="f"><feGaussianBlur stdDeviation="2"/></filter></defs>' +
      '<g transform="translate(1,1)"><rect width="8" height="8" fill="url(#g)"/></g>'
    const { svg, ok } = sanitizeSvg(wrap(inner))
    expect(ok).toBe(true)
    expect(svg).toContain('<linearGradient')
    expect(svg).toContain('<feGaussianBlur')
    expect(svg).toContain('<g transform="translate(1,1)"')
  })
})

describe('sanitizeSvg — attribute filtering', () => {
  it('strips every on* handler', () => {
    const { svg } = sanitizeSvg(wrap('<circle r="5" onclick="x()" onload="y()"/>'))
    expect(svg).toContain('<circle r="5"')
    expect(svg).not.toContain('onclick')
    expect(svg).not.toContain('onload')
  })

  it('blocks entity-encoded schemes in href (allowLinks)', () => {
    const num = sanitizeSvg(wrap('<a href="jav&#x61;script:alert(1)"><rect width="1" height="1"/></a>'), { allowLinks: true }).svg
    expect(num).not.toContain('href=')
    const named = sanitizeSvg(wrap('<a href="javascript&colon;alert(1)"><rect width="1" height="1"/></a>'), { allowLinks: true }).svg
    expect(named).not.toContain('href=')
  })

  it('accepts leading whitespace after a dropped XML declaration / DOCTYPE', () => {
    const src = '<?xml version="1.0"?>\n<!DOCTYPE svg>\n<svg viewBox="0 0 1 1"><rect width="1" height="1"/></svg>'
    const { svg, ok } = sanitizeSvg(src)
    expect(ok).toBe(true)
    expect(svg).toMatch(/^<svg/)
    expect(svg).toContain('<rect width="1" height="1"')
  })

  it('drops href="javascript:" and external href, keeps local #frag', () => {
    const bad = sanitizeSvg(wrap('<use href="javascript:alert(1)"/>')).svg
    expect(bad).not.toContain('javascript')
    const ext = sanitizeSvg(wrap('<use href="https://evil.example/x.svg#a"/>')).svg
    expect(ext).not.toContain('https://evil')
    const local = sanitizeSvg(wrap('<use href="#icon"/>')).svg
    expect(local).toContain('href="#icon"')
  })

  it('drops style by default', () => {
    const { svg } = sanitizeSvg(wrap('<rect style="fill:red" width="10" height="10"/>'))
    expect(svg).not.toContain('style')
  })

  it('with allowStyle keeps benign style but scrubs url()/expression()', () => {
    const ok = sanitizeSvg(wrap('<rect style="fill:red" width="1" height="1"/>'), { allowStyle: true }).svg
    expect(ok).toContain('style="fill:red"')
    const bad = sanitizeSvg(wrap('<rect style="background:url(javascript:alert(1))" width="1" height="1"/>'), { allowStyle: true }).svg
    expect(bad).not.toContain('url(')
    expect(bad).not.toContain('javascript')
  })

  it('always drops the <style> element, even with allowStyle (its text can @import)', () => {
    const src = wrap('<style>@import url(https://attacker.example/x.css)</style><rect width="1" height="1"/>')
    const { svg } = sanitizeSvg(src, { allowStyle: true })
    expect(svg).not.toContain('style')
    expect(svg).not.toContain('@import')
    expect(svg).not.toContain('attacker')
    expect(svg).toContain('<rect width="1" height="1"')
  })

  it('allowLinks does NOT widen external href onto fetch-capable <use>/<feImage>', () => {
    const src = wrap('<use href="https://evil.example/x.svg#a"/>')
    const on = sanitizeSvg(src, { allowLinks: true }).svg
    expect(on).not.toContain('https://evil')
    // local ref still fine
    expect(sanitizeSvg(wrap('<use href="#i"/>'), { allowLinks: true }).svg).toContain('href="#i"')
    // …but an actual <a> link is kept under allowLinks
    const link = sanitizeSvg(wrap('<a href="https://ok.example/"><rect width="1" height="1"/></a>'), { allowLinks: true }).svg
    expect(link).toContain('href="https://ok.example/"')
  })

  it('blocks OS protocol-handler schemes on links even with allowLinks', () => {
    for (const scheme of ['ms-msdt:x', 'shell:x', 'vscode:x', 'jar:x', 'search-ms:x']) {
      const svg = sanitizeSvg(wrap(`<a href="${scheme}"><rect width="1" height="1"/></a>`), { allowLinks: true }).svg
      expect(svg).not.toContain('href=')
    }
  })

  it('allowExternalImages keeps an <image> href without needing allowLinks', () => {
    const src = wrap('<image href="https://cdn.example/logo.png" width="10" height="10"/>')
    const off = sanitizeSvg(src).svg
    expect(off).not.toContain('<image')
    const on = sanitizeSvg(src, { allowExternalImages: true }).svg
    expect(on).toContain('<image')
    expect(on).toContain('href="https://cdn.example/logo.png"')
    // still scheme-checked
    const bad = sanitizeSvg(wrap('<image href="javascript:alert(1)" width="1" height="1"/>'), {
      allowExternalImages: true,
    }).svg
    expect(bad).not.toContain('javascript')
  })

  it('drops presentation attrs with an external url() ref, keeps local url(#id)', () => {
    const ext = sanitizeSvg(wrap('<rect width="1" height="1" fill="url(https://attacker.example/p.svg#x)"/>')).svg
    expect(ext).not.toContain('attacker')
    expect(ext).not.toContain('url(http')
    const filt = sanitizeSvg(wrap('<rect width="1" height="1" filter="url(//evil/x)"/>')).svg
    expect(filt).not.toContain('filter=')
    const local = sanitizeSvg(wrap('<rect width="1" height="1" fill="url(#grad)"/>')).svg
    expect(local).toContain('fill="url(#grad)"')
  })

  it('rejects a quoted url() whose target contains a )', () => {
    const { svg } = sanitizeSvg(wrap('<rect width="1" height="1" fill=\'url("https://attacker.example/a)b.svg#x")\'/>'))
    expect(svg).not.toContain('attacker')
    expect(svg).not.toContain('fill=')
  })

  it('validates each SMIL values entry (allowAnimation)', () => {
    const src = wrap('<use href="#i"><animate attributeName="href" values="#i;https://attacker.example/x.svg#j"/></use>')
    const { svg } = sanitizeSvg(src, { allowAnimation: true })
    expect(svg).not.toContain('attacker')
    expect(svg).not.toContain('values=')
    // protocol-relative and absolute-path refs are also blocked
    const rel = sanitizeSvg(wrap('<rect width="1" height="1"><animate attributeName="fill" values="#i;//evil.example/x.svg#j"/></rect>'), {
      allowAnimation: true,
    }).svg
    expect(rel).not.toContain('evil')
    expect(rel).not.toContain('values=')
    // a clean local-only values list is kept
    const clean = sanitizeSvg(wrap('<rect width="1" height="1"><animate attributeName="fill" values="#a;#b"/></rect>'), {
      allowAnimation: true,
    }).svg
    expect(clean).toContain('values="#a;#b"')
  })

  it('with allowStyle rejects CSS-escaped url() (u\\72l)', () => {
    const { svg } = sanitizeSvg(wrap('<rect width="1" height="1" style="fill:u\\72l(https://attacker.example/x.svg#p)"/>'), {
      allowStyle: true,
    })
    expect(svg).not.toContain('style')
    expect(svg).not.toContain('attacker')
  })

  it('drops unknown attributes not on the allowlist', () => {
    const { svg } = sanitizeSvg(wrap('<path d="M0 0" formaction="x" srcdoc="y"/>'))
    expect(svg).toContain('d="M0 0"')
    expect(svg).not.toContain('formaction')
    expect(svg).not.toContain('srcdoc')
  })

  it('escapes special chars in kept attribute values', () => {
    const { svg } = sanitizeSvg(wrap('<title>a &amp; b &lt; c</title>'))
    expect(svg).not.toMatch(/<title>.*<.*<\/title>/) // no raw < inside text
  })

  it('preserves existing XML entities without double-escaping', () => {
    const t = sanitizeSvg(wrap('<text>A &amp; B</text>')).svg
    expect(t).toContain('A &amp; B')
    expect(t).not.toContain('&amp;amp;')
    const a = sanitizeSvg(wrap('<text aria-label="A &quot; B">x</text>')).svg
    expect(a).toContain('aria-label="A &quot; B"')
    expect(a).not.toContain('&amp;quot;')
    // a bare & is still escaped
    expect(sanitizeSvg(wrap('<text>a & b</text>')).svg).toContain('a &amp; b')
  })
})

describe('sanitizeSvg — root guard + xmlns', () => {
  it('rejects a non-svg root', () => {
    expect(sanitizeSvg('<div>not svg</div>').ok).toBe(false)
    expect(sanitizeSvg('hello').ok).toBe(false)
  })

  it('rejects when the svg root is unclosed / malformed', () => {
    expect(sanitizeSvg('<svg><path d="M0 0"').ok).toBe(false)
  })

  it('rejects non-whitespace text before the root', () => {
    expect(sanitizeSvg('caption<svg><rect/></svg>').ok).toBe(false)
    // pure whitespace before the root is still fine
    expect(sanitizeSvg('  \n<svg viewBox="0 0 1 1"><rect width="1" height="1"/></svg>').ok).toBe(true)
  })

  it('deduplicates repeated attributes (keeps first)', () => {
    const { svg, ok } = sanitizeSvg('<svg viewBox="0 0 1 1" viewBox="0 0 2 2"><rect id="a" id="b" width="1" height="1"/></svg>')
    expect(ok).toBe(true)
    expect(svg.match(/viewBox=/g)!.length).toBe(1)
    expect(svg).toContain('viewBox="0 0 1 1"')
    const rect = /<rect[^>]*>/.exec(svg)![0]
    expect(rect.match(/\bid=/g)!.length).toBe(1)
    expect(rect).toContain('id="a"')
  })

  it('escapes non-XML named entities so data-URI SVG stays well-formed', () => {
    const { svg } = sanitizeSvg(wrap('<text>a&nbsp;b &copy; c</text>'))
    expect(svg).toContain('&amp;nbsp;')
    expect(svg).toContain('&amp;copy;')
    // XML-predefined + numeric refs are still preserved
    const keep = sanitizeSvg(wrap('<text>a &amp; b &#160; c</text>')).svg
    expect(keep).toContain('&amp; ')
    expect(keep).toContain('&#160;')
  })

  it('rejects multiple top-level svg roots', () => {
    expect(sanitizeSvg('<svg></svg><svg></svg>').ok).toBe(false)
    expect(sanitizeSvg(wrap('<rect width="1" height="1"/>') + '<svg></svg>').ok).toBe(false)
  })

  it('rejects mismatched closing tags', () => {
    expect(sanitizeSvg('<svg><path></rect></svg>').ok).toBe(false)
    expect(sanitizeSvg('<svg><g></svg>').ok).toBe(false) // stray/early close
  })

  it('rejects case-mismatched tag names (XML is case-sensitive)', () => {
    expect(sanitizeSvg('<svg><g></G></svg>').ok).toBe(false)
    expect(sanitizeSvg('<SVG><rect/></SVG>').ok).toBe(false) // non-lowercase root
  })

  it('does not exit a dropped subtree on a mismatched close', () => {
    // <script> is dropped; the </svg> must not be mistaken for closing it.
    expect(sanitizeSvg('<svg><script></svg><rect width="1" height="1"/></svg>').ok).toBe(false)
  })

  it('drops a well-formed disallowed subtree and keeps siblings', () => {
    const { svg, ok } = sanitizeSvg('<svg><script>x</script><rect width="1" height="1"/></svg>')
    expect(ok).toBe(true)
    expect(svg).not.toContain('script')
    expect(svg).toContain('<rect width="1" height="1"')
  })

  it('injects xmlns on the root when missing (needed for data-URI use)', () => {
    const { svg } = sanitizeSvg('<svg viewBox="0 0 1 1"><path d="M0 0"/></svg>')
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"')
  })

  it('forces the canonical xmlns even when the author xmlns is wrong or dangerous', () => {
    const wrong = sanitizeSvg('<svg xmlns="https://example.com" viewBox="0 0 1 1"><rect width="1" height="1"/></svg>').svg
    expect(wrong).toContain('xmlns="http://www.w3.org/2000/svg"')
    expect(wrong).not.toContain('example.com')
    expect(wrong.match(/\bxmlns=/g)!.length).toBe(1)
    const danger = sanitizeSvg('<svg xmlns="javascript:x" viewBox="0 0 1 1"><rect width="1" height="1"/></svg>').svg
    expect(danger).toContain('xmlns="http://www.w3.org/2000/svg"')
    expect(danger).not.toContain('javascript')
  })

  it('accepts a self-closing empty svg root', () => {
    const { svg, ok } = sanitizeSvg('<svg viewBox="0 0 1 1"/>')
    expect(ok).toBe(true)
    expect(svg).toMatch(/^<svg[^>]*\/>$/)
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"')
  })
})

describe('sanitizeSvg — idempotence', () => {
  it('sanitize(sanitize(x)) === sanitize(x)', () => {
    const src = wrap('<script>x</script><g><rect style="fill:red" width="5" height="5" onclick="e"/></g>')
    const once = sanitizeSvg(src).svg
    const twice = sanitizeSvg(once).svg
    expect(twice).toBe(once)
  })
})
