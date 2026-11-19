import { describe, expect, it } from 'vitest'
import { sanitizeSvg } from '../../extensions/blocks/svg-sanitize.ts'

describe('additional 0.1 SVG sanitizer regressions', () => {
  it.each([0x7f, 0x80, 0x9b, 0x9f])('rejects a scheme split by U+%s in every SVG reference', (codePoint) => {
    const split = `java${String.fromCodePoint(codePoint)}script:alert(1)`
    const svg = `<svg><a href="${split}"><text>x</text></a><image href="${split}"/><rect fill="${split}"/></svg>`
    const output = sanitizeSvg(svg, { allowLinks: true, allowExternalImages: true }).svg
    expect(output).not.toContain('script:')
  })

  it.each(['red;https://evil.example/y', 'red&nosuchentity;https://evil.example/y',
    'red&constructor;https://evil.example/y'])('rejects an unsafe reference following %s', (fill) => {
    expect(sanitizeSvg(`<svg><rect fill="${fill}"/></svg>`).svg).not.toContain('evil.example')
  })

  it('keeps a benign link when links are enabled', () => {
    expect(sanitizeSvg('<svg><a href="https://example.com/"><text>x</text></a></svg>', { allowLinks: true }).svg)
      .toContain('https://example.com/')
  })
})
