import { describe, expect, it } from 'vitest'
import { markdownToCarve } from '../src/markdown-migrate.js'
import { carveToHtml } from '../src/index.js'

/**
 * A setext heading inside a block quote or a list item has to migrate as a
 * heading, the same way one at the top level does.
 *
 * Every `CommonMark reads` note below is the output of `commonmark` 0.31.2, the
 * reference implementation, not of this engine. Measuring an importer against
 * the parser it feeds answers the wrong question - see carve-js#1045 - so the
 * readings are recorded here as comments and the assertions pin the bytes the
 * migrator writes plus the HTML Carve then renders from them.
 *
 * The `-` underline is the severe half: left alone, `-----` is a thematic break
 * on the line it lands on, so the migrated document lost the heading AND gained
 * an `<hr>` nobody wrote.
 */
describe('markdownToCarve — a setext heading a container holds', () => {
  it('converts an `=` underline inside a block quote', () => {
    // CommonMark reads: <blockquote>\n<h1>Title</h1>\n</blockquote>
    expect(markdownToCarve('> Title\n> =====\n')).toBe('> # Title\n')
    expect(carveToHtml('> # Title\n')).toBe(
      '<blockquote>\n  <h1 id="Title">Title</h1>\n</blockquote>',
    )
  })

  it('converts a `-` underline inside a block quote, fabricating no rule', () => {
    // CommonMark reads: <blockquote>\n<h2>Title</h2>\n</blockquote>
    const out = markdownToCarve('> Title\n> -----\n')
    expect(out).toBe('> ## Title\n')
    expect(out).not.toContain('---')
    expect(carveToHtml(out)).toBe('<blockquote>\n  <h2 id="Title">Title</h2>\n</blockquote>')
  })

  it('converts inside a nested block quote at the quote’s own depth', () => {
    // CommonMark reads a nested h1, and a nested h2 for the `-` underline.
    expect(markdownToCarve('> > Title\n> > =====\n')).toBe('> > # Title\n')
    expect(markdownToCarve('> > Title\n> > -----\n')).toBe('> > ## Title\n')
    expect(markdownToCarve('> > > T\n> > > ===\n')).toBe('> > > # T\n')
  })

  it('converts when the quote marker carries no space', () => {
    // CommonMark reads: <blockquote>\n<h1>Title</h1>\n</blockquote>
    expect(markdownToCarve('>Title\n>=====\n')).toBe('> # Title\n')
  })

  it('converts at the end of a document with no trailing newline', () => {
    expect(markdownToCarve('> Title\n> ===')).toBe('> # Title')
  })

  it('converts after a blank quote line', () => {
    // CommonMark reads: <blockquote>\n<p>a</p>\n<h2>Title</h2>\n</blockquote>
    expect(markdownToCarve('> a\n>\n> Title\n> -----\n')).toBe('> a\n>\n> ## Title\n')
  })

  it('keeps the rest of the quote after the converted heading', () => {
    // CommonMark reads: <blockquote>\n<h1>Title</h1>\n<p>b</p>\n</blockquote>
    const out = markdownToCarve('> Title\n> ===\n>\n> b\n')
    expect(out).toBe('> # Title\n>\n> b\n')
    expect(carveToHtml(out)).toBe(
      '<blockquote>\n  <h1 id="Title">Title</h1>\n  <p>b</p>\n</blockquote>',
    )
  })

  it('converts an `=` underline inside a bullet item', () => {
    // CommonMark reads: <ul>\n<li>\n<h1>Title</h1>\n</li>\n</ul>
    const out = markdownToCarve('- Title\n  =====\n')
    expect(out).toBe('- # Title\n')
    expect(carveToHtml(out)).toBe('<ul>\n  <li>\n    <h1 id="Title">Title</h1>\n  </li>\n</ul>')
  })

  it('converts a `-` underline inside a bullet item, fabricating no rule', () => {
    // CommonMark reads: <ul>\n<li>\n<h2>Title</h2>\n</li>\n</ul>
    const out = markdownToCarve('- Title\n  -----\n')
    expect(out).toBe('- ## Title\n')
    expect(carveToHtml(out)).toBe('<ul>\n  <li>\n    <h2 id="Title">Title</h2>\n  </li>\n</ul>')
  })

  it('converts inside an ordered item', () => {
    // CommonMark reads an h1 for the `=` underline and an h2 for the `-` one.
    expect(markdownToCarve('1. Title\n   =====\n')).toBe('1. # Title\n')
    expect(markdownToCarve('1. Title\n   -----\n')).toBe('1. ## Title\n')
  })

  it('reads a one-character underline as an underline', () => {
    // CommonMark reads: <ul>\n<li>\n<h2>Title</h2>\n</li>\n</ul>
    expect(markdownToCarve('- Title\n  -\n')).toBe('- ## Title\n')
  })

  it('converts inside a nested item at that item’s own column', () => {
    // CommonMark reads an h1 in the inner item, not in the outer one.
    expect(markdownToCarve('- a\n\n  - Title\n    =====\n')).toBe('- a\n\n  - # Title\n')
  })

  it('keeps a following sibling item its own item', () => {
    // CommonMark reads: <ul>\n<li>\n<h1>T</h1>\n</li>\n<li>b</li>\n</ul>
    const out = markdownToCarve('- T\n  ===\n- b\n')
    expect(out).toBe('- # T\n- b\n')
    expect(carveToHtml(out)).toBe(
      '<ul>\n  <li>\n    <h1 id="T">T</h1>\n  </li>\n  <li>b</li>\n</ul>',
    )
  })

  it('converts a quote a list item holds', () => {
    // CommonMark reads: <ul><li><blockquote><h2>Title</h2></blockquote></li></ul>
    const out = markdownToCarve('- > Title\n  > -----\n')
    expect(out).toBe('- > ## Title\n')
    expect(carveToHtml(out)).toBe(
      '<ul>\n  <li>\n    <blockquote>\n      <h2 id="Title">Title</h2>\n    </blockquote>\n  </li>\n</ul>',
    )
  })

  it('converts a nested quote a list item holds', () => {
    // CommonMark reads an h1 two quotes deep inside the item.
    expect(markdownToCarve('- > > T\n  > > ===\n')).toBe('- > > # T\n')
  })

  it('converts the heading text’s inlines with it', () => {
    // CommonMark reads: <blockquote>\n<h1><em>bold</em> T</h1>\n</blockquote>
    expect(markdownToCarve('> *bold* T\n> ===\n')).toBe('> # /bold/ T\n')
    expect(markdownToCarve('- _em_ T\n  ===\n')).toBe('- # /em/ T\n')
  })
})

