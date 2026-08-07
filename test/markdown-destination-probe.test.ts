import { describe, it, expect } from 'vitest'
import { carveToMarkdown, carveToAnsi } from '../src/index.js'

/**
 * The Markdown writer probes the destination it will actually emit.
 *
 * It normalizes a destination on the way out (it strips control characters, and
 * its consumer decodes character references), so probing the authored form and
 * normalizing afterwards let the writer manufacture a live `javascript:` URL
 * out of one the probe had already dismissed (markup-carve/carve-js#893).
 */
describe('Markdown destination denylist', () => {
  /**
   * U+007F and the C1 range are dropped by the writer's own strip, so the probe
   * has to see them gone. Built from an escape, never pasted, and asserted
   * present before use.
   */
  const smuggled = (codePoint: number) => {
    const hidden = String.fromCodePoint(codePoint)
    const source = `[t](java${hidden}script:alert1)\n`
    expect(source.codePointAt(8), 'the probe character was lost before the test could use it').toBe(
      codePoint,
    )

    return source
  }

  for (const codePoint of [0x7f, 0x80, 0x9f]) {
    const name = `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`

    it(`${name} does not smuggle a denied scheme into Markdown`, () => {
      const out = carveToMarkdown(smuggled(codePoint))
      expect(out).not.toContain('javascript:')
      expect(out).toContain('[t]()')
    })

    it(`${name}: the ANSI target still refuses it, as it always did`, () => {
      // The ANSI target already stripped before it probed, which is why the fix
      // is a reordering rather than a new decision. Pinned so a later change
      // cannot quietly take the reference behavior away.
      const out = carveToAnsi(smuggled(codePoint))
      expect(out).not.toContain('javascript:')
      expect(out).toContain('()')
    })
  }

  for (const source of [
    '[t](&#106;avascript:alert1)\n',
    '[t](&#x6A;avascript:alert1)\n',
    '[t](javascript&colon;alert1)\n',
    '[t](javascript&#58;alert1)\n',
    '![t](&#106;avascript:alert1)\n',
  ]) {
    it(`a character reference does not smuggle a scheme: ${JSON.stringify(source.trim())}`, () => {
      // A consumer decodes references inside a destination, so what it decodes
      // to has to be what was probed. The emitted ampersand is escaped, which
      // decodes back to the authored bytes rather than to a scheme.
      const out = carveToMarkdown(source)
      expect(out).not.toMatch(/\(&#/)
      expect(out).not.toContain('&colon;')
      expect(out).not.toContain('&#58;')
      expect(out).toContain('&amp;')
    })
  }

  it('CONTROL: an ordinary destination is emitted byte for byte', () => {
    // An ampersand that opens nothing is not a character reference, and a query
    // string must survive intact - percent-encoding it was the tempting fix and
    // it is the wrong one.
    const out = carveToMarkdown('[a](http://x/?a=1&b=2)\n\n[c](mailto:x@y.z)\n\n![i](p.png "t")\n')
    expect(out).toContain('[a](http://x/?a=1&b=2)')
    expect(out).toContain('[c](mailto:x@y.z)')
    expect(out).toContain('![i](p.png "t")')
  })

  it('CONTROL: the denylist still decides the plain cases', () => {
    expect(carveToMarkdown('[t](javascript:alert1)\n')).toContain('[t]()')
    expect(carveToMarkdown('[t](vbscript:x)\n')).toContain('[t]()')
    expect(carveToMarkdown('[t](https://example.org/)\n')).toContain('(https://example.org/)')
  })
})
