import { describe, expect, it } from 'vitest'

import { carveToHtml } from '../src/index.js'

/**
 * ONE PREDICATE FOR "IS THIS LINE A REFERENCE DEFINITION?" (carve#911).
 *
 * `reference_definition` ends `[space, attributes], newline`, and this engine
 * takes the trailing attribute block off the line BEFORE the pattern runs
 * (carve#604). So once the pattern is ANCHORED at end of line, a bare
 * `RE_LINK_DEF.test(line)` answers NO for `[a]: /u {.c}` - a definition by
 * every reading. Nine predicates around src/parse.ts asked the question that
 * way, each meaning the whole production, and each correct only because the
 * unanchored pattern swallowed the braces along with everything else.
 *
 * They now share `isLinkDefLine`. FOUR of them had nothing that could observe
 * the change: putting them back to the bare `.test` left all 1373 corpus
 * documents and the whole suite green, because every corpus document that
 * carries a definition with a trailing attribute block writes it at the
 * DOCUMENT level, where a different call site decides. The shapes below are
 * what each of the four actually governs, found by building the mutant and
 * diffing its output rather than by reading the code.
 *
 * Each shape carries its ATTRIBUTE-LESS twin as a control: the two must agree
 * about everything except the attribute, since it is the block's presence and
 * not its content that the two spellings disagreed about.
 */
describe('a definition with a trailing attribute block is a definition at every site', () => {
  // The list-item lazy-state tracker: a definition BELOW an open item's content
  // column pops the item's columns, so the definition belongs to the document
  // rather than being swallowed as item text. Under the bare `.test` the
  // columns stayed, the line was eaten by the item, and the reference below it
  // went unresolved - the "rendered nowhere and defined nothing" outcome.
  it('pops a list item that a flush-left definition sits below', () => {
    const withAttrs = carveToHtml('- text\n[a]: /u {.c}\n\n[a][]\n')

    expect(withAttrs).toBe('<ul>\n  <li>text</li>\n</ul>\n<p><a href="/u" class="c">a</a></p>')
    expect(carveToHtml('- text\n[a]: /u\n\n[a][]\n')).toBe(
      '<ul>\n  <li>text</li>\n</ul>\n<p><a href="/u">a</a></p>',
    )
  })

  it('pops a NESTED list item the same way', () => {
    expect(carveToHtml('- a\n  - b\n[a]: /u {.c}\n\n[a][]\n')).toBe(
      '<ul>\n  <li>a\n    <ul>\n      <li>b</li>\n    </ul>\n  </li>\n</ul>\n<p><a href="/u" class="c">a</a></p>',
    )
  })

  // `isInvisibleLine`: a definition renders nothing, so a blank line on either
  // side of one still separates two paragraphs and the item is LOOSE. Under the
  // bare `.test` the line counted as visible content, the blank stopped
  // loosening, and the item came out tight.
  it('is invisible for looseness, so the item holds two paragraphs', () => {
    expect(carveToHtml('- a\n\n  [a]: /u {.c}\n  text\n')).toBe(
      '<ul>\n  <li><p>a</p>\n    <p>text</p>\n  </li>\n</ul>',
    )
    expect(carveToHtml('- a\n\n  [a]: /u\n  text\n')).toBe(
      '<ul>\n  <li><p>a</p>\n    <p>text</p>\n  </li>\n</ul>',
    )
  })

  // `lineOpensBlock`: a block-SHAPED line BELOW the content column opens
  // nothing (PART 9 §24 C3) and folds as lazy item text. A definition is one of
  // the shapes that predicate names, and under the bare `.test` the line
  // stopped being one, so it was dropped instead of folding.
  it('folds as lazy text below a sub-list content column rather than vanishing', () => {
    expect(carveToHtml('-   x\n    - a\n  [a]: /u {.c}\n\n[a][]\n')).toBe(
      '<ul>\n  <li>x\n    <ul>\n      <li>a\n[a]: /u {.c}</li>\n    </ul>\n  </li>\n</ul>\n<p>[a][]</p>',
    )
  })
})