/**
 * The bounds. Each of these is NOT a setext heading in CommonMark, so the
 * migrator has to leave it alone - a conversion here would be a new defect in
 * place of the old one.
 */
describe('markdownToCarve — what is not a setext heading in a container', () => {
  it('leaves an underline four columns past the quote’s content', () => {
    // CommonMark reads: <blockquote>\n<p>Title\n=====</p>\n</blockquote>
    // Four columns in is code, not an underline.
    expect(markdownToCarve('> Title\n>     =====\n')).toBe('> Title\n>     =====\n')
  })

  it('accepts one to three columns of slack inside a quote', () => {
    // CommonMark reads: <blockquote>\n<h1>Title</h1>\n</blockquote>
    expect(markdownToCarve('> Title\n>    =====\n')).toBe('> # Title\n')
  })

  it('leaves an underline four columns past the item’s content', () => {
    // CommonMark reads: <ul>\n<li>Title\n=====</li>\n</ul>
    expect(markdownToCarve('- Title\n      =====\n')).toBe('- Title\n      =====\n')
  })

  it('leaves two thematic breaks in a quote as two rules', () => {
    // CommonMark reads: <blockquote>\n<hr />\n<hr />\n</blockquote> - `***`
    // over `---` is two rules, not an h2 titled `***`.
    const out = markdownToCarve('> ***\n> ---\n')
    expect(out).toBe('> ---\n> ---\n')
    expect(carveToHtml(out)).toBe('<blockquote>\n  <hr>\n  <hr>\n</blockquote>')
  })

  it('leaves an underline with no paragraph line above it in the quote', () => {
    // CommonMark reads: <blockquote>\n<p>===</p>\n</blockquote>
    expect(markdownToCarve('>\n> ===\n')).toBe('>\n> ===\n')
  })

  it('leaves a line that is not all `=` or all `-`', () => {
    // CommonMark reads: <blockquote>\n<p>T\n=-=</p>\n</blockquote>
    expect(markdownToCarve('> T\n> =-=\n')).toBe('> T\n> \\=-=\n')
  })

  it('does not fold an underline onto a heading it already wrote', () => {
    // CommonMark reads: <blockquote>\n<h1>T</h1>\n<p>===</p>\n</blockquote>
    expect(markdownToCarve('> T\n> ===\n> ===\n')).toBe('> # T\n> ===\n')
  })

  it('does not fold an underline onto an authored ATX heading', () => {
    // CommonMark reads: <blockquote>\n<h1>T</h1>\n<p>===</p>\n</blockquote>
    expect(markdownToCarve('> # T\n> ===\n')).toBe('> # T\n> ===\n')
  })

  it('leaves the first line of a fenced code block a quote holds', () => {
    // CommonMark reads: <blockquote>\n<pre><code>===\n</code></pre>\n</blockquote>
    // The `===` is the code's own first line, not an underline.
    expect(markdownToCarve('> ```\n> ===\n> ```\n')).toBe('> ```\n> ===\n> ```\n')
  })

  it('leaves the first line of a fenced code block a list item holds', () => {
    // CommonMark reads: <ul>\n<li>\n<pre><code>===\n</code></pre>\n</li>\n</ul>
    expect(markdownToCarve('- ```\n  ===\n  ```\n')).toBe('- ```\n  ===\n\n  ```\n')
    expect(markdownToCarve('- > ```\n  > ===\n  > ```\n')).toBe('- > ```\n  > ===\n  > ```\n')
  })

  it('leaves a list marker a quote holds', () => {
    // CommonMark reads: <blockquote>\n<ul>\n<li>a\n===</li>\n</ul>\n</blockquote>
    // An underline cannot reach the item's paragraph from outside the item.
    expect(markdownToCarve('> - a\n> ===\n')).toBe('> - a\n> ===\n')
    expect(markdownToCarve('> 2. a\n> ===\n')).toBe('> 2. a\n> ===\n')
  })

  it('leaves a link reference definition a quote holds', () => {
    // CommonMark reads: <blockquote>\n<p>===</p>\n</blockquote> - the
    // definition is consumed and the `===` is a paragraph of its own.
    expect(markdownToCarve('> [a]: /x\n> ===\n')).toBe('> [a]: /x\n> ===\n')
  })

  it('does not pair two lines at different quote depths', () => {
    // CommonMark reads the underline as a lazy continuation of the inner
    // paragraph, not as a heading for it.
    expect(markdownToCarve('> > T\n> ===\n')).toBe('> > T\n> ===\n')
  })
})

