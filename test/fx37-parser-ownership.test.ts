import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('parser ownership across nested marker bodies', () => {
  it('folds a line below a nested first-block plus into that plus', () => {
    const html = carveToHtml(':: t\n: - - +\n  x\n')
    expect(html).toContain('<li>+\nx</li>')
  })

  it('folds a nested item below a footnote into the note (corpus 454-4)', () => {
    const html = carveToHtml('- body\n\n  [^g]: n\n   - item\n\nafter\n')
    expect(html).toContain('<li>body</li>')
    expect(html).toContain('<p>after</p>')
  })

  it('keeps a refused quoted plus and its lazy continuation', () => {
    const html = carveToHtml('> > . > +\n> > . > +\n>  s\n')
    expect(html).toContain('<blockquote><p>+\ns</p></blockquote>')
  })

  it('drops only the residual source indent from a later term tail', () => {
    for (const marker of ['-', '*']) {
      const html = carveToHtml(`${marker} * :: t\n  : a\n    :: sibling\n    tail\n`)
      expect(html).toContain('<dt>sibling\ntail</dt>')
    }
    const task = carveToHtml('* [ ] - :: t\n       : a\n       :: sibling\n       tail\n')
    expect(task).toContain('<dt>sibling\ntail</dt>')
  })

  it('ends a nested item claim after a wrapped attribute closes', () => {
    const html = carveToHtml('- - a\n   {c\n}\nx\n')
    expect(html).toContain('<li>a</li>')
    expect(html).toContain('</ul>\n<p>x</p>')
  })

  it('refuses column-zero heading and quote followers inside a description list', () => {
    expect(carveToHtml(':: t\n: - +\n# H\n')).toContain('<li>+</li>\n    </ul>\n  </dd>\n</dl>\n<section id="H">')
    expect(carveToHtml(':: t\n: - +\n> b\n')).toContain('<li>+</li>\n    </ul>\n  </dd>\n</dl>\n<blockquote><p>b</p></blockquote>')
  })

  it('ends an open footnote paragraph at a below-column list marker', () => {
    const html = carveToHtml('- - a\n    [^n]: x\n    q\n   - li\n\nsee[^n]\n')
    expect(html).toContain('<p>x\nq<a href="#fnref1"')
    expect(html).toContain('<li>a</li>')
  })

  it('keeps a refused trailing plus in the paragraph attached by the first plus', () => {
    const html = carveToHtml('> - q\n> +\n> x\n> +\n')
    expect(html).toContain('<li>q\n      x\n+\n    </li>')
    expect(html).not.toContain('<p>+</p>')
  })

  it('folds a below-floor marker into a description-hosted note', () => {
    const html = carveToHtml('- q\n  :: t\n  :  [^f]: note\n     - nested\n  after\n')
    expect(html).toContain('<dd></dd>')
  })

})
