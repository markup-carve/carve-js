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
    // either. An unterminated `!` run leaves the `!` as literal text, as it
    // does outside a table.
    expect(html('| a $`b | c d |')).toContain(
      '<td>a <span class="math inline">\\(b | c d\\)</span></td>',
    )
    expect(html('| a !`b | c d |')).toContain('<td>a !<code>b | c d</code></td>')
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

  it('a `+` continuation closes a run opened on the base row', () => {
    // The continuation row ends at its own closing pipe too, so the fragment it
    // contributes is `c\``, which closes the run the base row opened. carve-php
    // produces this.
    expect(html('| a `b |\n+ c` |')).toBe(
      '<table>\n  <tbody>\n    <tr><td>a <code>b c</code></td></tr>\n  </tbody>\n</table>',
    )
  })
})
