import { describe, expect, it } from 'vitest'
import { render } from '../src/index.ts'

describe('C2-H-081, C2-H-085: an unresolved reference inside link text writes its ordinary text (carve#6455)', () => {
  it.each([
    ['[[a][k]](u)', '<p><a href="u">[a][k]</a></p>'],
    ['[outer [x][]](/u)', '<p><a href="/u">outer [x][]</a></p>'],
    ['x ![[[a][k]](u)', '<p>x ![<a href="u">[a][k]</a></p>'],
    ['[[a][k]{.c}](u)', '<p><a href="u">[a][k]{.c}</a></p>'],
    ['[a [b][k]][r]\n\n[r]: /r', '<p><a href="/r">a [b][k]</a></p>'],
  ])('renders %j', (source, html) => {
    expect(render(source)).toBe(html)
  })

  it('unwraps a resolved reference inside link text', () => {
    expect(render('[[a][b]](u)\n\n[b]: /b')).toBe('<p><a href="u">a</a></p>')
  })
})
