import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import { markdownToCarveWithLosses } from '../src/markdown-migrate.js'
import { HEADING_LEADING_WHITESPACE_UNSPELLABLE, LEADING_WHITESPACE_UNSPELLABLE } from '../src/import-report-messages.js'

/*
 * Whitespace a decoded character reference puts at the start of a line has no
 * Carve spelling, and the importer DROPS it and records the loss rather than
 * substituting a character (markup-carve/carve#2595, ruled 2026-09-29).
 *
 * This used to emit `\ `, which Carve reads as U+00A0. A non-breaking space is
 * not the tab or space the author wrote: it changes line breaking and copies out
 * of a browser as a different byte, so the substitution travels further than the
 * document. The precedent is this project's HTML round-trip ruling that an empty
 * half beats a wrong one.
 *
 * CommonMark row 40 is the named fixture. carve-php and carve-rs already drop.
 */

const convert = (markdown: string) => markdownToCarveWithLosses(markdown)

describe('the character goes, and the loss is recorded', () => {
  it('drops a decoded tab at a paragraph start (CommonMark row 40)', () => {
    const { value, losses } = convert('&#9;foo\n')
    expect(value).toBe('foo\n')
    expect(carveToHtml(value)).toBe('<p>foo</p>')
    expect(losses).toEqual([{ code: 'structure-unspellable', message: LEADING_WHITESPACE_UNSPELLABLE }])
  })

  it('drops a decoded space the same way', () => {
    expect(convert('&#32;foo\n').value).toBe('foo\n')
  })

  it('drops a whole run of them', () => {
    expect(convert('&#9;&#9;foo\n').value).toBe('foo\n')
  })

  it('reports nothing when the decode leaves no leading whitespace', () => {
    expect(convert('a &amp; b\n').losses).toEqual([])
  })

  it('leaves whitespace the author wrote as indentation alone', () => {
    const { value, losses } = convert('  a &amp; b\n')
    expect(value).toBe('  a & b\n')
    expect(losses).toEqual([])
  })

  it('keeps a real non-breaking space, which the author did write', () => {
    expect(convert('&#160;foo\n').value).toBe(' foo\n')
  })
})

describe('dropping it does not open a block', () => {
  // The whitespace was indentation to every block rule after the decode, so the
  // marker it leaves at column 0 is escaped. The line stays the paragraph cmark
  // reads, which is what the old substitution was protecting.
  it.each([
    ['&#32;- item\n', '\\- item\n', '<p>- item</p>'],
    ['&#32;* item\n', '\\* item\n', '<p>* item</p>'],
    ['&#32;# h\n', '\\# h\n', '<p># h</p>'],
    ['&#32;> q\n', '\\> q\n', '<p>&gt; q</p>'],
    ['&#32;1. x\n', '1\\. x\n', '<p>1. x</p>'],
    ['&#32;| a | b |\n', '\\| a | b |\n', '<p>| a | b |</p>'],
    ['&#32;%% c\n', '\\%% c\n', '<p>%% c</p>'],
  ])('%j', (markdown, carve, html) => {
    expect(convert(markdown).value).toBe(carve)
    expect(carveToHtml(carve)).toBe(html)
  })

  it('keeps a container opener from opening a container', () => {
    const { value } = convert('&#32;::: note\nx\n:::\n')
    expect(carveToHtml(value)).toBe('<p>::: note\nx\n:::</p>')
  })

  // A definition is not merely a different block: it reaches no output, so the
  // paragraph disappeared entirely rather than losing its leading space. Raised
  // by codex review.
  it.each([
    ['&#32;[foo]: /url\n', '\\[foo]: /url\n', '<p>[foo]: /url</p>'],
    ['&#32;[^a]: b\n', '\\[^a]: b\n', '<p>[^a]: b</p>'],
    ['&#32;*[x]: y\n', '\\*[x]: y\n', '<p>*[x]: y</p>'],
  ])('keeps the paragraph for %j', (markdown, carve, html) => {
    expect(convert(markdown).value).toBe(carve)
    expect(carveToHtml(carve)).toBe(html)
  })

  it('leaves a bracket run that is not a definition alone', () => {
    expect(convert('&#32;[a] b\n').value).toBe('[a] b\n')
  })
})

