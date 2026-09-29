import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// ---------------------------------------------------------------------------
// AN EMPHASIS MARKER DOES NOT PAIR ACROSS A BRACKET RUN
// (markup-carve/carve#2577, markup-carve/carve-js#2340).
//
// PART 8 ranks links at 5 and the bare emphasis markers at 7, so the bracket
// run resolves first and a marker inside it is label text by the time the
// delimiter stack reaches it. `/[a/](/u)` is therefore a link whose label ends
// in a slash, with the leading slash left unpaired.
//
// THE RANK BELONGS TO THE RUN, not to a resolved link: `/[a/]` with no
// destination and no definition is literal text too, and so is `/a [b/ c]`,
// where the brackets are prose. An UNBALANCED `[` is no run and hides nothing.
//
// Corpus category 522 pins three rows. Every expectation here is measured
// against the executable spec (scripts/spec/layout.mjs into
// scripts/spec/html.mjs) at markup-carve/carve e778d33a, which reproduces its
// own corpus 2078/2078.
// ---------------------------------------------------------------------------

const html = (src: string): string => carveToHtml(src).trim()

describe('an emphasis marker does not pair across a link bracket', () => {
  // All five bare markers. A fix keyed on the slash alone would pass one row.
  it.each([
    ['a slash', '/[a/](/u)\n', '<p>/<a href="/u">a/</a></p>'],
    ['a star', '*[a*](/u)\n', '<p>*<a href="/u">a*</a></p>'],
    ['an underscore', '_[a_](/u)\n', '<p>_<a href="/u">a_</a></p>'],
    ['a tilde', '~[a~](/u)\n', '<p>~<a href="/u">a~</a></p>'],
    ['an equals sign', '=[a=](/u)\n', '<p>=<a href="/u">a=</a></p>'],
  ])('%s before the bracket stays literal', (_name, source, expected) => {
    expect(html(source)).toBe(expected)
  })

  // Every construct a bracket run can become, and the two where it becomes
  // nothing. The run hides the marker in all of them.
  it.each([
    ['an inline link', '/[a/](/u)\n', '<p>/<a href="/u">a/</a></p>'],
    ['an image', '/![a/](/u)\n', '<p>/<img src="/u" alt="a/"></p>'],
    ['a reference link', '/[a/][r]\n\n[r]: /u\n', '<p>/<a href="/u">a/</a></p>'],
    ['a span', '/[a/]{.c}\n', '<p>/<span class="c">a/</span></p>'],
    ['a footnote-shaped run', '/[^a/]\n', '<p>/[^a/]</p>'],
    ['a run that resolves to nothing at all', '/[a/]\n', '<p>/[a/]</p>'],
  ])('%s hides the marker inside it', (_name, source, expected) => {
    expect(html(source)).toBe(expected)
  })

  it('reads a nested balanced run as one label', () => {
    expect(html('/[a [b/] c](/u)\n')).toBe('<p>/<a href="/u">a [b/] c</a></p>')
  })

  it('reads an escaped bracket as label text, not as the close', () => {
    expect(html('/[a\\]/](/u)\n')).toBe('<p>/<a href="/u">a]/</a></p>')
  })
})

describe('the controls that keep the marker pairing', () => {
  // The two rows corpus 522 carries as controls. Both already agreed in every
  // reader, which is what isolates the shape above.
  it.each([
    ['with no bracket at all', '/a/\n', '<p><em>a</em></p>'],
    ['around a whole link', '/[a](/u)/\n', '<p><em><a href="/u">a</a></em></p>'],
    ['inside a label', '[/a/](/u)\n', '<p><a href="/u"><em>a</em></a></p>'],
  ])('%s', (_name, source, expected) => {
    expect(html(source)).toBe(expected)
  })

  // AN UNBALANCED `[` IS NO RUN. This is what a fix that hid every bracket
  // would break, and it is the difference between a run and a stray opener.
  it.each([
    ['a bare opener', '/[a/\n', '<p><em>[a</em></p>'],
    ['a closer swallowed by a code span', '/[a/`]`b/\n', '<p><em>[a</em><code>]</code>b/</p>'],
  ])('%s still lets the marker close', (_name, source, expected) => {
    expect(html(source)).toBe(expected)
  })

  // A closer PAST the run still closes: the run is skipped, not a wall.
  it.each([
    ['after the run', '/[a/] b/\n', '<p><em>[a/] b</em></p>'],
    ['after prose brackets', '/a [b/ c] d/\n', '<p><em>a [b/ c] d</em></p>'],
  ])('a closer %s closes the emphasis', (_name, source, expected) => {
    expect(html(source)).toBe(expected)
  })

  // With the only closer inside the run there is nothing to pair with, and the
  // brackets here are prose rather than any construct.
  it('prose brackets hide a marker the same way', () => {
    expect(html('/a [b/ c]\n')).toBe('<p>/a [b/ c]</p>')
  })

  // The marker's own opener rules are untouched: a space after it does not open,
  // and an alphanumeric before it does not either.
  it.each([
    ['a space after the marker', '/ [a/](/u)\n', '<p>/ <a href="/u">a/</a></p>'],
    ['a word character before it', 'x/[a/](/u)\n', '<p>x/<a href="/u">a/</a></p>'],
  ])('%s leaves the marker literal for its own reason', (_name, source, expected) => {
    expect(html(source)).toBe(expected)
  })
})
