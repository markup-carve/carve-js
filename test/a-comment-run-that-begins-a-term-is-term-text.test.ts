import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

/*
 * A `%%` RUN THAT BEGINS A DEFINITION TERM'S OWN LINE IS TERM TEXT.
 *
 * A term has no content column of its own, so nothing written on the `::` line
 * opens a block there (markup-carve/carve#2411) and the line-comment form cannot
 * be spelled on it at all. It was read as one, so `:: %%%` published neither the
 * run nor the body it fenced, and the leading space of the folded line was left
 * standing in the `dt` (markup-carve/carve-js#2293).
 *
 * One mechanism, five spellings: the closer at column 0, the closer on the term's
 * own line, no closer at all, width 4, and the `%%` line form. Where the closer
 * stands never changed the reading, which is what identifies the opener rather
 * than the pair as the defect.
 *
 * Measured against the oracle - `scripts/spec/layout.mjs` into
 * `scripts/spec/html.mjs` in markup-carve/carve at `e24e38e9` - run rather than
 * read, and byte-identical on all of these.
 */

describe('a comment run that begins a definition term is term text', () => {
  it.each([
    [
      'the closer at column 0',
      ':: %%%\n   hidden\n%%%\ntail\n',
      '<dl>\n  <dt>%%%\n   hidden</dt>\n</dl>\n<p>tail</p>',
    ],
    [
      'the closer on the term line',
      ':: %%%\n   hidden\n   %%%\ntail\n',
      '<dl>\n  <dt>%%%\n   hidden\n\ntail</dt>\n</dl>',
    ],
    ['no closer at all', ':: %%%\n   hidden\ntail\n', '<dl>\n  <dt>%%%\n   hidden\ntail</dt>\n</dl>'],
    [
      'width 4',
      ':: %%%%\n   hidden\n%%%%\ntail\n',
      '<dl>\n  <dt>%%%%\n   hidden</dt>\n</dl>\n<p>tail</p>',
    ],
    ['the line form', ':: %% x\n   hidden\ntail\n', '<dl>\n  <dt>%% x\n   hidden\ntail</dt>\n</dl>'],
    ['more than one space before the run', '::   %% b\n', '<dl>\n  <dt>%% b</dt>\n</dl>'],
    ['a run with no separator', ':: %%%b\n', '<dl>\n  <dt>%%%b</dt>\n</dl>'],
    ['a run of five', ':: %%%%%\n', '<dl>\n  <dt>%%%%%</dt>\n</dl>'],
    ['a term that is only a run', ':: %%\n', '<dl>\n  <dt>%%</dt>\n</dl>'],
    ['a second term that is a run', ':: a\n:: %%\n: d\n', '<dl>\n  <dt>a</dt>\n  <dt>%%</dt>\n  <dd>d</dd>\n</dl>'],
    ['a term behind a quote marker', '> :: %% b\n', '<blockquote>\n  <dl>\n    <dt>%% b</dt>\n  </dl>\n</blockquote>'],
    ['a term inside a list item', '- :: %% b\n', '<ul>\n  <li>\n    <dl>\n      <dt>%% b</dt>\n    </dl>\n  </li>\n</ul>'],
  ])('keeps %s', (_name, source, expected) => {
    expect(carveToHtml(source)).toBe(expected)
  })

  /*
   * THE EXCEPTION REACHES THE FIRST RUN AND NOTHING ELSE. Each of these already
   * agreed with the oracle and has to stay where it was: a run later on the term
   * line is the ordinary inline comment, a run on a continuation line is the line
   * form and hides, a description marker line has a content column and can hold a
   * block, and a run that opens a nested span is a separate question this does not
   * answer.
   */
  it.each([
    ['a run later on the term line', ':: a %% b\n', '<dl>\n  <dt>a</dt>\n</dl>'],
    ['the second of two runs', ':: %% b %% c\n', '<dl>\n  <dt>%% b</dt>\n</dl>'],
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