/*
 * The site reports a REAL loss, and only where one happens. carve-js#2677 asked
 * whether it fires on an input nothing is lost on, and the answer measured on
 * all three engines is that it does not: `&nbsp;` decodes to U+00A0, which the
 * author did write and Carve spells, so no engine reports anything. On `&#32;`
 * all three engines drop the character; carve-js is the only one that names the
 * loss, so the under-report is on the other two
 * (markup-carve/carve-php#3050, markup-carve/carve-rs#2446).
 */
describe('a table cell, the input carve-js#2677 was raised on', () => {
  const table = (cell: string) => `| A | B |\n| --- | --- |\n| ${cell} | y |\n`

  it('keeps a decoded non-breaking space and reports nothing', () => {
    const { value, losses } = convert(table('&nbsp;x'))
    expect(value).toBe('|= A |= B |\n| \u00a0x | y |\n')
    expect(value.codePointAt(14)).toBe(0x00a0)
    expect(losses).toEqual([])
  })

  it('drops a decoded space and names that loss', () => {
    const { value, losses } = convert(table('&#32;x'))
    expect(value).toBe('|= A |= B |\n| x | y |\n')
    expect(losses).toEqual([{ code: 'structure-unspellable', message: LEADING_WHITESPACE_UNSPELLABLE }])
  })

  it('reports nothing for an entity that decodes to a non-whitespace character', () => {
    const { value, losses } = convert(table('&amp;x'))
    expect(value).toBe('|= A |= B |\n| &x | y |\n')
    expect(losses).toEqual([])
  })

  it('reports nothing for a TRAILING decoded space, which is not line-leading', () => {
    expect(convert(table('x&#32;')).losses).toEqual([])
    expect(convert('trailing&#32;\n').losses).toEqual([])
  })
})

/*
 * The same character at a HEADING's head (markup-carve/carve-rs#2449). carve-js
 * used to pad the marker separator instead of dropping, which keeps bytes and
 * not the character: `#  head` renders the document `# head` renders, and
 * `carve fmt` rewrites the padding away. carve-rs drops and is the reference.
 */
