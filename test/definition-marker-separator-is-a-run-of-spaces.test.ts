import { describe, expect, it } from 'vitest'

import { carveToHtml, lintCarve } from '../src/index.js'

/**
 * THE ABBREVIATION AND FOOTNOTE SEPARATOR IS A RUN OF ASCII SPACES, AND THE
 * NEXT CHARACTER IS CONTENT (markup-carve/carve#892).
 *
 * Two halves, settled together. The separator is a LITERAL SPACE, as it always
 * was, so a tab immediately after the marker is not a separator at all. And it
 * is a RUN of ASCII spaces - both productions said `space` while all four
 * readers consumed a run, so the grammar forbade a shape nothing rejected.
 *
 * This is deliberately the OPPOSITE cardinality call from carve#912's, which
 * narrowed four padding slots to exactly one space. A marker separator takes a
 * run; a padding slot takes one. Different positions, not a contradiction.
 */
describe('the separator is a run of ASCII spaces and nothing else', () => {
  // Anything that is not an ASCII space ends the run and begins the content.
  // The corpus carries the no-break space; these are the rest of the class,
  // which is what makes this a rule about the CLASS rather than one character.
  for (const [name, ch] of [
    ['a no-break space', ' '],
    ['a next line', ''],
    ['an ideographic space', '　'],
    ['an en quad', ' '],
    ['a byte order mark', '﻿'],
    ['a zero width space', '​'],
    ['a form feed', ''],
    ['a vertical tab', ''],
    ['a tab', '\t'],
  ] as const) {
    it(`an abbreviation expansion begins at ${name}`, () => {
      expect(carveToHtml(`*[HTML]: ${ch}Hyper\n\nHTML\n`)).toContain(`title="${ch}Hyper"`)
    })
  }

  it('and a run of ASCII spaces before it is still all separator', () => {
    // The CONTROL. A rule that kept everything would satisfy every assertion
    // above and put the author's alignment spaces into the title.
    expect(carveToHtml('*[HTML]:    Hyper\n\nHTML\n')).toContain('title="Hyper"')
    expect(carveToHtml('*[HTML]:    Hyper\n\nHTML\n')).toContain('title=" Hyper"')
  })

  it('but a tab where the MANDATORY space goes is not a separator at all', () => {
    // The other half, unchanged: the run is `\":\", space+`, so the first
    // character after the marker must be a space or the line is a paragraph.
    expect(carveToHtml('*[HTML]:\tHyper\n\nHTML\n')).toBe('<p>*[HTML]:\tHyper</p>\n<p>HTML</p>')
    expect(carveToHtml('x[^f]\n\n[^f]:\tnote\n')).toContain('<p>[^f]:\tnote</p>')
  })
})

describe('the two markers answer a trailing tab differently, downstream of the rule', () => {
  it('keeps it in an abbreviation title, which is a raw string', () => {
    expect(carveToHtml('*[HTML]: \tHyper\n\nHTML\n')).toContain('title="\tHyper"')
  })

  it('drops it from a footnote body, whose content is parsed as blocks', () => {
    // Not an exception to the rule. The tab IS content, and a footnote's
    // `inline_content` is parsed as blocks, so a leading tab is that body's own
    // indentation run (PART 9 section 24 C1) and is consumed there.
    expect(carveToHtml('x[^f]\n\n[^f]: \tnote\n')).toContain('<p>note<a href="#fnref1"')
  })

  it('keeps a no-break space in a footnote body, which is not indentation', () => {
    // The discriminator between the two: the tab is consumed as indentation and
    // the no-break space is not, so the body keeps it. Without this the pair
    // above reads as "the footnote separator is wider", which is the wrong
    // conclusion the ticket's first measurement reached.
    expect(carveToHtml('x[^f]\n\n[^f]:  note\n')).toContain('<p>&nbsp;note<a href="#fnref1"')
  })
})

describe("lint's footnote-definition pattern mirrors the parser", () => {
  const rules = (src: string): string[] => lintCarve(src).map((d) => d.rule)

  it('does not report a duplicate for a line the parser reads as a paragraph', () => {
    // The mirror was WIDER than the thing it mirrors, and had been since before
    // carve#892: it accepted any whitespace after the marker, where the parser
    // has always required a literal space. So a tab-separated line - a
    // paragraph, defining nothing - counted as a second definition and drew a
    // `duplicate-footnote-definition` for a duplicate that does not exist.
    expect(rules('x[^f]\n\n[^f]: one\n\n[^f]:\ttwo\n')).not.toContain(
      'duplicate-footnote-definition',
    )
  })

  it('still reports a real duplicate, including across a run of spaces', () => {
    // The CONTROL: narrowing the mirror must not stop it seeing the thing it is
    // for, and the run is exactly the shape carve#892 confirms is a separator.
    expect(rules('x[^f]\n\n[^f]: one\n\n[^f]:   two\n')).toContain(
      'duplicate-footnote-definition',
    )
  })
})
