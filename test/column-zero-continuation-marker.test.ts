import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const ruledOutput = new Map<string, string>([
  [
    "- a\n  - +\nflush",
    "<ul>\n  <li>a\n    <ul>\n      <li></li>\n    </ul>\n  </li>\n</ul>\n<p>flush</p>"
  ],
  [
    "- a\n  - > +\nflush",
    "<ul>\n  <li>a\n    <ul>\n      <li>\n        <blockquote>\n\n        </blockquote>\n      </li>\n    </ul>\n  </li>\n</ul>\n<p>flush</p>"
  ],
  [
    "> - > +\n> flush",
    "<blockquote>\n  <ul>\n    <li>\n      <blockquote>\n\n      </blockquote>\n    </li>\n  </ul>\n  <p>flush</p>\n</blockquote>"
  ],
  [
    "- > +\nflush",
    "<ul>\n  <li>\n    <blockquote>\n\n    </blockquote>\n  </li>\n</ul>\n<p>flush</p>"
  ],
  [
    "1. > +\nflush",
    "<ol>\n  <li>\n    <blockquote>\n\n    </blockquote>\n  </li>\n</ol>\n<p>flush</p>"
  ],
  [
    "- > > +\nflush",
    "<ul>\n  <li>\n    <blockquote>\n      <blockquote>\n\n      </blockquote>\n    </blockquote>\n  </li>\n</ul>\n<p>flush</p>"
  ],
  [
    "- [ ] > +\nflush",
    "<ul class=\"task-list\">\n  <li><input type=\"checkbox\" disabled> \n    <blockquote>\n\n    </blockquote>\n  </li>\n</ul>\n<p>flush</p>"
  ],
  [
    ":: t\n: > +\nflush",
    "<dl>\n  <dt>t</dt>\n  <dd>\n    <blockquote>\n\n    </blockquote>\n  </dd>\n</dl>\n<p>flush</p>"
  ],
  [
    "- - +\nflush",
    "<ul>\n  <li>\n    <ul>\n      <li></li>\n    </ul>\n  </li>\n</ul>\n<p>flush</p>"
  ],
  [
    "> - +\nflush",
    "<blockquote>\n  <ul>\n    <li></li>\n  </ul>\n</blockquote>\n<p>flush</p>"
  ],
  [
    "1. - +\nflush",
    "<ol>\n  <li>\n    <ul>\n      <li></li>\n    </ul>\n  </li>\n</ol>\n<p>flush</p>"
  ],
  [
    "a.  > +\nflush",
    "<ol type=\"a\">\n  <li>\n    <blockquote>\n\n    </blockquote>\n  </li>\n</ol>\n<p>flush</p>"
  ],
  [
    "i.  > +\nflush",
    "<ol type=\"i\">\n  <li>\n    <blockquote>\n\n    </blockquote>\n  </li>\n</ol>\n<p>flush</p>"
  ],
  [
    "A) > +\nflush",
    "<ol type=\"A\" data-delim=\")\">\n  <li>\n    <blockquote>\n\n    </blockquote>\n  </li>\n</ol>\n<p>flush</p>"
  ]
])

describe('column-zero continuation markers', () => {
  it('keeps an indented plus in the nested item paragraph', () => {
    expect(carveToHtml('- a\n  - b\n  +\npara')).toBe("<ul>\n  <li>a\n    <ul>\n      <li>b</li>\n    </ul>\n  </li>\n</ul>\n<p>para</p>")
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
    expect(carveToHtml('> > +\npara')).toBe("<blockquote>\n  <blockquote>\n\n  </blockquote>\n</blockquote>\n<p>para</p>")
  })

  it.each(['> +', '> > +'])('keeps a later quoted plus as text with %s', marker => {
    const lead = marker === '> > +' ? '> > q' : '> q'
    const html = carveToHtml(`${lead}\n${marker}\npara`)
    expect(html).toContain('<p>q\n+\npara</p>')
  })

  it('leaves a plus past the one space after a quote marker as text', () => {
    expect(carveToHtml('>   +\n> para')).toContain('<blockquote><p>+\npara</p></blockquote>')
    expect(carveToHtml('> + \npara')).toContain('<p>para</p>')
    expect(carveToHtml('- a\n+ \nb')).toContain('<li>a\n    b\n  </li>')
  })

  it('keeps an indented plus in an open nested fence', () => {
    expect(carveToHtml('- a\n  - ```\n    +\n    payload')).toContain('<pre><code>+\npayload</code></pre>')
  })

  it('refuses a column-zero paragraph after an indented plus', () => {
    expect(carveToHtml('- a\n  > +\npara')).toBe("<ul>\n  <li>a\n    <blockquote>\n\n    </blockquote>\n  </li>\n</ul>\n<p>para</p>")
    expect(carveToHtml('- a\n  - +\nflush')).toBe(ruledOutput.get('- a\n  - +\nflush'))
    expect(carveToHtml('- a\n  - > +\nflush')).toBe(ruledOutput.get('- a\n  - > +\nflush'))
  })

  it.each(['- > +', '1. > +', '- > > +', '- [ ] > +', ':: t\n: > +'])(
    'refuses a column-zero follower of the stacked form %s', opener => {
      expect(carveToHtml(`${opener}\nflush`)).toBe(ruledOutput.get(`${opener}\nflush`))
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
      expect(html).toBe(ruledOutput.get(`${opener}\nflush`))
    },
  )

  it('refuses a prefixed follower left of a stacked quote inside another quote', () => {
    const html = carveToHtml('> - > +\n> flush')
    expect(html).toBe(ruledOutput.get('> - > +\n> flush'))
  })

  it.each(['a.  > +', 'i.  > +', 'A) > +'])('refuses a column-zero follower of ordered opener %s', opener => {
    expect(carveToHtml(`${opener}\nflush`)).toBe(ruledOutput.get(`${opener}\nflush`))
  })
})
