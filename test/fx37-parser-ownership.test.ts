import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('parser ownership across nested marker bodies', () => {
  it('folds a line below a nested first-block plus into that plus', () => {
    const html = carveToHtml(':: t\n: - - +\n  x\n')
    expect(html).toBe("<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li>\n        <ul>\n          <li></li>\n        </ul>\n      </li>\n    </ul>\n    <p>x</p>\n  </dd>\n</dl>")
  })

  // A marker below the note body column closes the note (PART 0 S3, carve#4860).
  it('opens the item list at a marker below a footnote (corpus 454-4)', () => {
    const html = carveToHtml('- body\n\n  [^g]: n\n   - item\n\nafter\n')
    expect(html).toContain('<li><p>body</p>\n    <ul>\n      <li>item</li>')
    expect(html).toContain('<p>after</p>')
  })

  it('keeps a refused quoted plus and its lazy continuation', () => {
    const html = carveToHtml('> > . > +\n> > . > +\n>  s\n')
    expect(html).toBe("<blockquote>\n  <blockquote>\n    <ol>\n      <li>\n        <blockquote>\n\n        </blockquote>\n      </li>\n      <li>\n        <blockquote>\n\n        </blockquote>\n      </li>\n    </ol>\n  </blockquote>\n  <p>s</p>\n</blockquote>")
  })

  it('drops only the residual source indent from a later term tail', () => {
    for (const marker of ['-', '*']) {
      const html = carveToHtml(`${marker} * :: t\n  : a\n    :: sibling\n    tail\n`)
      expect(html).toContain('<dt>sibling</dt>')
    }
    const task = carveToHtml('* [ ] - :: t\n       : a\n       :: sibling\n       tail\n')
    expect(task).toContain('<dt>sibling</dt>')
  })

  it('ends a nested item claim after a wrapped attribute closes', () => {
    const html = carveToHtml('- - a\n   {c\n    }\nx\n')
    expect(html).toContain('<li>a</li>')
    expect(html).toContain('</ul>\n<p>x</p>')
  })

  it('refuses column-zero heading and quote followers inside a description list', () => {
    expect(carveToHtml(':: t\n: - +\n# H\n')).toBe("<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li></li>\n    </ul>\n  </dd>\n</dl>\n<section id=\"H\">\n  <h1>H</h1>\n</section>")
    expect(carveToHtml(':: t\n: - +\n> b\n')).toBe("<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li></li>\n    </ul>\n  </dd>\n</dl>\n<blockquote><p>b</p></blockquote>")
  })

  it('ends an open footnote paragraph at a below-column list marker', () => {
    const html = carveToHtml('- - a\n    [^n]: x\n    q\n   - li\n\nsee[^n]\n')
    expect(html).toContain('<p>x\nq<a href="#fnref1"')
    expect(html).toContain('<li>a</li>')
  })

  it('keeps a refused trailing plus in the paragraph attached by the first plus', () => {
    const html = carveToHtml('> - q\n> +\n> x\n> +\n')
    expect(html).toBe("<blockquote>\n  <ul>\n    <li>q\n      x\n    </li>\n  </ul>\n</blockquote>")
    expect(html).not.toContain('<p>+</p>')
  })

  // The marker opens a list in the description body below the note (PART 0 S3, carve#4860).
  it('opens a list in the description at a marker below its note', () => {
    const html = carveToHtml('- q\n  :: t\n  :  [^f]: note\n     - nested\n  after\n')
    expect(html).toContain('<dd>\n        <ul>\n          <li>nested\nafter</li>')
  })

})
