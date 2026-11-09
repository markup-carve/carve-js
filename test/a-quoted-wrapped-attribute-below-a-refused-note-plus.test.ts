import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const backlink = '<a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a>'

describe('a quoted wrapped attribute run below a refused note plus', () => {
  it.each([
    ['> ', ' ', '  ', '.x\n.y', 'x y'],
    ['> > ', ' ', '  ', '.x\n.y', 'x y'],
    ['> ', ' ', '  ', '#id\n.x', 'x'],
  ])('leaves the note and labels the quote paragraph with %j', (quote, openerIndent, continuationIndent, attrs, className) => {
    const [first, second] = attrs.split('\n')
    const source = `${quote}[^a]: +\n${quote}${openerIndent}{${first}\n${quote}${continuationIndent}${second}}\n${quote}para\n\nsee[^a]\n`
    const html = carveToHtml(source)
    expect(html).toContain(attrs.startsWith('#id') ? '<p id="id" class="x">para</p>' : `<p class="${className}">para</p>`)
    expect(html).toContain(`<li id="fn1">\n      <p>${backlink}</p>`)
  })
})