/**
 * The controls. These already worked, and are what make the above a defect
 * rather than a limitation: the conversion exists, and the container was what
 * it failed on.
 */
describe('markdownToCarve — setext controls that already held', () => {
  it('converts a setext heading at the top level', () => {
    // CommonMark reads: <h1>Title</h1> and <h2>Title</h2>
    expect(markdownToCarve('Title\n=====\n')).toBe('# Title\n')
    expect(markdownToCarve('Title\n-----\n')).toBe('## Title\n')
  })

  it('keeps an ATX heading a quote holds', () => {
    // CommonMark reads: <blockquote>\n<h1>Title</h1>\n</blockquote>
    expect(markdownToCarve('> # Title\n')).toBe('> # Title\n')
  })

  it('keeps a thematic break a quote holds', () => {
    // CommonMark reads: <blockquote>\n<hr />\n</blockquote>
    expect(markdownToCarve('> ---\n')).toBe('> ---\n')
  })
})

/**
 * A setext heading whose text runs over more than one line has no target in
 * Carve, whose heading is a single line. The top level already approximates it
 * by making the line ABOVE the underline the heading and leaving the earlier
 * lines a paragraph, and a container now does exactly the same rather than
 * inventing a second behavior for the same input.
 */
describe('markdownToCarve — a multi-line setext heading is approximated', () => {
  it('approximates the same way at the top level and in a quote', () => {
    // CommonMark reads a single <h1> carrying `One\nTwo` in both cases.
    expect(markdownToCarve('One\nTwo\n=====\n')).toBe('One\n\n# Two\n')
    expect(markdownToCarve('> One\n> Two\n> =====\n')).toBe('> One\n> # Two\n')
  })

  it('approximates the same way in a list item', () => {
    // CommonMark reads: <ul>\n<li>\n<h1>a\nb</h1>\n</li>\n</ul>
    expect(markdownToCarve('- a\n  b\n  ===\n')).toBe('- a\n  # b\n')
  })
})
