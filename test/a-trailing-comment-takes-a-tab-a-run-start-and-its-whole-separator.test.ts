import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/*
 * CARVE-P9-041 HOLDS IN EVERY INLINE HOST (markup-carve/carve#2552, corpus 518).
 *
 * The clause grants a trailing `%%` marker three properties, and the spec's
 * grammar now grants them once rather than twice: a tab separates as a space
 * does, a `%%` that begins the HOST's own inline run needs no separator, and the
 * whole separating run is consumed with the comment. `headingSpComment` and
 * `headingInitialComment` were deleted over it, so a heading reads what a
 * paragraph reads.
 *
 * A LEAF HOST IS WHAT MAKES IT VISIBLE. A definition term, a table cell, a
 * figure caption, a div label, an admonition title and a link label each begin
 * their run mid-line, so nothing at the block layer covers the marker there. A
 * paragraph's run begins at a line start, where the `%%` LINE form already
 * reaches it, which is why the gap sat unseen.
 *
 * THE HOST'S RUN, NOT A NESTED ONE. Inside emphasis the marker has the opening
 * delimiter in front of it, which separates nothing, so `/%% b/` keeps its text.
 * That half was read correctly by carve-js#2312 and is unchanged.
 *
 * Expectations derived from the oracle - `scripts/spec/layout.mjs` into
 * `scripts/spec/html.mjs` in markup-carve/carve at `24b5e77a` - run rather than
 * read, on every row below.
 */
describe('a trailing comment takes its separator', () => {
  it.each([
    ['a space', 'x %% b\n', '<p>x</p>'],
    ['the line break that puts it first on a later line', 'x\n%% b\n', '<p>x</p>'],
    ['a tab', 'x\t%% b\n', '<p>x</p>'],
    ['a space and a tab together', 'x \t%% b\n', '<p>x</p>'],
    ['a tab and a space together', 'x\t %% b\n', '<p>x</p>'],
    ['the whole run of two spaces', 'x  %% b\n', '<p>x</p>'],
  ])('takes %s', (_name, source, html) => {
    expect(carveToHtml(source)).toBe(html)
  })

  it.each([
    ['a no-break space', 'x %% b\n', '<p>x&nbsp;%% b</p>'],
    ['text running straight into it', 'x%% b\n', '<p>x%% b</p>'],
  ])('takes no comment behind %s', (_name, source, html) => {
    expect(carveToHtml(source)).toBe(html)
  })
})

describe('a host run start needs no separator', () => {
  it.each([
    ['a link label', '[%% b](u)\n', '<p><a href="u"></a></p>'],
    ['an attributed span', '[%% b]{.c}\n', '<p><span class="c"></span></p>'],
    [
      'a table cell',
      '| %% b |\n',
      '<table>\n  <tbody>\n    <tr><td></td></tr>\n  </tbody>\n</table>',
    ],
    ['a definition term', ':: %% b\n: d\n', '<dl>\n  <dt></dt>\n  <dd>d</dd>\n</dl>'],
    [
      'a div label',
      '::: note [%% b]\nx\n:::\n',
      '<aside class="admonition note" aria-label="Note">\n  <p class="div-label"></p>\n  <p>x</p>\n</aside>',
    ],
    [
      'an admonition title',
      '::: note "%% b"\nx\n:::\n',
      '<aside class="admonition note" aria-labelledby="adm-1">\n' +
        '  <p class="admonition-title" id="adm-1"></p>\n  <p>x</p>\n</aside>',
    ],
    [
      'a figure caption',
      '::: figure\n![a](i)\n^ %% b\n:::\n',
      '<figure class="carve-figure-group">\n  <figure class="carve-figure-panel">\n' +
        '    <img src="i" alt="a">\n    <figcaption></figcaption>\n  </figure>\n</figure>',
    ],
    ['a line block stanza', '::: |\n%% b\n:::\n', '<div class="line-block">\n  <p></p>\n</div>'],
  ])('opens a comment in %s', (_name, source, html) => {
    expect(carveToHtml(source)).toBe(html)
  })

  it.each([
    ['emphasis', '/%% b/\n', '<p><em>%% b</em></p>'],
    ['a strong run', '*%% b*\n', '<p><strong>%% b</strong></p>'],
  ])('leaves the text where a nested run opens with it in %s', (_name, source, html) => {
    expect(carveToHtml(source)).toBe(html)
  })

  it.each([
    ['a separator inside emphasis', '/ %% b/\n', '<p>/</p>'],
    ['a separator after text in a link label', '[x %% b](u)\n', '<p><a href="u">x</a></p>'],
    ['a later line of a nested run', '/a\n%% b/\n', '<p>/a</p>'],
  ])('still comments behind %s', (_name, source, html) => {
    expect(carveToHtml(source)).toBe(html)
  })
})

