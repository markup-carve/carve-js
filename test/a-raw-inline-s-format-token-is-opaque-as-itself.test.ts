import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// The bare-closer scan read `{=html} c= d=}` as a braced highlight and hid the
// closer at `c=`. The main loop builds the code span and the token as one raw
// inline, so the token is opaque only as itself.
describe("a raw inline's format token is opaque as itself", () => {
  it('leaves the closer after the token reachable', () => {
    expect(carveToHtml('=a `b`{=html} c= d=}')).toBe('<p><mark>a b c</mark> d=}</p>')
  })

  it('leaves the closer reachable when a lone brace follows it', () => {
    expect(carveToHtml('=a `b`{=html} c=}')).toBe('<p><mark>a b c</mark>}</p>')
  })

  it('closes on a delimiter directly against the token', () => {
    expect(carveToHtml('=a `b`{=html}=')).toBe('<p><mark>a b</mark></p>')
  })

  it('still closes when nothing follows the run', () => {
    expect(carveToHtml('=a `b`{=html} c=')).toBe('<p><mark>a b c</mark></p>')
  })

  // Since carve-js#1831 a `{=` inside an open highlight is content (E3), so
  // the brace no longer opens anything and the closer is the `=` after `c`.
  it('leaves a token-shaped brace with no code span in front a highlight', () => {
    expect(carveToHtml('=a {=html} c= d=}')).toBe('<p><mark>a {=html} c</mark> d=}</p>')
  })

  it('reads a braced highlight of the open kind as content', () => {
    expect(carveToHtml('=a {=b=} c= d=}')).toBe('<p><mark>a {=b</mark>} c= d=}</p>')
  })

  it('reads a format name that cannot open a token as a highlight', () => {
    expect(carveToHtml('=a `b`{=1x} c= d=}')).toBe('<p><mark>a <code>b</code>{=1x} c</mark> d=}</p>')
  })

  it('reads an unterminated token as a highlight', () => {
    expect(carveToHtml('=a `b`{=html c= d=}')).toBe('<p><mark>a <code>b</code>{=html c</mark> d=}</p>')
  })
})
