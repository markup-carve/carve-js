import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('column-zero continuation markers', () => {
  it('keeps an indented plus in the nested item paragraph', () => {
    expect(carveToHtml('- a\n  - b\n  +\npara')).toContain('<li>b\n+\npara</li>')
  })

  it('attaches a column-zero block to the outer item', () => {
    expect(carveToHtml('- a\n  - b\n+\npara')).toContain('</ul>\n    para\n  </li>')
    expect(carveToHtml('> - a\n>   - b\n> +\n> para')).toContain('</ul>\n      para\n    </li>')
  })

  it('accepts > +', () => {
    expect(carveToHtml('> +\npara')).toContain('<p>para</p>')
    expect(carveToHtml('> +\npara')).not.toContain('<p>+</p>')
  })

  it('refuses > > +', () => {
    expect(carveToHtml('> > +\npara')).toContain('<p>+\npara</p>')
  })

  it.each(['> +', '> > +'])('keeps a later quoted plus as text with %s', marker => {
    const lead = marker === '> > +' ? '> > q' : '> q'
    const html = carveToHtml(`${lead}\n${marker}\npara`)
    expect(html).toContain('<p>q\n+\npara</p>')
  })

  it('attaches a quoted line below extra space after a quote marker', () => {
    expect(carveToHtml('>   +\n> para')).toContain('<blockquote>\n  <blockquote><p>para</p></blockquote>\n</blockquote>')
    expect(carveToHtml('> + \npara')).toContain('<p>para</p>')
    expect(carveToHtml('- a\n+ \nb')).toContain('<li>a\n    b\n  </li>')
  })

  it('keeps an indented plus in an open nested fence', () => {
    expect(carveToHtml('- a\n  - ```\n    +\n    payload')).toContain('<pre><code>+\npayload</code></pre>')
  })

  it('refuses a column-zero paragraph after an indented plus', () => {
    expect(carveToHtml('- a\n  > +\npara')).toContain('<blockquote><p>+\npara</p></blockquote>')
    expect(carveToHtml('- a\n  - +\nflush')).toBe('<ul>\n  <li>a\n    <ul>\n      <li>+\nflush</li>\n    </ul>\n  </li>\n</ul>')
    expect(carveToHtml('- a\n  - > +\nflush')).toContain('<p>+\nflush</p>')
  })

  it.each(['- > +', '1. > +', '- > > +', '- [ ] > +', ':: t\n: > +'])(
    'refuses a column-zero follower of the stacked form %s', opener => {
      expect(carveToHtml(`${opener}\nflush`)).toContain('<p>+\nflush</p>')
    },
  )

  it('keeps the item first-block form with trailing space', () => {
    expect(carveToHtml('- + \nflush')).toContain('<li>flush</li>')
  })

  it('attaches a column-zero list to a footnote first-block form', () => {
    const html = carveToHtml('note [^a]\n\n[^a]: +\n- a list')
    expect(html).toContain('<li id="fn1">\n      <ul>\n        <li>a list</li>\n      </ul>')
  })

  it('attaches a column-zero list to a description first-block form', () => {
    expect(carveToHtml(':: t\n: +\n- a list')).toBe(
      '<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li>a list</li>\n    </ul>\n  </dd>\n</dl>',
    )
  })

  it.each(['- - +', '- > +', '> - +', '1. - +'])(
    'refuses a flush-left block below the last opener in %s', opener => {
      const html = carveToHtml(`${opener}\nflush`)
      expect(html).toMatch(/<li>\+\nflush<\/li>|<p>\+\nflush<\/p>/)
    },
  )

  it('refuses a prefixed follower left of a stacked quote inside another quote', () => {
    const html = carveToHtml('> - > +\n> flush')
    expect(html).toContain('<p>+\nflush</p>')
  })

  it.each(['a. > +', 'i. > +', 'A) > +'])('refuses a column-zero follower of ordered opener %s', opener => {
    expect(carveToHtml(`${opener}\nflush`)).toContain('<p>+\nflush</p>')
  })
})
