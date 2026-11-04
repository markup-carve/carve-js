import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const normalize = (html: string) => html.replace(/\s+/g, ' ').replace(/ ?(<[^>]+>) ?/g, '$1').trim()
const inner = '<blockquote><blockquote><p>a</p><p>b</p></blockquote></blockquote>'
const note = (body: string) => `<p><a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></p>` +
  `<section role="doc-endnotes" aria-label="Footnotes"><hr><ol><li id="fn1">${body}` +
  `<p><a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p></li></ol></section>`

// A `+` at a descendant quote's authored marker column reaches it without the outer markers (carve-js#4256).
it.each([
  ['> > a\n  +\n> b\n', inner],
  ['- > > a\n    +\n  > b\n', `<ul><li>${inner}</li></ul>`],
  ['[^f]: > > a\n        +\n      > b\n\n[^f]\n', note(inner)],
  ['[^f]: > > a\n      > +\n      > b\n\n[^f]\n', note(inner)],
  ['[^f]:  > > a\n         +\n       > b\n\n[^f]\n', note(inner)],
])('attaches the block in %j', (source, html) => {
  expect(normalize(carveToHtml(source))).toBe(normalize(html))
})

// The erased comment goes with its `>`, so `b` stays in the inner quote (carve-js#4255, carve#5129).
it.each([
  '> > a\n > +\n > %% c\n > b\n',
  '> > a\n  > +\n  > %% c\n  > b\n',
  '> > a\n > +\n > %% c\n > %% d\n > b\n',
])('skips the comment in %j', (source) => {
  expect(normalize(carveToHtml(source))).toBe(inner)
})
