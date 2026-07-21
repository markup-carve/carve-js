import { describe, expect, it } from 'vitest'

import { carveToHtml, imgFence } from '../src/index.js'

const ext = [imgFence()]
// A code fence carries no inline attributes (spec §"code fence"): any `{…}`
// goes on the PRECEDING block-attribute line, which lands in `code.attrs`.
const fence = (attrs: string, body: string) =>
  (attrs ? attrs.trim() + '\n' : '') + '```img\n' + body + '\n```'

describe('imgFence — inline mode (default)', () => {
  it('renders a clean SVG body inline as <svg>', () => {
    const out = carveToHtml(fence('', '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="currentColor"/></svg>'), {
      extensions: ext,
    })
    expect(out).toContain('<svg')
    expect(out).toContain('<circle cx="5" cy="5" r="4" fill="currentColor"')
    expect(out).not.toContain('<pre')
  })

  it('sanitizes injected script out of the rendered SVG', () => {
    const out = carveToHtml(fence('', '<svg viewBox="0 0 1 1"><script>alert(1)</script><rect width="1" height="1"/></svg>'), {
      extensions: ext,
    })
    expect(out).not.toContain('script')
    expect(out).not.toContain('alert')
    expect(out).toContain('<rect width="1" height="1"')
  })

  it('merges fence {#id .cls} onto the root svg', () => {
    const out = carveToHtml(fence(' {#logo .icon}', '<svg viewBox="0 0 1 1"><path d="M0 0"/></svg>'), {
      extensions: ext,
    })
    expect(out).toMatch(/<svg[^>]*\bid="logo"/)
    expect(out).toMatch(/<svg[^>]*\bclass="icon"/)
  })

  it('merges onto a root whose attr value contains a quoted >', () => {
    const out = carveToHtml(fence(' {#x}', '<svg aria-label="1&gt;2" viewBox="0 0 1 1"><rect width="1" height="1"/></svg>'), {
      extensions: ext,
    })
    const svgTag = /<svg[^]*?>/.exec(out)![0]
    expect(svgTag).toContain('id="x"')
    expect(svgTag).toContain('aria-label="1&gt;2"')
    expect(out).toContain('<rect width="1" height="1"')
  })

  it('scrubs a dangerous fence presentation attr merged onto the root', () => {
    const out = carveToHtml(fence(' {fill="url(https://attacker.example/p.svg#x)"}', '<svg viewBox="0 0 1 1"><rect width="1" height="1"/></svg>'), {
      extensions: ext,
    })
    expect(out).not.toContain('attacker')
    expect(out).not.toMatch(/<svg[^>]*fill=/)
    expect(out).toContain('<rect width="1" height="1"')
  })

  it('fence attrs override the root svg attrs without duplicating them', () => {
    const out = carveToHtml(fence(' {#outer .fence}', '<svg id="inner" class="orig" viewBox="0 0 1 1"><rect width="1" height="1"/></svg>'), {
      extensions: ext,
    })
    const svgTag = /<svg[^>]*>/.exec(out)![0]
    // fence wins, root's own id/class are gone, no duplicate attribute
    expect(svgTag).toContain('id="outer"')
    expect(svgTag).not.toContain('id="inner"')
    expect(svgTag).not.toContain('class="orig"')
    expect(svgTag.match(/\bid=/g)!.length).toBe(1)
    expect(svgTag.match(/\bclass=/g)!.length).toBe(1)
    // a non-conflicting root attr survives
    expect(svgTag).toContain('viewBox="0 0 1 1"')
  })
})

describe('imgFence — sandbox mode', () => {
  it('{sandbox} emits a data-URI <img> that decodes to the sanitized svg', () => {
    const out = carveToHtml(fence(' {sandbox}', '<svg viewBox="0 0 1 1"><rect width="1" height="1"/></svg>'), {
      extensions: ext,
    })
    expect(out).toContain('<img')
    expect(out).toContain('src="data:image/svg+xml,')
    const m = /src="data:image\/svg\+xml,([^"]*)"/.exec(out)
    expect(m).not.toBeNull()
    const decoded = decodeURIComponent(m![1])
    expect(decoded).toContain('<rect width="1" height="1"')
    expect(decoded).toContain('xmlns="http://www.w3.org/2000/svg"')
  })

  it('honors mixed-case {Sandbox}/{ALT} consumed flags', () => {
    const out = carveToHtml(fence(' {Sandbox ALT="a logo"}', '<svg viewBox="0 0 1 1"><rect width="1" height="1"/></svg>'), {
      extensions: ext,
    })
    expect(out).toContain('<img')
    expect(out).toContain('src="data:image/svg+xml,')
    expect(out).toContain('alt="a logo"')
  })

  it('strips src/srcset overrides in sandbox mode (no external fetch)', () => {
    const out = carveToHtml(fence(' {sandbox srcset="https://attacker.example/x.svg 1x"}', '<svg viewBox="0 0 1 1"><rect width="1" height="1"/></svg>'), {
      extensions: ext,
    })
    expect(out).toContain('src="data:image/svg+xml,')
    expect(out).not.toContain('srcset')
    expect(out).not.toContain('attacker')
    // exactly one src (the data URI)
    expect(/<img[^>]*>/.exec(out)![0].match(/\bsrc=/g)!.length).toBe(1)
  })

  it('does not leak the sandbox / alt flags as attributes', () => {
    const out = carveToHtml(fence(' {sandbox alt="a map"}', '<svg viewBox="0 0 1 1"><rect width="1" height="1"/></svg>'), {
      extensions: ext,
    })
    expect(out).toContain('alt="a map"')
    expect(out).not.toContain('sandbox=')
  })
})

describe('imgFence — fallback + opt-in', () => {
  it('non-svg body degrades to an escaped code block, never raw', () => {
    const out = carveToHtml(fence('', 'not an svg <b>x</b>'), { extensions: ext })
    expect(out).toContain('<pre')
    expect(out).toContain('&lt;b&gt;')
    expect(out).not.toContain('<b>x</b>')
  })

  it('is off unless registered — plain img fence stays a code block', () => {
    const out = carveToHtml(fence('', '<svg><rect/></svg>'))
    expect(out).toContain('<pre')
    expect(out).toContain('<code')
  })

  it('claims the image alias too', () => {
    const out = carveToHtml('```image\n<svg viewBox="0 0 1 1"><rect width="1" height="1"/></svg>\n```', {
      extensions: ext,
    })
    expect(out).toContain('<svg')
    expect(out).toContain('<rect width="1" height="1"')
  })
})