describe('a heading reads the shared rule', () => {
  it.each([
    ['a tab', '# x\t%% b\n', '<section id="x">\n  <h1>x</h1>\n</section>'],
    ['its own run start', '# %% b\n', '<section id="s">\n  <h1></h1>\n</section>'],
    ['a tab inside a run on its line', '# /a\t%% b/\n', '<section id="a">\n  <h1>/a</h1>\n</section>'],
    ['a run of two spaces', '# x  %% b\n', '<section id="x">\n  <h1>x</h1>\n</section>'],
  ])('drops a comment behind %s', (_name, source, html) => {
    expect(carveToHtml(source)).toBe(html)
  })

  it('leaves a nested run that opens with the marker alone', () => {
    expect(carveToHtml('# /%% b/\n')).toBe('<section id="b">\n  <h1><em>%% b</em></h1>\n</section>')
  })
})

/*
 * The thirteen rows of corpus 518 verbatim. The pinned spec `e24e38e9` predates
 * them, so the corpus runner does not see them until the pin bump lands, and its
 * comparison trims both sides where the trailing-run property needs them kept.
 */
describe('corpus 518', () => {
  it.each([
    ['row 1', 'a\t%% hidden\n', '<p>a</p>'],
    ['row 2', 'a  %% hidden\n', '<p>a</p>'],
    ['row 3', ':: a\t%% hidden\n: d\n', '<dl>\n  <dt>a</dt>\n  <dd>d</dd>\n</dl>'],
    ['row 4', ':: %% hidden\n: d\n', '<dl>\n  <dt></dt>\n  <dd>d</dd>\n</dl>'],
    ['row 5', '| a\t%% hidden | b |\n|---|---|\n| 1 | 2 |\n', '<table>\n  <thead>\n    <tr><th scope="col">a</th><th scope="col">b</th></tr>\n  </thead>\n  <tbody>\n    <tr><td>1</td><td>2</td></tr>\n  </tbody>\n</table>'],
    ['row 6', '| %% hidden | b |\n|---|---|\n| 1 | 2 |\n', '<table>\n  <thead>\n    <tr><th scope="col"></th><th scope="col">b</th></tr>\n  </thead>\n  <tbody>\n    <tr><td>1</td><td>2</td></tr>\n  </tbody>\n</table>'],
    ['row 7', '![alt](u)\n^ cap\t%% hidden\n', '<figure>\n  <img src="u" alt="alt">\n  <figcaption>cap</figcaption>\n</figure>'],
    ['row 8', '![alt](u)\n^ %% hidden\n', '<figure>\n  <img src="u" alt="alt">\n  <figcaption></figcaption>\n</figure>'],
    ['row 9', '::: note [a\t%% hidden]\nbody\n:::\n', '<aside class="admonition note" aria-label="Note">\n  <p class="div-label">a</p>\n  <p>body</p>\n</aside>'],
    ['row 10', '::: note [%% hidden]\nbody\n:::\n', '<aside class="admonition note" aria-label="Note">\n  <p class="div-label"></p>\n  <p>body</p>\n</aside>'],
    ['row 11', 'a%%b and 50%% stay\n', '<p>a%%b and 50%% stay</p>'],
    ['row 12', '[a\t%% hidden](/u)\n', '<p><a href="/u">a</a></p>'],
    ['row 13', '[%% hidden](/u)\n', '<p><a href="/u"></a></p>'],
  ])('reproduces %s', (_name, source, html) => {
    expect(carveToHtml(source).trim()).toBe(html)
  })
})
