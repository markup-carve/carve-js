import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// ---------------------------------------------------------------------------
// THE `[label]` SLOT CLOSES ON A BALANCED BRACKET
// (markup-carve/carve#2576, markup-carve/carve-js#2343).
//
// The `label` production takes a balanced run. The slot was written flat as
// `\[[^\]]*\]` in the colon opener and in the fence info line - the two
// spellings of that one production - so a label holding a nested bracket, an
// escaped `]` or a `]` inside a code span ended at the first `]` and the whole
// line fell back to prose.
//
// The check is `buildBracketMap`, the scan the inline pass resolves a link label
// with, so the two agree by construction rather than by a comment. Nesting is
// therefore unbounded here, which a hand-spelled pattern could not have been.
//
// ONE SHAPE GOES THE OTHER WAY. A label holding an UNCLOSED backtick run stays
// prose: the run swallows the closer, which is what a link text does with the
// same bytes. The spec fix asserts the pair together, so both are here.
//
// Measured against the executable spec (scripts/spec/layout.mjs into
// scripts/spec/html.mjs) at markup-carve/carve e778d33a, which reproduces its
// own corpus 2078/2078.
// ---------------------------------------------------------------------------

const html = (src: string): string => carveToHtml(src).trim()

const NOTE = (label: string): string =>
  `<aside class="admonition note" aria-label="Note">\n  <p class="div-label">${label}</p>\n  <p>body</p>\n</aside>`

describe('a colon opener label closes on a balanced bracket', () => {
  it.each([
    ['a nested bracket', '::: note [a [b] c]\nbody\n:::\n', NOTE('a [b] c')],
    ['two nested brackets', '::: note [a [b] [c] d]\nbody\n:::\n', NOTE('a [b] [c] d')],
    // Unbounded nesting: the check is the reader's own scan, not a pattern that
    // spells one level of nesting and stops.
    ['a bracket nested twice', '::: note [a [b [c] d] e]\nbody\n:::\n', NOTE('a [b [c] d] e')],
  ])('%s is label text', (_name, source, expected) => {
    expect(html(source)).toBe(expected)
  })

  it('reads a bare opener the same way', () => {
    expect(html('::: [a [b] c]\nbody\n:::\n')).toBe(
      '<div>\n  <p class="div-label">a [b] c</p>\n  <p>body</p>\n</div>',
    )
  })

  it('reads a label glued to the fence the same way', () => {
    expect(html(':::[a [b] c]\nbody\n:::\n')).toBe(
      '<div>\n  <p class="div-label">a [b] c</p>\n  <p>body</p>\n</div>',
    )
  })

  it('reads a label after a quoted title the same way', () => {
    expect(html('::: note "t" [a [b] c]\nbody\n:::\n')).toBe(
      '<aside class="admonition note" aria-labelledby="adm-1">\n' +
        '  <p class="admonition-title" id="adm-1">t</p>\n' +
        '  <p class="div-label">a [b] c</p>\n  <p>body</p>\n</aside>',
    )
  })

  // THE SHAPE THAT STAYS PROSE. The unclosed run reaches the end of the line, so
  // there is no closer for the slot, and the line is the paragraph it looks like.
  it('drops an invalid typed label and keeps an unrecognized typeless label as prose', () => {
    expect(html('::: note [a ` b]\nbody\n:::\n')).toBe(
      '<aside class="admonition note" aria-label="Note">\n  <p>body</p>\n</aside>',
    )
    expect(html('::: [a ` b]\nbody\n:::\n')).toBe('<p>::: [a <code> b]\nbody\n:::</code></p>')
  })

  // The two shapes the ticket names as unchanged. A run that closes before the
  // end of the line leaves text behind it, and a run with no closer at all is not
  // a run: neither is a label, before or after.
  it.each([
    ['trailing text after the run', '::: note [a] b]\nbody\n:::\n', '<aside class="admonition note" aria-label="Note">\n  <p>body</p>\n</aside>'],
    ['no closer at all', '::: note [a\nbody\n:::\n', '<aside class="admonition note" aria-label="Note">\n  <p>body</p>\n</aside>'],
  ])('%s drops metadata and keeps the container', (_name, source, expected) => {
    expect(html(source)).toBe(expected)
  })

  it('reads a label with no bracket in it as it always did', () => {
    expect(html('::: note [a]\nbody\n:::\n')).toBe(NOTE('a'))
  })
})

describe('the fence info line reads the same production', () => {
  // Both spellings of one `label`, which is the whole point of fixing them
  // together: the fence keeps its language and its payload where the colon
  // opener keeps its label.
  const JS = '<pre><code class="language-js">q\n</code></pre>'

  it.each([
    ['a nested bracket', '``` js [a [b] c]\nq\n```\n', JS],
    ['an escaped bracket', '``` js [a \\] b]\nq\n```\n', JS],
    ['a bracket inside a code span', '``` js [a `]` b]\nq\n```\n', JS],
    ['no bracket in the label', '``` js [a]\nq\n```\n', JS],
    ['a label with no language', '``` [a [b] c]\nq\n```\n', '<pre><code>q\n</code></pre>'],
    ['a label after a quoted title', '``` "t" [a [b] c]\nq\n```\n', '<pre title="t"><code>q\n</code></pre>'],
  ])('%s opens the fence', (_name, source, expected) => {
    expect(html(source)).toBe(expected)
  })

  it.each([
    ['an unclosed backtick run', '``` js [a ` b]\nq\n```\n', '<p><code> js [a ` b]\nq\n</code></p>'],
    ['trailing text after the run', '``` js [a] b]\nq\n```\n', '<p><code> js [a] b]\nq\n</code></p>'],
  ])('%s leaves the line as prose', (_name, source, expected) => {
    expect(html(source)).toBe(expected)
  })
})

describe('the label a container renders', () => {
  // THE SLOT IS FIXED HERE, AND THE LABEL'S OWN RENDERING NOW AGREES WITH THE
  // ORACLE TOO: a container label is an inline run (markup-carve/carve#2572,
  // ported for markup-carve/carve-js#2348), so the bracket the slot admitted is
  // resolved and the code span is a span. The two questions were separate and
  // these rows are where they meet.
  it('resolves an escaped bracket taken into the label', () => {
    expect(html('::: note [a \\] b]\nbody\n:::\n')).toBe(NOTE('a ] b'))
  })

  it('reads a code span taken into the label as a span', () => {
    expect(html('::: note [a `]` b]\nbody\n:::\n')).toBe(NOTE('a <code>]</code> b'))
  })
})
