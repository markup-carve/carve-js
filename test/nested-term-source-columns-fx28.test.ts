import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('nested term source columns', () => {
  it('ends the term at a quote past a description column', () => {
    const source = ':: outer\n:  detail\n     :: inner\n    > quote\n'
    expect(carveToHtml(source)).toContain('<dt>inner</dt>\n    </dl>\n    <blockquote><p>quote</p></blockquote>')
  })

  it.each(['[r]: /url', '[^n]: note'])(
    'reads a past-column %s as a definition, not term text', (line) => {
      const source = `:: outer\n:  detail\n     :: inner\n    ${line}\n`
      expect(carveToHtml(source)).toBe('<dl>\n  <dt>outer</dt>\n  <dd>\n    <p>detail</p>\n    <dl>\n      <dt>inner</dt>\n    </dl>\n  </dd>\n</dl>')
    },
  )

  it('returns a below-column marker to the surviving description', () => {
    const source = ':: outer\n:  detail\n    :: inner\n  :  tail\n'
    expect(carveToHtml(source)).toMatch(/<dt>inner<\/dt>\s*<\/dl>\s*<p>:  tail<\/p>/)
  })

  it('keeps a marker-column line with its outer list item', () => {
    const source = '- - :: t\n  : a\n'
    expect(carveToHtml(source)).toMatch(/<dt>t<\/dt>\s*<\/dl>\s*<\/li>\s*<\/ul>\s*: a/)
  })

  it('opens a list below a description column after a nested term', () => {
    const source = ':: outer\n:  detail\n   :: inner\n  - item\n'
    expect(carveToHtml(source)).toMatch(/<dt>inner<\/dt>\s*<\/dl>\s*<ul>\s*<li>item<\/li>/)
  })
})
