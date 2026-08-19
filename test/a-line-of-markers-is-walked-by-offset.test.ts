import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'
import { expectBuiltInputScansLinearly, perfIt } from './helpers/scaling.js'

/**
 * PART 1 S4's question - does the block on a marker line leave an open
 * paragraph? - is answered by stripping the container prefix off the line and
 * classifying what is left. That strip used to re-slice the remainder once per
 * marker, and each of the regexes it consults ends on `(...)$`, so every step
 * read to the END of the line to answer a question about its HEAD.
 *
 * A single line of N markers therefore cost O(N * line length):
 * `'- '.repeat(8000)` took ~7 s, of which ~6.2 s was one regex, and the growth
 * held at ~3.9x per doubling across four doublings (carve-js#1190). The input is
 * 8 KB, so §25 reads that as a denial of service rather than a slow parse - and
 * the shapes below are all of the marker spellings, not just the bullet the
 * ticket measured.
 *
 * The strip now walks by OFFSET, asking the same regexes against a window at
 * that offset. Two halves, and the first is what makes the second trustworthy:
 * the answers are unchanged for every prefix the language admits, and the cost
 * per byte no longer grows with the line.
 */

describe('a container prefix is walked by offset', () => {
  /**
   * THE ANSWER IS THE OBSERVABLE, not the walk. Each pair writes the same
   * container prefix twice: once over a block that leaves no open paragraph, so
   * the flush-left line below reaches no container, and once over prose, where
   * it folds in. A walk that lost a marker reports the whole line as the
   * remaining block, which classifies as prose - so the folding half of each
   * pair is what a broken walk still passes, and the heading half is what it
   * fails.
   */
  const ends: Record<string, string> = {
    'a bullet': '- ',
    'a bullet with a wide space run': '-' + ' '.repeat(40),
    'a wide indent': ' '.repeat(40) + '- ',
    'a star': '* ',
    'an ordered marker': '1. ',
    'a paren-delimited marker': '1) ',
    'a bare-dot marker': '. ',
    'a roman marker': 'iv. ',
    'a letter marker': 'A. ',
    'a task box': '- [x] ',
    'an abutting attribute block': '-{#a} ',
    // The payload is unbounded, so it is the one part of a marker that a fixed
    // window cannot hold. 40 characters is past the window the walk starts at.
    'a wide abutting attribute block': `-{#${'a'.repeat(40)}} `,
    'a quote inside an item': '- > ',
    'two bullets': '- - ',
    'a quote, an item and a quote': '> - > ',
    'four alternating markers': '- > - > ',
  }

  /**
   * WRITTEN UNDER A LEADING MARKER, because the caller strips the item's OWN
   * marker before it asks. `- -{#...} # H` is what puts the attributed marker
   * in front of the walk; `-{#...} # H` hands it the bare heading and holds the
   * walk to nothing. Both leads are run: the bare one covers the classifier
   * below the walk, the nested one covers the walk itself.
   */
  const leads: Record<string, string> = { 'at the top': '', 'under a bullet': '- ' }

  for (const [label, prefix] of Object.entries(ends)) {
    for (const [where, lead] of Object.entries(leads)) {
      it(`ends the container on a heading behind ${label}, ${where}`, () => {
        const html = carveToHtml(`${lead}${prefix}# H\ntail\n`)

        expect(html, `${JSON.stringify(lead + prefix)}: the heading is not in the container`).toMatch(
          /<h1[^>]*>H<\/h1>/,
        )
        expect(html, `${JSON.stringify(lead + prefix)}: tail did not leave the container`).toMatch(
          /<p>tail<\/p>/,
        )
      })

      it(`keeps the container open on prose behind ${label}, ${where}`, () => {
        const html = carveToHtml(`${lead}${prefix}a\ntail\n`)

        expect(
          html,
          `${JSON.stringify(lead + prefix)}: tail left a container that holds a paragraph`,
        ).not.toMatch(/<p>tail<\/p>/)
        expect(html).toContain('tail')
      })
    }
  }

  /**
   * EVERY PARAGRAPH-LESS BLOCK, behind a prefix deep enough that the walk has
   * to reach it. The classifier below the walk is unchanged, so this is the
   * walk's own claim: it hands the classifier the same remainder it used to.
   */
  const blocks: Record<string, string> = {
    'a heading': '# H',
    'a thematic break': '---',
    'a table row': '| a |',
    'a comment': '%% c',
    'a link reference definition': '[r]: /u',
    'a footnote definition': '[^f]: n',
    'an attribute block': '{#id}',
  }

  for (const [label, block] of Object.entries(blocks)) {
    it(`reaches ${label} behind four markers`, () => {
      expect(carveToHtml(`- > - > ${block}\ntail\n`)).toMatch(/<p>tail<\/p>/)
    })
  }

  /**
   * THE INTENDED SURVIVORS. A container whose bottom block DOES hold an open
   * paragraph keeps the line below it, however deep the prefix is - so these
   * stay green with the walk reverted, which is what makes the assertions above
   * evidence about the walk rather than a restatement of it.
   */
  it('folds the line below a quote that ends on prose', () => {
    expect(carveToHtml('- > q\ntail\n')).not.toMatch(/<p>tail<\/p>/)
  })

  it('folds the line below a colon fence written on a marker', () => {
    // Not in the paragraph-less list, deliberately: the fence holds a container
    // the line below folds INTO rather than out of.
    expect(carveToHtml('- ::: note\ntail\n:::\n')).not.toMatch(/^<p>tail<\/p>/m)
  })

  it('declines a brace that is not a valid attribute payload', () => {
    // `-{"a} # H` is not a marker at all, so the line is ordinary text and the
    // walk must strip nothing - the heading is prose, not a heading.
    expect(carveToHtml('-{"a} # H\ntail\n')).not.toMatch(/<h1/)
  })

  perfIt('parses a line of bullets in linear time', () => {
    // 1,000 -> 4,000 markers rather than the helper's default: pre-fix this
    // reads ~3.5x per byte and the guard trips at 2.0, while a larger sample
    // would spend the whole budget proving a point 4,000 already makes.
    expectBuiltInputScansLinearly(
      (input) => void carveToHtml(input),
      (n) => '- '.repeat(n) + 'x\n',
      { label: 'a line of bullets', smallRepeats: 1000 },
    )
  })

  perfIt('parses a line of ordered markers in linear time', () => {
    expectBuiltInputScansLinearly(
      (input) => void carveToHtml(input),
      (n) => '1. '.repeat(n) + 'x\n',
      { label: 'a line of ordered markers', smallRepeats: 1000 },
    )
  })

  perfIt('parses a line of task markers in linear time', () => {
    expectBuiltInputScansLinearly(
      (input) => void carveToHtml(input),
      (n) => '- [ ] '.repeat(n) + 'x\n',
      { label: 'a line of task markers', smallRepeats: 1000 },
    )
  })

  perfIt('parses a line of attributed markers in linear time', () => {
    expectBuiltInputScansLinearly(
      (input) => void carveToHtml(input),
      (n) => '-{#a} '.repeat(n) + 'x\n',
      { label: 'a line of attributed markers', smallRepeats: 1000 },
    )
  })

  perfIt('parses a line alternating quotes and bullets in linear time', () => {
    // The quote half of the walk, which a bullet-only line never reaches: a
    // line of bare `> ` markers is linear on both sides, so only the mixed
    // shape holds it to anything.
    expectBuiltInputScansLinearly(
      (input) => void carveToHtml(input),
      (n) => '- > '.repeat(n) + 'x\n',
      { label: 'a line of alternating markers', smallRepeats: 1000 },
    )
  })
})
