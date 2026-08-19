import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const html = (s: string) => carveToHtml(s)

/**
 * A row's closing `|` is a DELIMITER, not content, even when the cell before it
 * opened a verbatim run that never closes.
 *
 * Cells are cut out of a row at BLOCK level, before any inline parsing runs -
 * which is what makes a separator row work at all - so by the time the run is
 * parsed there is no row-terminating pipe left for it to swallow. This engine
 * scanned for the pipe and the run in one pass, so an unterminated run took the
 * closing pipe into itself while the row still ended at it: the character
 * vanished into the `<code>` and terminated the row at the same time
 * (markup-carve/carve#1284, ruled 2026-08-16).
 *
 * carve-rs produces every expectation below.
 *
 * Deliberately not asserted: how many cells a row that is SHORT of its header's
 * column count has. That question is open and is not this one.
 */
describe('an unterminated verbatim run stops at the row closing pipe', () => {
  it('a header-less row keeps its closing pipe out of the run', () => {
    expect(html('| a `b | c d |')).toBe(
      '<table>\n  <tbody>\n    <tr><td>a <code>b | c d</code></td></tr>\n  </tbody>\n</table>',
    )
  })

  it('the separator-bearing form reads the same way', () => {
    expect(html('| a | b |\n|---|---|\n| x `y | z |')).toBe(
      '<table>\n  <thead><tr><th scope="col">a</th><th scope="col">b</th></tr></thead>\n' +
        '  <tbody>\n    <tr><td>x <code>y | z</code></td></tr>\n  </tbody>\n</table>',
    )
  })

  it('every run kind that opens with a backtick reads the same way', () => {
    // `$` math and `!` literal spell the same run; the pipe is not theirs
    // either. The `!` prefix makes the unclosed run a literal inline too.
    expect(html('| a $`b | c d |')).toContain(
      '<td>a <span class="math inline">\\(b | c d\\)</span></td>',
    )
    expect(html('| a !`b | c d |')).toContain('<td>a b | c d</td>')
  })

  it('the row still carries a glued row-attribute block', () => {
    expect(html('| a `b | c d |{.x}')).toContain(
      '<tr class="x"><td>a <code>b | c d</code></td></tr>',
    )
  })

  // The controls. A change that made the header-less case work by loosening
  // where a row ends would move these.
  it('a closed run still leaves the pipe between two cells splitting them', () => {
    expect(html('| a `b` | c d |')).toBe(
      '<table>\n  <tbody>\n    <tr><td>a <code>b</code></td><td>c d</td></tr>\n  </tbody>\n</table>',
    )
  })

  it('a pipe inside a closed run still does not split the cell', () => {
    expect(html('| a `b | c` | d |')).toBe(
      '<table>\n  <tbody>\n    <tr><td>a <code>b | c</code></td><td>d</td></tr>\n  </tbody>\n</table>',
    )
  })

  it('an escaped pipe is still content and still does not split the cell', () => {
    // The pipe that comes off ahead of the scan is the row's LAST one, and the
    // escape that protects a pipe sits one character before it - so removing
    // the terminator must not reach past the escape handling. carve-rs and
    // carve-php produce this too.
    expect(html('| a \\| b |')).toBe(
      '<table>\n  <tbody>\n    <tr><td>a | b</td></tr>\n  </tbody>\n</table>',
    )
  })

  it('an ordinary headered table is unchanged', () => {
    expect(html('| a | b |\n|---|---|\n| x | y |')).toBe(
      '<table>\n  <thead><tr><th scope="col">a</th><th scope="col">b</th></tr></thead>\n' +
        '  <tbody>\n    <tr><td>x</td><td>y</td></tr>\n  </tbody>\n</table>',
    )
  })

  it('the empty-cell spellings are unchanged', () => {
    expect(html('|')).toBe('<p>|</p>')
    expect(html('||')).toBe('<p>||</p>')
    expect(html('|||')).toBe(
      '<table>\n  <tbody>\n    <tr><td></td><td></td></tr>\n  </tbody>\n</table>',
    )
  })

  it('a line with no closing pipe at all is still prose', () => {
    // The pipe is only a delimiter when the row HAS one. Nothing here promotes
    // an incomplete row.
    expect(html('| a `b c d')).toBe('<p>| a <code>b c d</code></p>')
  })

  it('trailing padding after the closing pipe is still not a cell', () => {
    expect(html('| a | b |   ')).toBe(
      '<table>\n  <tbody>\n    <tr><td>a</td><td>b</td></tr>\n  </tbody>\n</table>',
    )
  })

  it('a MULTI-backtick run reaches the closing pipe the same way', () => {
    // A verbatim run opens on a run of N backticks and closes only on a run of
    // EXACTLY N (§22). The splitter toggled once per backtick, so the second
    // backtick of ` ``b ` read as the CLOSER, the scan believed it was outside a
    // run, and the interior `|` split a row the inline pass reads as one cell:
    // `<td>a <code>b</code></td><td>c</td>` for a document with one column.
    // One production, two spellings, and only the one-backtick shape agreed
    // (corpus 328-…-stops-at-the-closing-pipe-4). carve-rs `b6ff319c` produces
    // this.
    expect(html('| a ``b | c |')).toBe(
      '<table>\n  <tbody>\n    <tr><td>a <code>b | c</code></td></tr>\n  </tbody>\n</table>',
    )
    // Three, so the fix cannot be "two backticks" either.
    expect(html('| a ```b | c |')).toBe(
      '<table>\n  <tbody>\n    <tr><td>a <code>b | c</code></td></tr>\n  </tbody>\n</table>',
    )
  })

  it('a run of the WRONG length does not close a multi-backtick run', () => {
    // The interior single backtick is content, so the run is still open at the
    // `|` and the row keeps one cell. A splitter that closed on any run would
    // split here.
    expect(html('| a ``b `c | d |')).toBe(
      '<table>\n  <tbody>\n    <tr><td>a <code>b `c | d</code></td></tr>\n  </tbody>\n</table>',
    )
  })

  it('a CLOSED multi-backtick run still leaves the pipe splitting', () => {
    // The control for the row above: with the run closed, the scan is outside
    // one and the pipe is a delimiter again. A fix that never left the run
    // would fail this.
    expect(html('| a ``b`` | c |')).toBe(
      '<table>\n  <tbody>\n    <tr><td>a <code>b</code></td><td>c</td></tr>\n  </tbody>\n</table>',
    )
    // And a pipe INSIDE the closed run is still content.
    expect(html('| a ``b | c`` | d |')).toBe(
      '<table>\n  <tbody>\n    <tr><td>a <code>b | c</code></td><td>d</td></tr>\n  </tbody>\n</table>',
    )
  })

  it('a `+` continuation closes a run opened on the base row', () => {
    // The continuation row ends at its own closing pipe too, so the fragment it
    // contributes is `c\``, which closes the run the base row opened. carve-php
    // produces this.
    expect(html('| a `b |\n+ c` |')).toBe(
      '<table>\n  <tbody>\n    <tr><td>a <code>b c</code></td></tr>\n  </tbody>\n</table>',
    )
  })
})

