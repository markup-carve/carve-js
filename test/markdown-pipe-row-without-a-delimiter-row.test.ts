import { describe, expect, it } from 'vitest'
import { markdownToCarve, carveToHtml } from '../src/index.js'

/**
 * markup-carve/carve-js#1061. Carve reads any line that begins and ends with
 * `|` as a table row, with no delimiter row anywhere, so a Markdown pipe row
 * GFM shows as a paragraph used to become a TABLE on migration - markup the
 * source did not have, which both halves of the markup-carve/carve#1130 ruling
 * forbid.
 *
 * Every expectation below was measured against `marked` 18.0.9 with
 * `gfm: true`, which is the reader here because `commonmark` implements no GFM
 * tables at all. The measured GFM output is quoted beside each case.
 *
 * The ticket named one shape. Sixteen produced a table that GFM does not, at
 * `8d38a03c`: the reported two-line row, a single row, a delimiter row with no
 * header, a delimiter row alone, both column-count mismatches, a stray row
 * before and after a real table, a row following a paragraph line, the same
 * inside a block quote and inside a list item, and four more where lines from
 * DIFFERENT containers were read as one table.
 *
 * `hasTable` is the load-bearing helper: it RENDERS the migrated Carve and asks
 * whether a table appeared, rather than comparing converter output to a second
 * copy of itself. A converter that stops inventing tables passes it however it
 * gets there.
 */
// The converter always ends its output with exactly one newline; the
// expectations below carry it, so every comparison is on exact bytes.
const migrated = (markdown: string): string => markdownToCarve(markdown)
const html = (markdown: string): string => carveToHtml(migrated(markdown)).trim()
const hasTable = (markdown: string): boolean => html(markdown).includes('<table')
const tableCount = (markdown: string): number => (html(markdown).match(/<table/g) ?? []).length

describe('a pipe row GFM does not read as a table stays text', () => {
  // marked 18 gfm: <p>| a | b |\n| c | d |</p>
  it('keeps the reported two-line row literal, in one paragraph', () => {
    expect(migrated('| a | b |\n| c | d |\n')).toBe('\\| a | b |\n\\| c | d |\n')
    expect(html('| a | b |\n| c | d |\n')).toBe('<p>| a | b |\n| c | d |</p>')
  })

  // marked 18 gfm: <p>| a | b |</p>
  it('keeps a single pipe row literal', () => {
    expect(html('| a | b |\n')).toBe('<p>| a | b |</p>')
  })

  // marked 18 gfm: <p>|---|---|\n| c | d |</p>
  it('keeps a delimiter row that has no header above it literal', () => {
    expect(hasTable('|---|---|\n| c | d |\n')).toBe(false)
  })

  // marked 18 gfm: <p>|---|---|</p>
  it('keeps a delimiter row standing alone literal', () => {
    expect(hasTable('|---|---|\n')).toBe(false)
  })

  // marked 18 gfm: <p>| a | b |\n|---|\n| c | d |</p>
  it('keeps a header wider than its delimiter row literal', () => {
    expect(hasTable('| a | b |\n|---|\n| c | d |\n')).toBe(false)
  })

  // marked 18 gfm: <p>| a |\n|---|---|\n| c |</p>
  it('keeps a header narrower than its delimiter row literal', () => {
    expect(hasTable('| a |\n|---|---|\n| c |\n')).toBe(false)
  })

  // marked 18 gfm: <p>text\n|---|---|</p>
  it('keeps a delimiter row under a paragraph line in that paragraph', () => {
    expect(html('text\n|---|---|\n')).toBe('<p>text\n|—|—|</p>')
  })

  // marked 18 gfm: <p>text\n| a | b |</p>
  it('keeps a pipe row under a paragraph line in that paragraph', () => {
    expect(html('text\n| a | b |\n')).toBe('<p>text\n| a | b |</p>')
  })

  // A `---` kept as text renders as an em dash, because Carve applies smart
  // typography to all migrated prose - not something this change introduced and
  // not specific to a pipe row. Pinned so the em dash above reads as measured
  // rather than as a typo.
  it('renders a triple hyphen in ordinary migrated prose as an em dash too', () => {
    expect(html('a text --- more\n')).toBe('<p>a text — more</p>')
  })
})