describe("a decoded space at a heading's head", () => {
  it('drops it and names the loss', () => {
    const { value, losses } = convert('# &#32;head\n')
    expect(value).toBe('# head\n')
    expect(carveToHtml(value)).toBe('<section id="head">\n  <h1>head</h1>\n</section>')
    expect(losses).toEqual([{ code: 'structure-unspellable', message: HEADING_LEADING_WHITESPACE_UNSPELLABLE }])
  })

  it.each([
    ['## &#32;h2\n', '## h2\n'],
    ['###### &#32;h6\n', '###### h6\n'],
    ['# &#9;tab\n', '# tab\n'],
    ['# &#32;&#32;two\n', '# two\n'],
  ])('%j', (markdown, carve) => {
    const { value, losses } = convert(markdown)
    expect(value).toBe(carve)
    expect(losses).toEqual([{ code: 'structure-unspellable', message: HEADING_LEADING_WHITESPACE_UNSPELLABLE }])
  })

  it('leaves a decoded space that is NOT at the head alone', () => {
    const { value, losses } = convert('# mid &#32;x\n')
    expect(value).toBe('# mid  x\n')
    expect(losses).toEqual([])
  })

  it('keeps a non-breaking space, which the author did write', () => {
    const { value, losses } = convert('# &nbsp;head\n')
    expect(value).toBe('# \u00a0head\n')
    expect(value.codePointAt(2)).toBe(0x00a0)
    expect(losses).toEqual([])
  })

  it('drops the separator too when the decode WAS the content', () => {
    expect(convert('# &#32;\n').value).toBe('#\n')
  })

  // Raised by codex review: a `#` run in a table cell is literal text, so the
  // space after it is content Carve holds. carve-rs keeps it.
  it('leaves a heading-shaped table cell alone', () => {
    const { value, losses } = convert('| # &#32;x |\n| --- |\n| a |\n')
    expect(value).toBe('|= #  x |\n| a |\n')
    expect(losses).toEqual([])
  })

  it('reports nothing when the author wrote the separator run themselves', () => {
    const { value, losses } = convert('#    lit\n')
    expect(value).toBe('# lit\n')
    expect(losses).toEqual([])
  })

  /*
   * A decoded reference that supplies the separator changes the BLOCK, not a
   * character: CommonMark decides the block before any reference is decoded and
   * an ATX heading needs a literal space or tab, so `#&#32;nosep` is a PARAGRAPH
   * whose text begins with `#`. Written bare it read back as a level-1 heading,
   * gaining an id and entering the outline, with no diagnostic
   * (markup-carve/carve-js#2698). Escaping the run is what carve-rs writes, and
   * every expectation below is byte-identical to carve-rs 879d32c0a.
   */
  describe('a decoded separator must not turn a paragraph into a heading', () => {
    it.each([
      ['#&#32;nosep\n', '\\# nosep\n', '<p># nosep</p>'],
      ['##&#32;x\n', '\\#\\# x\n', '<p>## x</p>'],
      ['######&#32;x\n', '\\#\\#\\#\\#\\#\\# x\n', '<p>###### x</p>'],
      ['#&#x20;y\n', '\\# y\n', '<p># y</p>'],
      ['> #&#32;x\n', '> \\# x\n', '<blockquote><p># x</p></blockquote>'],
      ['- #&#32;x\n', '- \\# x\n', '<ul>\n  <li># x</li>\n</ul>'],
    ])('%j re-reads as the paragraph it was', (markdown, carve, html) => {
      const { value, losses } = convert(markdown)
      expect(value).toBe(carve)
      expect(carveToHtml(value)).toBe(html)
      expect(losses).toEqual([])
    })

    // Only a SPACE opens a Carve heading, so a decoded tab needs no escape.
    it.each([['#&#9;x\n'], ['#&Tab;x\n']])('%j leaves a decoded tab bare', (markdown) => {
      const { value, losses } = convert(markdown)
      expect(value).toBe('#\tx\n')
      expect(carveToHtml(value)).toBe('<p>#\tx</p>')
      expect(losses).toEqual([])
    })

    it('leaves a run of seven alone, which opens no heading at any level', () => {
      expect(convert('#######&#32;x\n').value).toBe('####### x\n')
    })

    it.each([['#&#32;\n', '#\n'], ['##&#32;\n', '##\n']])(
      '%j keeps the marker run bare when the decode was the whole content',
      (markdown, carve) => {
        expect(convert(markdown).value).toBe(carve)
      },
    )

    // The #2449 control: the SOURCE supplies the separator, so this IS a
    // heading and must keep dropping the decoded space and naming the loss.
    it('still drops, and reports, when the source supplies the separator', () => {
      const { value, losses } = convert('# &#32;head\n')
      expect(value).toBe('# head\n')
      expect(carveToHtml(value)).toBe('<section id="head">\n  <h1>head</h1>\n</section>')
      expect(losses).toEqual([
        { code: 'structure-unspellable', message: HEADING_LEADING_WHITESPACE_UNSPELLABLE },
      ])
    })

    it('leaves an authored escape and an authored heading untouched', () => {
      expect(convert('\\# para\n').value).toBe('\\# para\n')
      expect(convert('# x\n').value).toBe('# x\n')
    })

    /*
     * A LATER line of a paragraph opens a heading at column 0 just as the
     * first one does, so `foo\n#&#32;x` split one paragraph into a paragraph
     * and a heading. Raised by codex review on this change.
     */
    it.each([
      ['foo\n#&#32;x\n', 'foo\n\\# x\n', '<p>foo\n# x</p>'],
      ['foo\n##&#32;x\n', 'foo\n\\#\\# x\n', '<p>foo\n## x</p>'],
      ['> foo\n> #&#32;x\n', '> foo\n> \\# x\n', '<blockquote><p>foo\n# x</p></blockquote>'],
    ])('%j keeps the continuation in its paragraph', (markdown, carve, html) => {
      const { value } = convert(markdown)
      expect(value).toBe(carve)
      expect(carveToHtml(value)).toBe(html)
    })

    it('leaves a continuation the SOURCE opens a heading on alone', () => {
      expect(convert('foo\n# x\n').value).toBe('foo\n\n# x\n')
      expect(convert('foo\n\\# x\n').value).toBe('foo\n\\# x\n')
    })

    // A `#` run in a cell is literal text, so no escape is owed there either.
    it('leaves a heading-shaped table cell alone', () => {
      const { value, losses } = convert('| a |\n| --- |\n| #&#32;c |\n')
      expect(value).toBe('|= a |\n| # c |\n')
      expect(losses).toEqual([])
    })
  })

  /*
   * A decoded reference that supplies the separator changes the BLOCK, not a
   * character: CommonMark decides the block before any reference is decoded and
   * an ATX heading needs a literal space or tab, so `#&#32;nosep` is a PARAGRAPH
   * whose text begins with `#`. Written bare it read back as a level-1 heading,
   * gaining an id and entering the outline, with no diagnostic
   * (markup-carve/carve-js#2698). Escaping the run is what carve-rs writes, and
   * every expectation below is byte-identical to carve-rs 879d32c0a.
   */
  describe('a decoded separator must not turn a paragraph into a heading', () => {
    it.each([
      ['#&#32;nosep\n', '\\# nosep\n', '<p># nosep</p>'],
      ['##&#32;x\n', '\\#\\# x\n', '<p>## x</p>'],
      ['######&#32;x\n', '\\#\\#\\#\\#\\#\\# x\n', '<p>###### x</p>'],
      ['#&#x20;y\n', '\\# y\n', '<p># y</p>'],
      ['> #&#32;x\n', '> \\# x\n', '<blockquote><p># x</p></blockquote>'],
      ['- #&#32;x\n', '- \\# x\n', '<ul>\n  <li># x</li>\n</ul>'],
    ])('%j re-reads as the paragraph it was', (markdown, carve, html) => {
      const { value, losses } = convert(markdown)
      expect(value).toBe(carve)
      expect(carveToHtml(value)).toBe(html)
      expect(losses).toEqual([])
    })

    // Only a SPACE opens a Carve heading, so a decoded tab needs no escape.
    it.each([['#&#9;x\n'], ['#&Tab;x\n']])('%j leaves a decoded tab bare', (markdown) => {
      const { value, losses } = convert(markdown)
      expect(value).toBe('#\tx\n')
      expect(carveToHtml(value)).toBe('<p>#\tx</p>')
      expect(losses).toEqual([])
    })

    it('leaves a run of seven alone, which opens no heading at any level', () => {
      expect(convert('#######&#32;x\n').value).toBe('####### x\n')
    })

    it.each([['#&#32;\n', '#\n'], ['##&#32;\n', '##\n']])(
      '%j keeps the marker run bare when the decode was the whole content',
      (markdown, carve) => {
        expect(convert(markdown).value).toBe(carve)
      },
    )

    // The #2449 control: the SOURCE supplies the separator, so this IS a
    // heading and must keep dropping the decoded space and naming the loss.
    it('still drops, and reports, when the source supplies the separator', () => {
      const { value, losses } = convert('# &#32;head\n')
      expect(value).toBe('# head\n')
      expect(carveToHtml(value)).toBe('<section id="head">\n  <h1>head</h1>\n</section>')
      expect(losses).toEqual([
        { code: 'structure-unspellable', message: HEADING_LEADING_WHITESPACE_UNSPELLABLE },
      ])
    })

    it('leaves an authored escape and an authored heading untouched', () => {
      expect(convert('\\# para\n').value).toBe('\\# para\n')
      expect(convert('# x\n').value).toBe('# x\n')
    })

    // A `#` run in a cell is literal text, so no escape is owed there either.
    it('leaves a heading-shaped table cell alone', () => {
      const { value, losses } = convert('| a |\n| --- |\n| #&#32;c |\n')
      expect(value).toBe('|= a |\n| # c |\n')
      expect(losses).toEqual([])
    })
  })
})
