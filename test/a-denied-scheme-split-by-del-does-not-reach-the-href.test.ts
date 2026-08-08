import { describe, it, expect } from 'vitest'
import {
  carveToHtml,
  carveToMarkdown,
  carveToAnsi,
  carveToCarve,
  sanitizeSvg,
} from '../src/index.js'
import { blankDeniedDestination } from '../src/deny-listed-destination.js'
import { SCHEME_PROBE_STRIP_RE, DANGEROUS_URL_SCHEMES } from '../src/render-html.js'

/**
 * PART 9 section 25, the denied-scheme defense, on the HTML target.
 *
 * `[x](java<DEL>script:alert(1))` reached an `href` with the raw `7f` byte
 * intact while `[x](javascript:alert(1))` was blanked, in this engine and in
 * carve-rs, where carve-php blanked both (markup-carve/carve-js#915). The
 * mechanism was already right: markup-carve/carve-js#893 established
 * strip-then-probe and markup-carve/carve-js#914 kept it by splitting the broad
 * PROBE class from the narrow EMIT class. What was wrong was the probe class,
 * which stopped at U+001F and so never saw through DEL or the C1 block.
 *
 * This is DEFENSE IN DEPTH, not a demonstrated execution. Whether
 * `java<DEL>script:` runs depends on whether the consumer's URL parser discards
 * U+007F before it reads the scheme; some do and some do not. The engine's job
 * is not to depend on the answer.
 *
 * EVERY ASSERTION IS ON BYTES OR CODE POINTS, never on a rendered string. DEL
 * is invisible in terminal output and `java<DEL>script:` reads as
 * `javascript:` in any log - which is exactly how the first report of this
 * defect concluded the character had been normalized away when it had not. A
 * test that compared rendered strings would pass against the broken engine.
 */

const C = (cp: number) => String.fromCodePoint(cp)
const bytes = (s: string) => Buffer.from(s, 'utf8').toString('hex')
const attr = (html: string, name: string) =>
  new RegExp(`${name}="([^"]*)"`).exec(html)?.[1] ?? null

/** DEL, and the whole C1 block. Outside PART 9 section 29 by T5, and each one a
 *  character some URL consumer discards before it reads a scheme. */
const PROBE_ONLY_CLASS = [0x7f, ...Array.from({ length: 32 }, (_, i) => 0x80 + i)]

