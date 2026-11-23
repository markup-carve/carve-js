import { describe, expect, it } from 'vitest'
import { format, render } from '../public/index.ts'

describe('C2-B-123, C2-B-024: a comment block in a line block body opens no stanza', () => {
  const empty = '<div class="line-block">\n\n    </div>'

  it('closes the item at an unowned line after a leading comment block', () => {
    expect(render('- ::: |\n  %%%\n  c\n  %%%\nz\n')).toBe(`<ul>\n  <li>\n    ${empty}\n  </li>\n</ul>\n<p>z</p>`)
  })

  it('closes the quote at an unowned line after a leading comment block', () => {
    expect(render('> ::: |\n> %%%\n> c\n> %%%\nz\n')).toBe('<blockquote>\n  <div class="line-block">\n\n  </div>\n</blockquote>\n<p>z</p>')
  })

  it('opens no stanza after a blank line either', () => {
    expect(render('- ::: |\n  a\n\n  %%%\n  c\n  %%%\nz\n')).toBe(
      '<ul>\n  <li>\n    <div class="line-block">\n      <p>a</p>\n    </div>\n  </li>\n</ul>\n<p>z</p>',
    )
  })

  it('keeps a stanza that is already open', () => {
    expect(render('- ::: |\n  a\n  %%%\n  c\n  %%%\nz\n')).toBe(
      '<ul>\n  <li>\n    <div class="line-block">\n      <p>a<br>\nz</p>\n    </div>\n  </li>\n</ul>',
    )
  })

  it('writes the unowned line outside the item', () => {
    expect(format('- ::: |\n  %%%\n  c\n  %%%\nz\n')).toBe('- ::: |\n  %%%\n  c\n  %%%\n  :::\n\nz\n')
  })
})
