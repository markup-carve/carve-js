import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const html = (s: string) => carveToHtml(s)

describe('a definition list does not interrupt a paragraph or heading (§10)', () => {
  it('a `::` term after paragraph text folds as lazy text', () => {
    expect(html('para\n:: t\n:  d')).toBe('<p>para\n:: t\n:  d</p>')
  })

  it('a `::` term after a heading line folds into the heading', () => {
    expect(html('# H\n:: t\n:  d')).toBe(
      '<section id="H-t-d">\n  <h1>H\n:: t\n:  d</h1>\n</section>',
    )
  })

  it('a standalone definition list still parses', () => {
    expect(html(':: t\n:  d')).toBe(
      '<dl>\n  <dt>t</dt>\n  <dd>d</dd>\n</dl>',
    )
  })

  it('after a blank line a definition list parses', () => {
    expect(html('x\n\n:: t\n:  d')).toBe(
      '<p>x</p>\n<dl>\n  <dt>t</dt>\n  <dd>d</dd>\n</dl>',
    )
  })
})