describe('a table GFM does read is untouched', () => {
  // marked 18 gfm: a table with thead a,b and tbody c,d
  it('still converts a header over a matching delimiter row', () => {
    expect(migrated('| a | b |\n|---|---|\n| c | d |\n')).toBe('|= a |= b |\n| c | d |\n')
    expect(html('| a | b |\n|---|---|\n| c | d |\n')).toBe(
      '<table>\n' +
        '  <thead><tr><th scope="col">a</th><th scope="col">b</th></tr></thead>\n' +
        '  <tbody>\n' +
        '    <tr><td>c</td><td>d</td></tr>\n' +
        '  </tbody>\n' +
        '</table>',
    )
  })

  it('keeps the alignment markers a delimiter row carries', () => {
    expect(migrated('| L | C | R |\n| :-- | :--: | --: |\n| a | b | c |\n')).toBe(
      '|=< L |=~ C |=> R |\n| a | b | c |\n',
    )
  })

  // marked 18 gfm keeps `plain line` as a one-cell body row rather than ending
  // the table. Carve has no such rule, so the row leaves the table - the
  // under-converting direction the carve#1130 ruling calls recoverable, and not
  // something this change touches. Pinned so a later change to the run's end is
  // a deliberate one.
  it('ends the table where Carve ends it, at the first non-row line', () => {
    expect(migrated('| a | b |\n|---|---|\n| c | d |\nplain line\n')).toBe(
      '|= a |= b |\n| c | d |\nplain line\n',
    )
  })

  // marked 18 gfm: table, then <h1>H</h1>
  it('ends the table at a heading, as GFM does', () => {
    const out = html('| a | b |\n|---|---|\n| c | d |\n# H\n')
    expect(out.includes('<table')).toBe(true)
    expect(out.includes('<h1>H</h1>')).toBe(true)
  })
})

describe('a stray row beside a real table is the only one escaped', () => {
  // marked 18 gfm: <p>| a | b |</p> then a table of x,y
  it('escapes the row before a table and leaves the table', () => {
    expect(migrated('| a | b |\n\n| x | y |\n|---|---|\n')).toBe('\\| a | b |\n\n|= x |= y |\n')
  })

  // marked 18 gfm: a table of a,b/c,d then <p>| e | f |</p>
  it('escapes the row after a table and leaves the table', () => {
    expect(migrated('| a | b |\n|---|---|\n| c | d |\n\n| e | f |\n')).toBe(
      '|= a |= b |\n| c | d |\n\n\\| e | f |\n',
    )
  })
})

describe('a container is answered by what it holds', () => {
  // marked 18 gfm: <blockquote><p>| a | b |\n| c | d |</p></blockquote>
  it('escapes a delimiter-less pipe row inside a block quote', () => {
    expect(migrated('> | a | b |\n> | c | d |\n')).toBe('> \\| a | b |\n> \\| c | d |\n')
    expect(hasTable('> | a | b |\n> | c | d |\n')).toBe(false)
  })

  it('leaves a real table inside a block quote alone', () => {
    expect(migrated('> | a | b |\n> |---|---|\n> | c | d |\n')).toBe(
      '> | a | b |\n> |---|---|\n> | c | d |\n',
    )
    expect(hasTable('> | a | b |\n> |---|---|\n> | c | d |\n')).toBe(true)
  })

  // marked 18 gfm: <ul><li>| a | b |\n| c | d |</li></ul>
  it('escapes a delimiter-less pipe row inside a list item', () => {
    expect(migrated('- | a | b |\n  | c | d |\n')).toBe('- \\| a | b |\n  \\| c | d |\n')
    expect(hasTable('- | a | b |\n  | c | d |\n')).toBe(false)
  })

  it('leaves a real table inside a list item alone', () => {
    expect(hasTable('- | a | b |\n  |---|---|\n  | c | d |\n')).toBe(true)
  })

  // A quote collector peels every level it finds into the prefix, and a list
  // collector peels only the item's columns - so without grouping, lines from
  // DIFFERENT containers formed a header/delimiter/body sequence that exists in
  // none of them and all three came through unescaped. Each `TABLE?` below is
  // marked 18 gfm's own answer for the same input.
  it.each([
    ['a header, a deeper delimiter row, then a shallower row', '> a | b\n> > --- | ---\n> | x | y |\n', false],
    ['the same with every row piped', '> | a | b |\n> > |---|---|\n> | x | y |\n', false],
    ['a deeper header over a shallower delimiter row', '> > | a | b |\n> |---|---|\n> | x | y |\n', false],
    ['a delimiter-less row a list item quotes', '- > | a | b |\n  > | c | d |\n', false],
    ['a real table a list item quotes', '- > | a | b |\n  > |---|---|\n  > | c | d |\n', true],
    ['a delimiter-less row two quotes deep', '> > | a | b |\n> > | c | d |\n', false],
    ['a real table two quotes deep', '> > | a | b |\n> > |---|---|\n> > | c | d |\n', true],
  ])('answers %s the way GFM does', (_label, markdown, expected) => {
    expect(hasTable(markdown)).toBe(expected)
  })

  // An HTML block that can interrupt a paragraph ends the table, so a row after
  // it is a stray row. marked 18 gfm closes the table at `<script>` and renders
  // the row below as <p>| e | f |</p>; left inside the run it came through
  // unescaped and Carve made a second table of it.
  it('ends the table at an interrupting HTML block, so the row after it is stray', () => {
    const out = migrated('| a | b |\n|---|---|\n| c | d |\n<script>y</script>\n| e | f |\n')
    expect(out.endsWith('\\| e | f |\n')).toBe(true)
    expect(tableCount('| a | b |\n|---|---|\n| c | d |\n<script>y</script>\n| e | f |\n')).toBe(1)
  })

  // `<span>` is not one of the HTML block types that interrupt, so marked keeps
  // it as a body row and the table does not end. Carve splits the table there
  // instead - a difference in where a table ENDS, not an invented one, and the
  // same at `8d38a03c` as here. Pinned so the guard above cannot widen to it.
  it('does not end the table at inline HTML, which GFM keeps as a body row', () => {
    expect(migrated('| a | b |\n|---|---|\n| c | d |\n<span>x</span>\n| e | f |\n')).toBe(
      '|= a |= b |\n| c | d |\n`<span>x</span>`{=html}\n| e | f |\n',
    )
  })

  // An indented line ends the table for marked too, and the row after it is a
  // paragraph. carve-js does not read that line as code without a blank before
  // it, which is a separate and older difference - the point pinned here is
  // only that the row below is no longer swept into the table.
  it('ends the table at an indented line, so the row after it is stray', () => {
    expect(migrated('| a | b |\n|---|---|\n| c | d |\n    code\n| e | f |\n')).toBe(
      '|= a |= b |\n| c | d |\n    code\n\\| e | f |\n',
    )
    expect(tableCount('| a | b |\n|---|---|\n| c | d |\n    code\n| e | f |\n')).toBe(1)
  })

  // REGRESSION GUARD. The outer item of a nested list is peeled into the
  // prefix and the inner one is left on the text, so the run carries a
  // container this function does not model. It escaped the rows of a table
  // that converted correctly before. A run like that is now left exactly as it
  // was, which is what this pins.
  it('leaves a table a NESTED list item holds converting', () => {
    expect(migrated('- - | a | b |\n    |---|---|\n    | c | d |\n')).toBe(
      '- - | a | b |\n    |---|---|\n    | c | d |\n',
    )
    expect(hasTable('- - | a | b |\n    |---|---|\n    | c | d |\n')).toBe(true)
  })

  // The other side of that guard, and a known remaining shape: a
  // delimiter-less row a NESTED list item holds still becomes a table, exactly
  // as at `8d38a03c`. Escaping it needs the nested container modelled, and
  // guessing at it is what broke the case above. Left as it was rather than
  // half-modelled.
  it('still makes a table of a delimiter-less row a nested list item holds', () => {
    expect(migrated('- - | a | b |\n    | c | d |\n')).toBe('- - | a | b |\n    | c | d |\n')
  })

  it('escapes only the row, keeping the quote markers it was written with', () => {
    expect(migrated('> | a | b |\n> > |---|---|\n> | x | y |\n')).toBe(
      '> \\| a | b |\n> > \\|---|---|\n> \\| x | y |\n',
    )
  })
})