describe('a denied scheme split by DEL does not reach the href', () => {
  it('CONTROL: the plain spelling was always blanked, and still is', () => {
    // This row is a CONTROL. The denylist itself was never broken - only the
    // split form got past - so no mutation of this defect may move this row.
    // If it ever goes red, the failure is in the denylist, not in the probe
    // class, and this file is looking at the wrong thing.
    expect(attr(carveToHtml('[x](javascript:alert(1))\n'), 'href')).toBe('')
    expect(attr(carveToHtml('![a](javascript:alert(1))\n'), 'src')).toBe('')
  })

  it('CONTROL: a NUL split is inert because the reader replaced it', () => {
    // Also a CONTROL, and for a different reason: U+0000 never reaches the
    // probe at all. The reader turns it into U+FFFD, and U+FFFD is not a
    // character a URL consumer discards, so the destination stays visibly
    // broken rather than resolving. Widening the probe class does not touch
    // this path, and this row says so.
    const href = attr(carveToHtml(`[x](java${C(0x00)}script:alert(1))\n`), 'href')
    expect(href).not.toBeNull()
    expect(bytes(href as string)).toBe(bytes(`java${C(0xfffd)}script:alert(1)`))
    expect(bytes(href as string)).not.toContain('7f')
  })

  it('the DEL split is blanked on href and on src alike', () => {
    // THE ROW THAT PROVES THE FIX. Asserted on the hex of the attribute value,
    // because `java<DEL>script:alert(1)` and `javascript:alert(1)` are
    // indistinguishable when printed.
    const split = `java${C(0x7f)}script:alert(1)`
    expect(bytes(split)).toBe('6a6176617f7363726970743a616c657274283129')

    expect(attr(carveToHtml(`[x](${split})\n`), 'href')).toBe('')
    // The image spelling reproduces the defect identically because it reaches
    // the SAME `sanitizeUrl`. It needed no separate fix, and this row is what
    // keeps that true if the two paths ever diverge.
    expect(attr(carveToHtml(`![a](${split})\n`), 'src')).toBe('')
  })

  it('a leading DEL does not hide the scheme either', () => {
    const href = attr(carveToHtml(`[x](${C(0x7f)}javascript:alert(1))\n`), 'href')
    expect(href).toBe('')
  })

  it('every character of the probe-only class is seen through, on both attributes', () => {
    for (const cp of PROBE_ONLY_CLASS) {
      const split = `java${C(cp)}script:alert(1)`
      const href = attr(carveToHtml(`[x](${split})\n`), 'href')
      const src = attr(carveToHtml(`![a](${split})\n`), 'src')
      // U+0085 terminates the destination for the reader, so the construct is
      // not a link at all and there is no attribute to judge. Everything that
      // DOES parse as a destination must be blanked.
      if (href !== null) expect(href, `href U+${cp.toString(16)}`).toBe('')
      if (src !== null) expect(src, `src U+${cp.toString(16)}`).toBe('')
      expect(href === null || href === '', `U+${cp.toString(16)}`).toBe(true)
    }
  })

  it('it is the whole denylist, not the script schemes', () => {
    // The OS protocol-handler class (CVE-2026-20841) splits the same way, and a
    // fix that only reached `javascript` would be half a fix twice over.
    for (const scheme of DANGEROUS_URL_SCHEMES) {
      const split = `${scheme.slice(0, 2)}${C(0x7f)}${scheme.slice(2)}:payload`
      expect(attr(carveToHtml(`[x](${split})\n`), 'href'), scheme).toBe('')
    }
  })

  it('a caller-supplied allowlist is not bypassed by the split either', () => {
    const split = `java${C(0x7f)}script:alert(1)`
    const out = carveToHtml(`[x](${split})\n`, { allowedUrlSchemes: ['https'] })
    expect(attr(out, 'href')).toBe('')
    // And a permitted scheme still passes when it is split, because the probe
    // reads the stripped form for BOTH answers. Fail-closed, not fail-blank.
    const ok = carveToHtml(`[x](htt${C(0x7f)}ps://example.com/)\n`, {
      allowedUrlSchemes: ['https'],
    })
    expect(bytes(attr(ok, 'href') as string)).toBe(bytes(`htt${C(0x7f)}ps://example.com/`))
  })

  it('the original destination is what is emitted when it is allowed', () => {
    // STRIP-THEN-PROBE, not strip-then-emit. The stripped form is a judgement
    // aid and never becomes output: a benign destination keeps its bytes.
    const url = `/a${C(0x7f)}b?q=1`
    const href = attr(carveToHtml(`[x](${url})\n`), 'href')
    expect(bytes(href as string)).toBe(bytes(url))
  })

  it('the non-HTML targets refuse it too, through the shared probe', () => {
    const split = `java${C(0x7f)}script:alert(1)`
    expect(blankDeniedDestination(split)).toBe('')
    expect(bytes(carveToMarkdown(`[x](${split})\n`))).not.toContain('7f')
    expect(carveToMarkdown(`[x](${split})\n`)).not.toContain('script:alert')
    expect(carveToAnsi(`[x](${split})\n`)).not.toContain('script:alert')
  })

  it('the probe class is the mutation target, and it is wider than section 29', () => {
    // THE MUTATION. Narrowing `SCHEME_PROBE_STRIP_RE` back to the section 29
    // emit class - dropping the `\u007f-\u009f` arm - must fail here and in the
    // rows above, while both CONTROL rows stay green.
    for (const cp of PROBE_ONLY_CLASS) {
      const split = `java${C(cp)}script:alert(1)`
      expect(split.replace(SCHEME_PROBE_STRIP_RE, ''), `U+${cp.toString(16)}`).toBe(
        'javascript:alert(1)',
      )
    }
    // And the class does not overreach: an ordinary character is not stripped,
    // so a scheme cannot be manufactured out of one that was never written.
    expect('java-script:alert(1)'.replace(SCHEME_PROBE_STRIP_RE, '')).toBe(
      'java-script:alert(1)',
    )
    expect(blankDeniedDestination('java-script:alert(1)')).toBe('java-script:alert(1)')
  })

  it('the SVG sanitizer carried the second spelling of the same probe', () => {
    // `svg-sanitize.ts` keeps its own copy of the denylist and its own strip,
    // and the copy had the same gap. Both opt-in doors are covered.
    for (const cp of [0x7f, 0x80, 0x9b, 0x9f]) {
      const split = `java${C(cp)}script:alert(1)`
      const link = sanitizeSvg(
        `<svg xmlns="http://www.w3.org/2000/svg"><a href="${split}"><text>x</text></a></svg>`,
        { allowLinks: true },
      )
      expect(bytes(link.svg), `svg a href U+${cp.toString(16)}`).not.toContain('7363726970743a')
      const image = sanitizeSvg(
        `<svg xmlns="http://www.w3.org/2000/svg"><image href="${split}"/></svg>`,
        { allowExternalImages: true },
      )
      expect(bytes(image.svg), `svg image href U+${cp.toString(16)}`).not.toContain(
        '7363726970743a',
      )
      // `refAttrUnsafe` rejects EVERY absolute scheme, and a split defeated the
      // match outright rather than merely dodging the denylist.
      const ref = sanitizeSvg(
        `<svg xmlns="http://www.w3.org/2000/svg"><rect fill="${split}"/></svg>`,
      )
      expect(bytes(ref.svg), `svg fill U+${cp.toString(16)}`).not.toContain('7363726970743a')
    }
  })

  it('DISMISSED SITE: the formatter probe is downstream of this one', () => {
    // `render-carve.ts` carries a THIRD scheme probe, in `escapeDestination`,
    // and its class stops at U+0020 too. It is not a second defect and was not
    // widened, because it answers a different question: it decides whether to
    // percent-escape a destination so that REPARSING the formatted source
    // cannot resurrect something the renderer refused. It only ever skipped
    // LEADING characters, so it never handled an interior split for any
    // character - U+0001 included, which the fixed probe catches and this one
    // does not. Whatever it lets through is judged again on the way out, which
    // is what this row measures, and if that ever stops being true this row is
    // what says so.
    for (const cp of [0x01, 0x7f, 0x9b]) {
      const formatted = carveToCarve(`[x](java${C(cp)}script:alert(1))\n`)
      expect(attr(carveToHtml(formatted), 'href'), `U+${cp.toString(16)}`).toBe('')
    }
  })

  it('CONTROL: the SVG sanitizer still allows a benign scheme', () => {
    const ok = sanitizeSvg(
      '<svg xmlns="http://www.w3.org/2000/svg"><a href="https://example.com/"><text>x</text></a></svg>',
      { allowLinks: true },
    )
    expect(ok.svg).toContain('https://example.com/')
  })
})
