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

  it.each([
    // No separator at all: not a marker, so the line folds.
    ['nothing after the colon', ':', FOLDS],
    ['a tab, no space', ':\t', FOLDS],
    ['a tab then a space', ':\t ', FOLDS],
    // A separator, and nothing after it: no content, so the line folds.
    ['one space', ': ', FOLDS],
    ['two spaces', ':  ', FOLDS],
    ['three spaces', ':   ', FOLDS],
    // A separator, then a lone TAB: trailing whitespace, not content, so the
    // line folds like the rows above (markup-carve/carve#1836).
    ['a space then a tab', ': \t', FOLDS],
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

})
