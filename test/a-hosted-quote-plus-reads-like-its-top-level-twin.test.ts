import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const flat = (html: string): string => html.split('\n').map((line) => line.trim()).join('')

// An item's content reads like a document (CARVE-P9-033, markup-carve/carve#3421).
describe('a quote-prefixed plus inside a list item', () => {
  const twins: Array<[string, string, string]> = [
    ['- > > q\n  > +\n  > para\n', '> > q\n> +\n> para\n', 'ul'],
    ['1. > > q\n   > +\n   > para\n', '> > q\n> +\n> para\n', 'ol'],
    ['- > > > q\n  > > +\n  > > para\n', '> > > q\n> > +\n> > para\n', 'ul'],
    ['- > > q\n  > +\n  > - s\n', '> > q\n> +\n> - s\n', 'ul'],
    ['- > > q\n  > +\n  > > r\n', '> > q\n> +\n> > r\n', 'ul'],
    ['- > q\n  > +\n  > para\n', '> q\n> +\n> para\n', 'ul'],
  ]
  for (const [hosted, topLevel, list] of twins) {
    it(`reads ${JSON.stringify(hosted)} like its top-level twin`, () => {
      expect(flat(carveToHtml(hosted))).toBe(`<${list}><li>${flat(carveToHtml(topLevel))}</li></${list}>`)
    })
  }

  it('splits the inner quote into two paragraphs', () => {
    expect(flat(carveToHtml('- > > q\n  > +\n  > para\n'))).toBe(
      '<ul><li><blockquote><blockquote><p>q</p><p>para</p></blockquote></blockquote></li></ul>',
    )
  })
})
