import { describe, it, expect } from 'vitest'
import { carveToHtml, lintCarve } from '../src/index.js'

/**
 * An implicit heading reference matches the heading index NFC-normalized, and
 * NOT NFKC (PART 9R R1, carve#725).
 *
 * Heading IDS have been NFC-normalized since §25 while this key was not, so a
 * document published `id="Café"` and then declined `[Café][]` against the very
 * heading that produced it - the same alphabet on one side of the resolution and
 * not the other. Both spellings render identically, so the miss had no visible
 * cause; that is what made it survive.
 *
 * NFC is also a WEAKER fold than the case fold R1 already admits: case folding
 * relates codepoints Unicode calls distinct, NFC relates sequences Unicode
 * DEFINES as the same.
 *
 * The NFKC cases are the other half of the claim and are not decoration: a fix
 * that reached for `normalize('NFKC')`, or for the ASCII transliteration map
 * this file's neighbour uses for ids, would resolve them and change WHICH text
 * the author is quoting. Both halves are asserted for every case.
 */

/** `é` written as `e` + COMBINING ACUTE, and precomposed. */
const DECOMPOSED = 'Café'
const PRECOMPOSED = 'Café'

describe('a heading reference folds NFC', () => {
  it('resolves a precomposed reference against a decomposed heading', () => {
    const html = carveToHtml(`# ${DECOMPOSED}\n\nsee [${PRECOMPOSED}][]\n`)
    expect(html).toContain('<a href="#Café">')
    // The id side was already NFC; this is the assertion that the lookup now
    // uses the same alphabet.
    expect(html).toContain('id="Café"')
  })

  it('resolves a decomposed reference against a precomposed heading', () => {
    const html = carveToHtml(`# ${PRECOMPOSED}\n\nsee [${DECOMPOSED}][]\n`)
    expect(html).toContain('<a href="#Café">')
  })

  it('leaves the heading text as the author spelled it', () => {
    // Normalization is for MATCHING. The rendered heading keeps its own bytes -
    // folding the visible text would be a different (and unasked) change.
    const html = carveToHtml(`# ${DECOMPOSED}\n\nsee [${PRECOMPOSED}][]\n`)
    expect(html).toContain(`<h1>${DECOMPOSED}</h1>`)
  })

  it('still resolves the same-spelling cases', () => {
    // The rows that were already unanimous. Kept so a fix cannot trade them
    // away for the cross-spelling ones.
    for (const spelling of [DECOMPOSED, PRECOMPOSED]) {
      const html = carveToHtml(`# ${spelling}\n\nsee [${spelling}][]\n`)
      expect(html, spelling).toContain('<a href="#Café">')
    }
  })

  it('still folds case and collapses whitespace', () => {
    const html = carveToHtml('# Getting  Started\n\nsee [getting started][]\n')
    expect(html).toContain('<a href="#Getting-Started">')
  })
})

describe('a heading reference does not fold NFKC', () => {
  it('does not match a ligature against its ASCII spelling', () => {
    // U+FB01 LATIN SMALL LIGATURE FI. NFKC would make this resolve.
    const html = carveToHtml('# ﬁle\n\nsee [file][]\n')
    expect(html).toContain('[file][]')
    expect(html).not.toContain('<a href="#ﬁle">')
  })

  it('does not match a circled digit against its ASCII spelling', () => {
    // U+2460 CIRCLED DIGIT ONE.
    const html = carveToHtml('# ① one\n\nsee [1 one][]\n')
    expect(html).toContain('[1 one][]')
  })

  it('does not match a full-width form against its ASCII spelling', () => {
    // U+FF41.. FULLWIDTH LATIN SMALL LETTERS - the same compatibility class.
    const html = carveToHtml('# ａｂ\n\nsee [ab][]\n')
    expect(html).toContain('[ab][]')
  })
})

describe('the linter agrees with the renderer', () => {
  it('does not report a cross-spelling reference as unresolved', () => {
    // `lint.ts` carried its own copy of this predicate, so the two could - and
    // did - disagree about what resolves. It imports the one helper now, and
    // this is the assertion that keeps them together.
    const findings = lintCarve(`# ${DECOMPOSED}\n\nsee [${PRECOMPOSED}][]\n`)
    expect(
      findings.filter((f) => /reference|resolve/i.test(f.message)),
      JSON.stringify(findings),
    ).toEqual([])
  })

  it('still reports a reference that genuinely resolves to nothing', () => {
    // The control: the check above must not pass by having stopped reporting.
    const findings = lintCarve('# ﬁle\n\nsee [file][]\n')
    expect(findings.some((f) => /reference|resolve/i.test(f.message))).toBe(true)
  })
})