describe('the escape reaches nothing it should not', () => {
  it('leaves a pipe row inside a fenced code block alone', () => {
    expect(migrated('```\n| a | b |\n```\n')).toBe('```\n| a | b |\n```\n')
  })

  it('leaves a pipe row inside an indented code block alone', () => {
    expect(migrated('para\n\n    | a | b |\n')).toBe('para\n\n```\n| a | b |\n```\n')
  })

  // A source that already escaped its pipes must not collect a second
  // backslash, which would publish the backslash instead of the pipe.
  it('does not escape a row whose opening pipe is already escaped', () => {
    expect(migrated('\\| a \\| b \\|\n')).toBe('\\| a \\| b \\|\n')
    expect(html('\\| a \\| b \\|\n')).toBe('<p>| a | b |</p>')
  })

  // Carve's row needs a pipe at BOTH ends, so neither of these was ever a
  // table and neither needs escaping. GFM reads both as a paragraph too.
  it.each([
    ['a leading pipe only', '| a | b\n'],
    ['a trailing pipe only', 'a | b |\n'],
    ['no outer pipes at all', 'a | b\nc | d\n'],
  ])('leaves %s untouched', (_label, markdown) => {
    expect(migrated(markdown)).toBe(markdown)
    expect(hasTable(markdown)).toBe(false)
  })
})

// markup-carve/carve#1193. The contract is "CommonMark plus GFM, plus footnote
// references": `[^1]` is in neither spec, but github.com renders it, so
// converting invents nothing and leaving it literal would take a footnote away
// from a document that had one. This change does not touch that path; the test
// is here because the same ruling settled both, and the docs now state the
// exception.
describe('footnote references keep converting', () => {
  it('migrates a reference and its definition to a Carve footnote', () => {
    const out = html('Text with a note[^1].\n\n[^1]: The note body.\n')
    expect(out.includes('role="doc-noteref"')).toBe(true)
    expect(out.includes('The note body.')).toBe(true)
  })
})
