import { describe, expect, it } from 'vitest'

import { carveToHtml, imgFence } from '../src/index.js'

const ext = [imgFence()] // sandbox by default
const extInline = [imgFence({ allowInline: true })] // host permits inline
// A code fence carries no inline attributes (spec §"code fence"): any `{…}`
// goes on the PRECEDING block-attribute line, which lands in `code.attrs`.
const fence = (attrs: string, body: string) =>
  (attrs ? attrs.trim() + '\n' : '') + '```img\n' + body + '\n```'

const dataUri = (out: string) => {
  const m = /src="data:image\/svg\+xml,([^"]*)"/.exec(out)
  expect(m).not.toBeNull()
  return decodeURIComponent(m![1])
}

describe('imgFence — sandbox mode (default)', () => {
  it('renders a clean SVG as a data-URI <img>, not inline', () => {
    const out = carveToHtml(fence('', '<svg viewBox="0 0 1 1"><rect width="1" height="1"/></svg>'), {
      extensions: ext,
    })
    expect(out).toContain('<img')
    expect(out).not.toMatch(/<svg[\s>]/) // not inline
    const decoded = dataUri(out)
    expect(decoded).toContain('<rect width="1" height="1"')
    expect(decoded).toContain('xmlns="http://www.w3.org/2000/svg"')
  })

  it('sanitizes injected script before encoding', () => {
    const out = carveToHtml(fence('', '<svg viewBox="0 0 1 1"><script>alert(1)</script><rect width="1" height="1"/></svg>'), {
      extensions: ext,
    })
    const decoded = dataUri(out)
    expect(decoded).not.toContain('script')
    expect(decoded).toContain('<rect width="1" height="1"')
  })

  it('sets alt from {alt=…} and does not leak the flag', () => {
    const out = carveToHtml(fence(' {alt="a map"}', '<svg viewBox="0 0 1 1"><rect width="1" height="1"/></svg>'), {
      extensions: ext,
    })
    expect(out).toContain('alt="a map"')
    expect(out).not.toContain('alt=""')
  })

  it('falls back to the SVG <title> for alt when {alt=…} is absent', () => {
    const out = carveToHtml(fence('', '<svg viewBox="0 0 1 1"><title>A red square</title><rect width="1" height="1" fill="red"/></svg>'), {
      extensions: ext,
    })
    expect(out).toContain('alt="A red square"')
    expect(out).not.toContain('alt=""')
  })

  it('prefers an explicit {alt=…} over the SVG <title>', () => {
    const out = carveToHtml(fence(' {alt="author alt"}', '<svg viewBox="0 0 1 1"><title>title text</title><rect width="1" height="1"/></svg>'), {
      extensions: ext,
    })
    expect(out).toContain('alt="author alt"')
    expect(out).not.toContain('title text')
  })

  it('emits an empty alt when there is neither {alt=…} nor a <title>', () => {
    const out = carveToHtml(fence('', '<svg viewBox="0 0 1 1"><rect width="1" height="1"/></svg>'), {
      extensions: ext,
    })
    expect(out).toContain('alt=""')
  })

  it('strips src/srcset overrides (no external fetch)', () => {
    const out = carveToHtml(fence(' {srcset="https://attacker.example/x.svg 1x"}', '<svg viewBox="0 0 1 1"><rect width="1" height="1"/></svg>'), {
      extensions: ext,
    })
    expect(out).toContain('src="data:image/svg+xml,')
    expect(out).not.toContain('srcset')
    expect(out).not.toContain('attacker')
    expect(/<img[^>]*>/.exec(out)![0].match(/\bsrc=/g)!.length).toBe(1)
  })

  it('swallows a redundant {sandbox} marker (no leaked attribute)', () => {
    const out = carveToHtml(fence(' {sandbox}', '<svg viewBox="0 0 1 1"><rect width="1" height="1"/></svg>'), {
      extensions: ext,
    })
    expect(out).toContain('src="data:image/svg+xml,')
    expect(out).not.toContain('sandbox')
  })

  it('claims the image alias too', () => {
    const out = carveToHtml('```image\n<svg viewBox="0 0 1 1"><rect width="1" height="1"/></svg>\n```', {
      extensions: ext,
    })
    expect(out).toContain('src="data:image/svg+xml,')
  })
})

