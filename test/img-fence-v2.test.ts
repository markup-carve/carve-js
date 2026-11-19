import { describe, expect, it } from 'vitest'
import { parse, render, renderWithDiagnostics } from '../public/index.ts'
import { imgFence, imgFenceExtensions, imgFenceRenderers, sanitizeSvg } from '../public/extensions.ts'

const fence = (svg: string, language = 'img', attrs = '') => `${attrs === '' ? '' : `${attrs}\n`}${'```'}${language}\n${svg}\n${'```'}\n`
const decoded = (html: string) => decodeURIComponent(/src="data:image\/svg\+xml,([^"]*)"/.exec(html)?.[1] ?? '')

describe('public imgFence extension', () => {
  it('implements C2-X-059 safe SVG output and both catalog language words', () => {
    const expected = '<img src="data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%2F%3E" alt="">'
    for (const language of ['img', 'image']) {
      const source = fence('<svg/>', language)
      const registration = imgFence()
      expect(render(source, registration)).toBe(expected)
      expect(render(source, { extensions: imgFenceExtensions, renderers: imgFenceRenderers })).toBe(expected)
      expect(parse(source, { extensions: registration.extensions }).children[0]).toMatchObject({ name: `carve.imgFence.${language}` })
    }
  })

  it('implements C2-X-059 failed sanitization as an escaped code block', () => {
    const source = fence('<script>alert(1)</script>')
    expect(render(source, imgFence())).toBe('<pre><code class="language-img">&lt;script&gt;alert(1)&lt;/script&gt;\n</code></pre>')
    expect(renderWithDiagnostics(source, imgFence()).diagnostics.map((entry) => entry.code))
      .toContain('extension-renderer-failed')
  })

  it('implements C2-X-059 and C2-X-060 by removing active content before encoding', () => {
    const source = fence('<svg onload="alert(1)"><script>bad</script><rect fill="url(https://evil.test/x)"/></svg>')
    expect(render(source, imgFence())).toBe('<img src="data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Crect%2F%3E%3C%2Fsvg%3E" alt="">')
    expect(render('![x](data:image/svg+xml,%3Csvg%2F%3E)\n')).toBe('<img src="" alt="x">')
  })

  it('keeps the claimed attributes on the fallback wrapper only', () => {
    const source = fence('<svg></svg>', 'img', '{#pic .x}')
    const result = renderWithDiagnostics(source, { extensions: imgFenceExtensions })
    expect(result.html).toBe('<div id="pic" class="x">\n  <pre><code class="language-img">&lt;svg&gt;&lt;/svg&gt;\n</code></pre>\n</div>')
    expect(result.diagnostics.map((entry) => entry.code)).toContain('extension-fallback-rendered')
    expect(result.diagnostics.map((entry) => entry.code)).not.toContain('duplicate-id')
  })

  it.each([
    ['script', '<script>alert(1)</script>'],
    ['event handler', '<circle onclick="alert(1)" r="4"/>'],
    ['foreignObject', '<foreignObject><body>bad</body></foreignObject>'],
    ['javascript href', '<a href="javascript:alert(1)"><circle r="4"/></a>'],
    ['javascript xlink:href', '<use xlink:href="javascript:alert(1)"/>'],
    ['external reference', '<use href="https://evil.test/x.svg#id"/>'],
    ['entity trick', '<a href="jav&#x61;script:alert(1)"><circle r="4"/></a>'],
  ])('removes %s from the rendered SVG', (_name, attack) => {
    const html = render(fence(`<svg>${attack}<rect width="1"/></svg>`), imgFence())
    const svg = decoded(html)
    expect(svg).toContain('<rect width="1"/>')
    expect(svg).not.toMatch(/<script|on[a-z]+=|foreignObject|javascript:|evil\.test|jav&#x61;script:/i)
  })

  it('keeps SVG data URLs confined to the trusted sink', () => {
    const html = render(fence('<svg><rect width="1"/></svg>', 'img', '{src="https://evil.test/x.svg" href="javascript:alert(1)"}'), imgFence())
    expect(html).toContain('src="data:image/svg+xml,')
    expect(html).not.toContain('evil.test')
    expect(html).not.toContain('javascript:')
    expect(sanitizeSvg('<svg><script>bad</script></svg>').svg).not.toContain('<script>')
  })

  it('falls back when percent encoding would pass the existing 8 MiB payload bound', () => {
    const result = renderWithDiagnostics(fence(`<svg><text>${'é'.repeat(1_400_000)}</text></svg>`), imgFence())
    expect(result.html).toMatch(/^<pre><code class="language-img">/)
    expect(result.diagnostics.map((entry) => entry.code)).toContain('extension-renderer-failed')
  })
})
