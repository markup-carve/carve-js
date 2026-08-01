import { describe, it, expect } from 'vitest'
import { carveToHtml, headingPermalinks } from '../src/index.js'

const flat = (s: string) => carveToHtml(s, { sections: false })

/**
 * The `sections` option (grammar PART 9 §13). Off, the renderer emits no
 * `<section>` wrapper: the id goes back on the `<h*>` and the blocks that
 * would have been section children stay as siblings, losing the indentation
 * they carried as container children.
 *
 * The invariant worth holding onto, and the reason the option is one branch
 * rather than a second renderer: with sections off, a top-level heading
 * renders exactly the way a heading inside a container has always rendered.
 * Several cases below assert that equivalence directly.
 */
describe('sections: false', () => {
  it('emits no wrapper and keeps the id on the heading', () => {
    expect(flat('# A\n\np\n')).toBe('<h1 id="A">A</h1>\n<p>p</p>')
  })

  it('defaults to wrapping, so existing callers are unaffected', () => {
    expect(carveToHtml('# A\n\np\n')).toBe(
      '<section id="A">\n  <h1>A</h1>\n  <p>p</p>\n</section>',
    )
    // An explicit `true` is the same as omitting it.
    expect(carveToHtml('# A\n\np\n', { sections: true })).toBe(carveToHtml('# A\n\np\n'))
  })

  it('flattens nested levels instead of nesting wrappers', () => {
    expect(flat('# A\n\np\n\n## B\n\nq\n')).toBe(
      '<h1 id="A">A</h1>\n<p>p</p>\n<h2 id="B">B</h2>\n<p>q</p>',
    )
  })

  it('flattens adjacent same-level headings', () => {
    expect(flat('# A\n\n# B\n')).toBe('<h1 id="A">A</h1>\n<h1 id="B">B</h1>')
  })

  it('flattens a skipped level (no synthesized intermediate heading)', () => {
    expect(flat('# A\n\n### C\n')).toBe('<h1 id="A">A</h1>\n<h3 id="C">C</h3>')
  })

  it('keeps non-id attributes on the heading, with the id appended for an auto slug', () => {
    expect(flat('{a=b .c}\n# Auto slug\n')).toBe('<h1 a="b" class="c" id="Auto-slug">Auto slug</h1>')
  })

  it('keeps an explicit id in its authored position', () => {
    expect(flat('{#x a=b}\n# Written\n')).toBe('<h1 id="x" a="b">Written</h1>')
  })

  it('renders an explicit empty id as an empty id on the heading', () => {
    expect(flat('{id=""}\n# T\n')).toBe('<h1 id="">T</h1>')
  })

  it('changes nothing in a document with no headings', () => {
    const src = 'just a paragraph\n\n- and a list\n'
    expect(flat(src)).toBe(carveToHtml(src))
  })

  it('leaves headings inside containers exactly as they already were', () => {
    const src = '> # Quoted\n>\n> Quoted body.\n\n:::\n# Divved\n:::\n'
    expect(flat(src)).toBe(carveToHtml(src))
  })

  it('makes a top-level heading render like the same heading inside a div', () => {
    // The equivalence the option is built on: one placement rule everywhere.
    const inDiv = carveToHtml(':::\n{a=b .c}\n# Same\n:::\n')
    expect(flat('{a=b .c}\n# Same\n')).toBe(
      inDiv
        .split('\n')
        .slice(1, -1)
        .map((l) => l.replace(/^ {2}/, ''))
        .join('\n'),
    )
  })

  it('resolves crossrefs and implicit heading references against the slug', () => {
    expect(flat('# Target\n\nSee </#target> and [Target][].\n')).toBe(
      '<h1 id="Target">Target</h1>\n' +
        '<p>See <a href="#Target">Target</a> and <a href="#Target">Target</a>.</p>',
    )
  })

  it('keeps the dedup namespace intact across the flattened document', () => {
    expect(flat('# abc\n\n> # abc\n\n# abc\n')).toBe(
      '<h1 id="abc">abc</h1>\n' +
        '<blockquote>\n  <h1 id="abc-2">abc</h1>\n</blockquote>\n' +
        '<h1 id="abc-3">abc</h1>',
    )
  })

  it('still emits the endnotes region, which is a different construct', () => {
    const out = flat('# A\n\nText[^n].\n\n[^n]: Note.\n')
    expect(out).toContain('<h1 id="A">A</h1>')
    expect(out).toContain('<section role="doc-endnotes">')
    expect(out).not.toContain('<section id=')
  })

  it('lets a heading extension renderer take over, and keeps the id on the <h*>', () => {
    // Without the wrapper the <h*> is the only element that can carry the id,
    // so a heading renderer that strips it (correct while wrapped, to avoid a
    // duplicate DOM id) would leave its own permalink href dangling.
    const out = carveToHtml('# A\n', {
      sections: false,
      extensions: [headingPermalinks()],
    })
    expect(out).not.toContain('<section')
    expect(out).toContain('<h1 id="A">')
    expect(out).toContain('href="#A"')
  })

  it('still strips the id from a permalinked heading while wrapped', () => {
    const out = carveToHtml('# A\n', { extensions: [headingPermalinks()] })
    expect(out).toContain('<section id="A">')
    expect(out).toContain('<h1>')
    expect(out).not.toContain('<h1 id=')
  })

  it('stamps source lines on the flattened blocks', () => {
    const out = carveToHtml('# A\n\np\n', { sections: false, sourceLine: true })
    expect(out).toBe(
      '<h1 id="A" data-source-line="1">A</h1>\n<p data-source-line="3">p</p>',
    )
  })
})
