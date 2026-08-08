import { describe, it, expect } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'
import { TABLE_ALIGNMENT_MARKERS } from '../src/parse.js'

/**
 * PART 11 §1: `to_html(fmt(x)) == to_html(x)`.
 *
 * `fmt` rewrites a table's delimiter row as `|=` header cells. A prefixed cell
 * is written TIGHT, so the first character of its content lands exactly where
 * the parser's alignment scan reads - and that scan consumes one `<`, `>` or `~`
 * glued to `|` or `|=`. A header cell whose content opened with one therefore
 * came back with an alignment it never had and its first character eaten
 * (markup-carve/carve-js#903).
 *
 * The fix is one space between the marker and the content. It is not "stop
 * emitting `|=`": rewriting the delimiter row is correct in general, which the
 * first control below is here to keep true.
 */

const roundTrips = (src: string) => carveToHtml(carveToCarve(src)) === carveToHtml(src)

describe('a header cell is not written so its content reads as alignment', () => {
  it('the sigil set is the parser’s, not a copy', () => {
    // A guard built from a hand-listed set would be a second spelling of the
    // parser's rule. If the parser ever learns a fourth sigil, this fails here
    // rather than silently in the writer.
    expect([...TABLE_ALIGNMENT_MARKERS.keys()].sort()).toEqual(['<', '>', '~'])
  })

  it('a strikethrough header cell keeps its strikethrough', () => {
    const src = '| ~x~ |\n|---|\n| y |\n'
    expect(carveToCarve(src)).toBe('|= ~x~|\n| y |\n')
    expect(roundTrips(src)).toBe(true)
    expect(carveToHtml(carveToCarve(src))).toContain('<s>x</s>')
    // The centering the old output invented reached every cell in the column.
    expect(carveToHtml(carveToCarve(src))).not.toContain('text-align: center')
  })

  it('an autolink header cell keeps its anchor', () => {
    const src = '| <https://e.example> |\n|---|\n| y |\n'
    expect(roundTrips(src)).toBe(true)
    expect(carveToHtml(carveToCarve(src))).toContain('<a href="https://e.example">')
    expect(carveToHtml(carveToCarve(src))).not.toContain('text-align: left')
  })

  it('every sigil the parser reads is guarded, including the one that was safe', () => {
    // `>` did not reach the defect when it was measured, because the escape pass
    // writes it `\>` for opening a blockquote. That is a different rule's
    // decision; the guard does not depend on it.
    for (const sigil of TABLE_ALIGNMENT_MARKERS.keys()) {
      const src = `| ${sigil}x |\n|---|\n| y |\n`
      expect(roundTrips(src), `header cell opening with ${sigil}`).toBe(true)
    }
  })

  it('the native header form breaks and is fixed the same way', () => {
    // Reached without a delimiter row at all, so the fix is on the cell writer
    // rather than on the delimiter-row rewrite.
    expect(roundTrips('|= ~x~ |\n| y |\n')).toBe(true)
    expect(carveToCarve('|= ~x~ |\n| y |\n')).toBe('|= ~x~|\n| y |\n')
  })

  it('CONTROL: the delimiter row is still rewritten as `|=`', () => {
    // The row this ticket is most likely to be misread as asking to change. No
    // mutation of the sigil guard moves it.
    expect(carveToCarve('| a |\n|---|\n| y |\n')).toBe('|=a|\n| y |\n')
    expect(roundTrips('| a |\n|---|\n| y |\n')).toBe(true)
  })

  it('CONTROL: content that is not sigil-initial keeps its tight form', () => {
    expect(carveToCarve('| /e/ |\n|---|\n| y |\n')).toBe('|=/e/|\n| y |\n')
    expect(carveToCarve('|= ^x |\n| y |\n')).toBe('|=^x|\n| y |\n')
    expect(carveToCarve('|= =x |\n| y |\n')).toBe('|==x|\n| y |\n')
  })

  it('CONTROL: a cell that already carries an alignment is untouched', () => {
    // The scan consumes exactly one marker, so the emitted alignment already
    // shields the content behind it. Adding a space here would be noise.
    expect(carveToCarve('|=< ~x~ |\n| y |\n')).toBe('|=<~x~|\n| y |\n')
    expect(roundTrips('|=< ~x~ |\n| y |\n')).toBe(true)
  })

  it('CONTROL: the body-cell and row-attribute writers were already safe', () => {
    // Measured rather than assumed - they are separate writers in this engine.
    // A body cell carries no prefix, so it is padded and the scan never reaches
    // its content; a row attribute sits after the closing pipe.
    for (const src of [
      '| a |\n|---|\n| ~y~ |\n',
      '| a |\n|---|\n| <https://e.example> |\n',
      '|= a |{.r}\n| ~y~ |{.s}\n',
    ]) {
      expect(roundTrips(src), src).toBe(true)
    }
    // BYTES, not just the rendering. A body cell is padded by the row writer,
    // so a guard that fired on it would add a second space that changes nothing
    // and reads as a defect - the round trip alone cannot see that.
    expect(carveToCarve('| a |\n|---|\n| ~y~ |\n')).toBe('|=a|\n| ~y~ |\n')
    expect(carveToCarve('|= a |{.r}\n| ~y~ |{.s}\n')).toBe('|=a|{.r}\n| ~y~ |{.s}\n')
  })

  it('is idempotent', () => {
    for (const src of ['| ~x~ |\n|---|\n| y |\n', '| <https://e.example> |\n|---|\n| y |\n']) {
      const once = carveToCarve(src)
      expect(carveToCarve(once)).toBe(once)
    }
  })
})
