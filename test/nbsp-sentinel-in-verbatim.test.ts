import { describe, it, expect } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

/**
 * Inside verbatim content, the no-break-space sentinel is written as the
 * CHARACTER, not as `\ `.
 *
 * `normalize()` rewrites every U+E000 to `\ `, which is right outside verbatim
 * content and wrong inside it: escapes do not resolve in a code block or a code
 * span, so `\ ` there is a literal backslash followed by a space. The round trip
 * broke - `<pre><code>a\n&nbsp;\nb\n</code></pre>` came back as
 * `<pre><code>a\n\ \nb\n</code></pre>` (carve-js#688).
 *
 * The fix carries an authored U+E000 through normalization under its own
 * per-render sentinel, so the document-wide rewrite cannot see it, and
 * `restoreVerbatim` puts the character back. That needed a FOURTH verbatim
 * sentinel; `pickSentinels` now scans for a free quad rather than a trio.
 *
 * WIDER THAN THE REPORT. The issue showed the sentinel alone on a line inside a
 * fence. Measured, it also broke inline within a fenced line, in a tilde fence, in
 * a raw block, in a block comment, and in an inline CODE SPAN - the last one
 * through a different path (`renderCode`, not `protectVerbatim`), so it needed its
 * own line. carve-rs is correct in all of them and every assertion below was
 * checked against it byte-for-byte.
 *
 * carve-php has the same defect (carve-php#829).
 */

const NBSP = ''

/** The property: formatting must not change what the document says (PART 11 §1). */
const roundTrips = (src: string) => carveToHtml(carveToCarve(src)) === carveToHtml(src)

describe('an authored nbsp sentinel inside verbatim content', () => {
  it('survives a fenced code block, alone on its line', () => {
    const src = `\`\`\`\na\n${NBSP}\nb\n\`\`\`\n`
    expect(carveToCarve(src)).toBe(src)
    expect(roundTrips(src)).toBe(true)
  })

  it('survives inline within a fenced line', () => {
    // Not in the report - the sentinel mid-line inside the fence.
    const src = `\`\`\`\na${NBSP}z\n\`\`\`\n`
    expect(carveToCarve(src)).toContain(NBSP)
    expect(roundTrips(src)).toBe(true)
  })

  it('survives a raw block and a block comment', () => {
    for (const src of [
      `\`\`\`=html\n<b>a${NBSP}z</b>\n\`\`\`\n`,
      `%%%\na${NBSP}z\n%%%\n`,
    ]) {
      expect(carveToCarve(src), src).toContain(NBSP)
      expect(roundTrips(src), src).toBe(true)
    }
  })

  it('survives an inline CODE SPAN', () => {
    // A different path from the block cases: `renderCode` emits its content
    // verbatim, so the document-wide rewrite reached it there too.
    const src = `a \`x${NBSP}y\` b\n`
    expect(carveToCarve(src)).toBe(src)
    expect(roundTrips(src)).toBe(true)
  })

  it('survives a literal inline and a raw inline', () => {
    // Both go through renderCode, so both were affected.
    for (const src of [`a !\`x${NBSP}y\` b\n`, `a \`x${NBSP}y\`{=html} b\n`]) {
      expect(carveToCarve(src), src).toContain(NBSP)
      expect(roundTrips(src), src).toBe(true)
    }
  })

  it('survives a code span whose whole content is the sentinel', () => {
    // The all-space padding rule in renderCode is the neighbouring logic; this
    // pins that carrying the sentinel does not trip it into padding.
    const src = `a \`${NBSP}\` b\n`
    expect(carveToCarve(src)).toBe(src)
    expect(roundTrips(src)).toBe(true)
  })

  it('is still written as an ESCAPE outside verbatim content', () => {
    // The boundary. Outside verbatim `\\ ` is correct and must not change - the
    // sentinel means the author wrote an escaped space, and writing U+00A0 or a
    // raw sentinel there would lose that distinction (carve#369).
    expect(carveToCarve(`a${NBSP}b\n`)).toBe('a\\ b\n')
    expect(roundTrips(`a${NBSP}b\n`)).toBe(true)
  })

  it('leaves a source-written escaped space in a code block alone', () => {
    // The control that shows why `\\ ` is wrong inside a fence: a backslash
    // written in the SOURCE of a code block stays a backslash, in all three
    // engines. If `\\ ` were the way to spell an nbsp here, these two documents
    // would be indistinguishable.
    const src = '```\na\n\\ \nb\n```\n'
    expect(carveToHtml(src)).toContain('\\')
    expect(roundTrips(src)).toBe(true)
  })
})
