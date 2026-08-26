import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const flat = (html: string): string => html.replace(/\s+/g, ' ').trim()
const read = (body: string): string => flat(carveToHtml(`:: t\n${body}\nx\n`))

/**
 * WHAT FOLLOWS A DESCRIPTION MARKER DECIDES THE READING, and the whole table is
 * here because the answers are close together and each one is a different
 * clause doing the deciding.
 *
 * Two clauses draw the lines. A MARKER SEPARATOR is spelled `space` and a tab
 * never satisfies it (PART 1), so nothing after a colon matters until a space
 * appears. And a MARKER REQUIRES CONTENT (PART 2): once the separator is there,
 * the marker opens its block only if something follows the greedy space run.
 *
 * The table is pinned as a table rather than one case per rule because these
 * shapes were measured against carve-php one by one when
 * `markup-carve/carve#1830` was ported, and the neighbours are what made the
 * ruled rows readable. A single row moving is the thing worth catching - and
 * one moved unnoticed, which is why the table exists.
 */
describe('what follows a description marker decides the reading', () => {
  const FOLDS = '<dl> <dt>t : x</dt> </dl>'
  const OPENS_EMPTY = '<dl> <dt>t</dt> <dd></dd> </dl> <p>x</p>'

  it.each([
    // No separator at all: not a marker, so the line folds.
    ['nothing after the colon', ':', FOLDS],
    ['a tab, no space', ':\t', FOLDS],
    ['a tab then a space', ':\t ', FOLDS],
    // A separator, and nothing after it: no content, so the line folds.
    ['one space', ': ', FOLDS],
    ['two spaces', ':  ', FOLDS],
    ['three spaces', ':   ', FOLDS],
    // A separator and content: the description opens.
    ['a space then text', ': y', '<dl> <dt>t</dt> <dd>y x</dd> </dl>'],
    ['two spaces then text', ':  y', '<dl> <dt>t</dt> <dd>y x</dd> </dl>'],
    ['a space, a tab, then text', ': \ty', '<dl> <dt>t</dt> <dd>y x</dd> </dl>'],
    ['a space then a vertical tab', ': \v', '<dl> <dt>t</dt> <dd> x</dd> </dl>'],
    ['a space then a no-break space', ': \u00a0', '<dl> <dt>t</dt> <dd>&nbsp; x</dd> </dl>'],
    ['a space then a brace pair', ': {}', '<dl> <dt>t</dt> <dd>{} x</dd> </dl>'],
  ])('reads a colon plus %s', (_name, body, expected) => {
    expect(read(body)).toBe(expected)
  })

  /**
   * THE ONE CELL THIS ENGINE READS WRONG, pinned so it cannot move in silence.
   *
   * A space then a TAB: the greedy run is the space, and what follows is one
   * tab. `markup-carve/carve#1836` rules that it FOLDS, like the rows above -
   * MARKER REQUIRES CONTENT ignores trailing whitespace, and after the
   * separator's space run a lone tab is trailing whitespace and nothing else.
   *
   * This engine opens a description that then trims to empty. The port is
   * carve-js#1564 and is deferred past the release, so the row records what the
   * engine does rather than what is right - and being an equality assertion it
   * FAILS the moment the port lands, which is when it has to be deleted.
   */
  it('opens an empty description on a space then a tab, which carve#1836 rules should fold', () => {
    expect(read(': \t')).toBe(OPENS_EMPTY)
    // The staleness half: the ruled reading is the FOLDS row, so the day this
    // stops differing from it the carve-out has caught up and must go.
    expect(OPENS_EMPTY).not.toBe(FOLDS)
  })
})
