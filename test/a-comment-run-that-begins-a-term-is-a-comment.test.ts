import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

/*
 * A `%%` RUN THAT BEGINS A DEFINITION TERM IS THE TRAILING COMMENT.
 *
 * A term begins its inline run mid-line, and CARVE-P9-041 counts a run start as
 * a separator in every host (markup-carve/carve#2552, corpus 518-4). So the
 * marker opens a comment on the `::` line, and the fenced spellings open one
 * too: the comment reaches the end of its line whatever stands below it.
 *
 * This reverses carve-js#2293, which read the same shapes as term text against
 * the oracle of the time. Thirteen of the rows below moved with the clause; the
 * ten controls under them never did.
 *
 * Expectations derived from the oracle - `scripts/spec/layout.mjs` into
 * `scripts/spec/html.mjs` in markup-carve/carve at `24b5e77a` - run rather than
 * read, on every row.
 */

describe('a comment run that begins a definition term is a comment', () => {
  it.each([
    ['the closer at column 0', ':: %%%\n   hidden\n%%%\ntail\n', '<dl>\n  <dt>\n   hidden</dt>\n</dl>\n<p>tail</p>'],
    ['the closer on the term line', ':: %%%\n   hidden\n   %%%\ntail\n', '<dl>\n  <dt>\n   hidden\n\ntail</dt>\n</dl>'],
    ['no closer at all', ':: %%%\n   hidden\ntail\n', '<dl>\n  <dt>\n   hidden\ntail</dt>\n</dl>'],
    ['width 4', ':: %%%%\n   hidden\n%%%%\ntail\n', '<dl>\n  <dt>\n   hidden</dt>\n</dl>\n<p>tail</p>'],
    ['the line form', ':: %% x\n   hidden\ntail\n', '<dl>\n  <dt>\n   hidden\ntail</dt>\n</dl>'],
    ['more than one space before the run', '::   %% b\n', '<dl>\n  <dt></dt>\n</dl>'],
    ['a run with no separator after it', ':: %%%b\n', '<dl>\n  <dt></dt>\n</dl>'],
    ['a run of five', ':: %%%%%\n', '<dl>\n  <dt></dt>\n</dl>'],
    ['a term that is only a run', ':: %%\n', '<dl>\n  <dt></dt>\n</dl>'],
    ['a second term that is a run', ':: a\n:: %%\n: d\n', '<dl>\n  <dt>a</dt>\n  <dt></dt>\n  <dd>d</dd>\n</dl>'],
    ['a term behind a quote marker', '> :: %% b\n', '<blockquote>\n  <dl>\n    <dt></dt>\n  </dl>\n</blockquote>'],
    ['a term inside a list item', '- :: %% b\n', '<ul>\n  <li>\n    <dl>\n      <dt></dt>\n    </dl>\n  </li>\n</ul>'],
    ['the second of two runs', ':: %% b %% c\n', '<dl>\n  <dt></dt>\n</dl>'],
  ])('hides %s', (_name, source, expected) => {
    expect(carveToHtml(source)).toBe(expected)
  })

  /*
   * THE CONTROLS. None of these moved with the clause: a run later on the term
   * line was always the ordinary inline comment, a run on a continuation line
   * takes the line form, a description marker line has a content column of its
   * own, and an escape declines the marker wherever it stands.
   */
  it.each([
    ['a run later on the term line', ':: a %% b\n', '<dl>\n  <dt>a</dt>\n</dl>'],
    ['a run after emphasis', ':: /x/ %% b\n', '<dl>\n  <dt><em>x</em></dt>\n</dl>'],
    ['a run on a continuation line', ':: a\n   %% b\n', '<dl>\n  <dt>a\n</dt>\n</dl>'],
    ['a fence on a continuation line', ':: a\n   %%% b\n   %%%\n', '<dl>\n  <dt>a\n</dt>\n</dl>'],
    ['a run at column 0 below the term', ':: a\n%% b\n', '<dl>\n  <dt>a</dt>\n</dl>'],
    ['a run on a description marker line', ':: a\n: %% b\n', '<dl>\n  <dt>a</dt>\n  <dd></dd>\n</dl>'],
    ['an escaped run', ':: \\%% b\n', '<dl>\n  <dt>%% b</dt>\n</dl>'],
    ['a braced comment on the term line', ':: a {% c %} b\n', '<dl>\n  <dt>a  b</dt>\n</dl>'],
    ['a fence written below an ordinary term', ':: t\n   %%%\n   hidden\n   %%%\ntail\n', '<dl>\n  <dt>t\n\ntail</dt>\n</dl>'],
    ['an ordinary term with a folded line', ':: t\n   hidden\ntail\n', '<dl>\n  <dt>t\n   hidden\ntail</dt>\n</dl>'],
  ])('leaves %s where it was', (_name, source, expected) => {
    expect(carveToHtml(source)).toBe(expected)
  })
})
