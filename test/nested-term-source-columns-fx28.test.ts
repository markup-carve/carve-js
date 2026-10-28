import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('nested term source columns', () => {
  it('keeps the authored offset of a quote past a description column', () => {
    const source = ':: outer\n:  detail\n     :: inner\n    > quote\n'
    expect(carveToHtml(source)).toContain('<dt>inner\n &gt; quote</dt>')
  })

  it.each(['[r]: /url', '[^n]: note'])(
    'keeps a past-column %s as term text with its source offset', (line) => {
      const source = `:: outer\n:  detail\n     :: inner\n    ${line}\n`
      expect(carveToHtml(source)).toContain(`<dt>inner\n ${line}</dt>`)
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
