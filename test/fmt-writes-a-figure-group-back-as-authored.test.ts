/*
 * PART 11 §4 canonical writing for the §4c composite figure: the authored
 * form - attrs line, `::: figure`, panels separated by one blank line, the
 * closing fence, and the group caption as an UNESCAPED `^ ` line after it
 * (the writer knows the closer hosts it). A literal `^ …` paragraph after a
 * group without a caption is the one shape that must come back escaped, or it
 * would re-attach as the group caption on the way back.
 */
import { describe, it, expect } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

const F1 =
  '{#fig-x .columns-2}\n::: figure\n{#fig-x-a}\n![one](a.png)\n^ (a) One\n\n{#fig-x-b}\n![two](b.png)\n^ (b) Two\n:::\n^ Figure #: Group caption\n'

describe('fmt writes a figure group back as authored', () => {
  it('reproduces the authored form, unescaped caption included', () => {
    expect(carveToCarve(F1)).toBe(F1)
  })

  it('is idempotent on the canonical form', () => {
    const once = carveToCarve(F1)
    expect(carveToCarve(once)).toBe(once)
  })

  it('renders the same HTML before and after a format pass', () => {
    expect(carveToHtml(carveToCarve(F1))).toBe(carveToHtml(F1))
  })

  it('writes a captionless group with no trailing caret line', () => {
    const src = '::: figure\n![a](x.png)\n^ (a) c\n:::\n'
    expect(carveToCarve(src)).toBe(src)
  })

  it('escapes ONLY the detached caption caret, nothing else', () => {
    // Two blank lines detached it in the source; the writer normalizes to one
    // blank line, so the caret must be escaped or the paragraph would attach
    // as the group caption on re-parse (the F6 shape). ONE structural escape:
    // the panel caption's parens and the paragraph's `#` stay bare
    // (carve-php / carve-rs parity) - the caret used to fall outside the
    // minimal escape class, which failed the redundancy check and escalated
    // the whole document to conservative escaping.
    const src = '::: figure\n![a](x.png)\n^ (a) c\n:::\n\n\n^ Figure #: Detached\n'
    const out = carveToCarve(src)
    expect(out).toBe('::: figure\n![a](x.png)\n^ (a) c\n:::\n\n\\^ Figure #: Detached\n')
    expect(carveToHtml(out)).toBe(carveToHtml(src))
    expect(carveToCarve(out)).toBe(out)
  })

  it('keeps the fence-width discipline inside another container', () => {
    const src = '::: note\n:::: figure\n![a](x.png)\n^ (a) c\n::::\n^ Figure #: G\n:::\n'
    expect(carveToCarve(src)).toBe(src)
    expect(carveToHtml(carveToCarve(src))).toBe(carveToHtml(src))
  })

  it('round-trips a demoted nested figure as the generic container it is', () => {
    const src = '::: figure\n:::: figure\n![a](x.png)\n^ (a) c\n::::\n:::\n^ Figure #: Outer only\n'
    expect(carveToCarve(src)).toBe(src)
    expect(carveToHtml(carveToCarve(src))).toBe(carveToHtml(src))
  })
})