describe('imgFence — {inline} is gated by allowInline (security)', () => {
  it('IGNORES {inline} when the host did not opt in — stays sandboxed', () => {
    const out = carveToHtml(fence(' {inline}', '<svg viewBox="0 0 1 1"><rect width="1" height="1"/></svg>'), {
      extensions: ext, // allowInline not set
    })
    expect(out).toContain('src="data:image/svg+xml,') // still sandboxed
    expect(out).not.toMatch(/<svg[\s>]/)
  })

  it('renders inline <svg> only when allowInline AND {inline}', () => {
    const out = carveToHtml(fence(' {inline}', '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="currentColor"/></svg>'), {
      extensions: extInline,
    })
    expect(out).toMatch(/<svg[\s>]/)
    expect(out).toContain('<circle cx="5" cy="5" r="4" fill="currentColor"')
    expect(out).not.toContain('data:image/svg+xml')
  })

  it('with allowInline but no {inline}, a fence still defaults to sandbox', () => {
    const out = carveToHtml(fence('', '<svg viewBox="0 0 1 1"><rect width="1" height="1"/></svg>'), {
      extensions: extInline,
    })
    expect(out).toContain('src="data:image/svg+xml,')
    expect(out).not.toMatch(/<svg[\s>]/)
  })

  it('sanitizes injected script in inline mode too', () => {
    const out = carveToHtml(fence(' {inline}', '<svg viewBox="0 0 1 1"><script>alert(1)</script><rect width="1" height="1"/></svg>'), {
      extensions: extInline,
    })
    expect(out).not.toContain('<script')
    expect(out).not.toContain('alert')
    expect(out).toContain('<rect width="1" height="1"')
  })
})

describe('imgFence — inline attribute merge (allowInline)', () => {
  it('merges fence {#id .cls} onto the root svg', () => {
    const out = carveToHtml(fence(' {inline #logo .icon}', '<svg viewBox="0 0 1 1"><path d="M0 0"/></svg>'), {
      extensions: extInline,
    })
    expect(out).toMatch(/<svg[^>]*\bid="logo"/)
    expect(out).toMatch(/<svg[^>]*\bclass="icon"/)
  })

  it('merges onto a root whose attr value contains a quoted >', () => {
    const out = carveToHtml(fence(' {inline #x}', '<svg aria-label="1&gt;2" viewBox="0 0 1 1"><rect width="1" height="1"/></svg>'), {
      extensions: extInline,
    })
    const svgTag = /<svg[^]*?>/.exec(out)![0]
    expect(svgTag).toContain('id="x"')
    expect(svgTag).toContain('aria-label="1&gt;2"')
    expect(out).toContain('<rect width="1" height="1"')
  })

  it('scrubs a dangerous fence presentation attr merged onto the root', () => {
    const out = carveToHtml(fence(' {inline fill="url(https://attacker.example/p.svg#x)"}', '<svg viewBox="0 0 1 1"><rect width="1" height="1"/></svg>'), {
      extensions: extInline,
    })
    expect(out).not.toContain('attacker')
    expect(out).not.toMatch(/<svg[^>]*fill=/)
    expect(out).toContain('<rect width="1" height="1"')
  })

  it('fence attrs override the root svg attrs without duplicating them', () => {
    const out = carveToHtml(fence(' {inline #outer .fence}', '<svg id="inner" class="orig" viewBox="0 0 1 1"><rect width="1" height="1"/></svg>'), {
      extensions: extInline,
    })
    const svgTag = /<svg[^>]*>/.exec(out)![0]
    expect(svgTag).toContain('id="outer"')
    expect(svgTag).not.toContain('id="inner"')
    expect(svgTag).not.toContain('class="orig"')
    expect(svgTag.match(/\bid=/g)!.length).toBe(1)
    expect(svgTag.match(/\bclass=/g)!.length).toBe(1)
    expect(svgTag).toContain('viewBox="0 0 1 1"')
  })
})

describe('imgFence — fallback + off-by-default', () => {
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
})
