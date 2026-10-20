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

  it.each(['> +', '>+', '> > +', '>> +'])('accepts %s', marker => {
    expect(carveToHtml(`${marker}\npara`)).toContain('<p>para</p>')
    expect(carveToHtml(`${marker}\npara`)).not.toContain('<p>+</p>')
  })

  it.each(['> +', '>+', '> > +'])('keeps a later quoted plus as text with %s', marker => {
    const lead = marker === '> > +' ? '> > q' : '> q'
    const html = carveToHtml(`${lead}\n${marker}\npara`)
    expect(html).toContain('<p>q\n+\npara</p>')
  })

  it('keeps extra space after a quote marker as text', () => {
    expect(carveToHtml('>   +\n> para')).toContain('<p>+\npara</p>')
    expect(carveToHtml('> + \npara')).toContain('<p>para</p>')
    expect(carveToHtml('- a\n+ \nb')).toContain('<li>a\n    b\n  </li>')
  })

  it('keeps an indented plus in an open nested fence', () => {
    expect(carveToHtml('- a\n  - ```\n    +\n    payload')).toContain('<pre><code>+\npayload</code></pre>')
  })

  it('does not admit an indented quote plus as a marker', () => {
    expect(carveToHtml('- a\n  > +\npara')).toContain('<blockquote><p>+\npara</p></blockquote>')
    expect(carveToHtml('- a\n  - +\nflush')).toBe('<ul>\n  <li>a\n    <ul>\n      <li></li>\n    </ul>\n  </li>\n</ul>\n<p>flush</p>')
    expect(carveToHtml('- a\n  - > +\nflush')).toContain('<p>flush</p>')
  })

  it.each(['- > +', '1. > +', '- > > +', '- [ ] > +', ':: t\n: > +'])(
    'keeps the stacked first-block form %s', opener => {
      expect(carveToHtml(`${opener}\nflush`)).toContain('<p>flush</p>')
      expect(carveToHtml(`${opener}\nflush`)).not.toContain('<p>+\nflush</p>')
    },
  )

  it('keeps the item first-block form with trailing space', () => {
    expect(carveToHtml('- + \nflush')).toContain('<li>flush</li>')
  })

  it.each(['- - +', '- > +', '> - +', '1. - +'])(
    'attaches a flush-left block to the last opener in %s', opener => {
      const html = carveToHtml(`${opener}\nflush`)
      expect(html).toMatch(/<li>flush<\/li>|<p>flush<\/p>/)
      expect(html).not.toContain('<p>+</p>')
    },
  )

  it('keeps a stacked first-block quote inside another quote', () => {
    const html = carveToHtml('> - > +\n> flush')
    expect(html).toContain('<p>flush</p>')
    expect(html).not.toContain('<p>+\nflush</p>')
  })

  it.each(['a. > +', 'i. > +', 'A) > +'])('accepts ordered opener %s', opener => {
    expect(carveToHtml(`${opener}\nflush`)).toContain('<p>flush</p>')
    expect(carveToHtml(`${opener}\nflush`)).not.toContain('<p>+\nflush</p>')
  })
})