/**
 * A `+` continuation extends the CELL, so the block an unclosed run reaches the
 * end of is that whole cell, continuation included: the run spans the row
 * boundary and closes on the continuation row.
 *
 * The continuation was cut with a FRESH scanner, which cuts INSIDE the run and
 * leaves a segment with no column to join - and a dropped segment is content
 * loss rather than a second answer. It is carried PER COLUMN, never per line:
 * the run belongs to one column and a continuation joins per column, so the
 * columns before it are still cut at their own pipes (markup-carve/carve#1293,
 * corpus category 333). carve-rs `b6ff319c` produces every expectation below.
 */
describe('a continuation row is cut while the run is still open', () => {
  it('the interior pipe of the continuation is content', () => {
    // Was `<td>a <code>b c</code></td>`: the ` | d` segment was cut off and
    // dropped, so the document lost a run of characters it never renders.
    expect(html('| a `b |\n+ c | d` |')).toBe(
      '<table>\n  <tbody>\n    <tr><td>a <code>b c | d</code></td></tr>\n  </tbody>\n</table>',
    )
  })

  it('the columns BEFORE the run are still cut at their own pipes', () => {
    // Carrying the run across the whole continuation line swallows those
    // separators and pushes the text into the wrong cell, which leaves the run's
    // own cell holding an empty `<code></code>` - the artifact the ruling
    // rejects, produced from the other direction.
    expect(html('| x | a `b |\n+ y | c` |')).toBe(
      '<table>\n  <tbody>\n    <tr><td>x y</td><td>a <code>b c</code></td></tr>\n  </tbody>\n</table>',
    )
  })

  it('the carried run keeps its LENGTH across the boundary', () => {
    // A two-backtick run carried as "some run is open" would close on the single
    // backtick a one-backtick reader looks for.
    expect(html('| a ``b |\n+ c | d`` |')).toBe(
      '<table>\n  <tbody>\n    <tr><td>a <code>b c | d</code></td></tr>\n  </tbody>\n</table>',
    )
  })

  it('a LATER column resumes its own run, not the first one', () => {
    // The carry is indexed by column. A reader that only seeded column 0 leaves
    // every later column closed, and this document's interior pipe then splits a
    // cell the run owns - dropping the segment behind it, since the base row has
    // no third column for it to join. carve-rs `b6ff319c` produces this.
    expect(html('| x | a `b |\n+ y | c | d` |')).toBe(
      '<table>\n  <tbody>\n    <tr><td>x y</td><td>a <code>b c | d</code></td></tr>\n  </tbody>\n</table>',
    )
  })

  it('a run whose OPENER is longer is not closed by a shorter one', () => {
    // The carried value is a LENGTH, not a flag. Carried as "open", the single
    // backtick in the continuation closes the two-backtick run, the `|` after it
    // splits, and `d``` is left with no column to join - the content loss this
    // ruling rejects. carve-rs still reads it that way; the two agree on every
    // other row here.
    expect(html('| a ``b |\n+ c ` | d`` |')).toBe(
      '<table>\n  <tbody>\n    <tr><td>a <code>b c ` | d</code></td></tr>\n  </tbody>\n</table>',
    )
  })

  it('the run a cell ENDS in is measured with the same rule', () => {
    // `a ``b `c` ends inside the two-backtick run: the single backtick is
    // content. A measurement that closed on any run would hand the continuation
    // a closed column and split at its pipe.
    expect(html('| a ``b `c |\n+ d | e`` |')).toBe(
      '<table>\n  <tbody>\n    <tr><td>a <code>b `c d | e</code></td></tr>\n  </tbody>\n</table>',
    )
  })

  it('a run stays open across TWO continuation rows', () => {
    expect(html('| a `b |\n+ c |\n+ d` |')).toBe(
      '<table>\n  <tbody>\n    <tr><td>a <code>b c d</code></td></tr>\n  </tbody>\n</table>',
    )
  })

  it('an ESCAPED backtick outside a run opens none', () => {
    // The measurement is of the state the INLINE parser will be in, and there an
    // escaped backtick is a literal. Counting it opened a run the inline pass
    // does not have, so the continuation's real opener read as a closer, the pipe
    // behind it split a cell the run owns, and `z` was dropped for an empty
    // `<code></code>`. carve-rs `b6ff319c` reads it the same way this branch now
    // does.
    expect(html('| a | x \\` |\n+ b | y` | z |')).toBe(
      '<table>\n  <tbody>\n    <tr><td>a b</td><td>x ` y<code> | z</code></td></tr>\n  </tbody>\n</table>',
    )
  })

  it('...but INSIDE a run the backslash is content and the backtick closes', () => {
    // A verbatim body resolves no escapes, so ``b \\`` is a closed run holding
    // `b \\` - the cell ends OUTSIDE a run, and the continuation splits at its
    // own pipe. An escape rule applied inside the run would carry a run that is
    // not open and swallow the separator.
    expect(html('| a `b \\` |\n+ c | d |')).toBe(
      '<table>\n  <tbody>\n    <tr><td>a <code>b \\</code> c</td></tr>\n  </tbody>\n</table>',
    )
  })

  // The controls. A reader that carried a run that is NOT open would stop
  // splitting continuation rows at all.
  it('a continuation whose column left no open run still splits', () => {
    expect(html('| a | b |\n+ c | d |')).toBe(
      '<table>\n  <tbody>\n    <tr><td>a c</td><td>b d</td></tr>\n  </tbody>\n</table>',
    )
  })

  it('a run CLOSED on the base row leaves the continuation splitting', () => {
    expect(html('| a `b` | c |\n+ d | e |')).toBe(
      '<table>\n  <tbody>\n    <tr><td>a <code>b</code> d</td><td>c e</td></tr>\n  </tbody>\n</table>',
    )
  })

  it('an escaped closing pipe is still an escape', () => {
    // The row closes there, because the line ends in a pipe; what the escape
    // decides is what the CELL holds, which is a literal pipe and not an
    // orphaned backslash.
    expect(html('| a b \\|')).toBe(
      '<table>\n  <tbody>\n    <tr><td>a b |</td></tr>\n  </tbody>\n</table>',
    )
    expect(html('| a \\| b | c |')).toBe(
      '<table>\n  <tbody>\n    <tr><td>a | b</td><td>c</td></tr>\n  </tbody>\n</table>',
    )
  })
})
