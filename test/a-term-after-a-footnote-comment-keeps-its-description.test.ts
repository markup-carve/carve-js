import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const note = (html: string) => html.slice(html.indexOf('<li id="fn1">'))

describe('a term after a comment line in a footnote body keeps its description', () => {
  for (const indent of [3, 4, 5]) {
    it(`reads a description at the term's column (${indent} spaces)`, () => {
      const pad = ' '.repeat(indent)
      const html = carveToHtml(`r[^1]\n\n[^1]: x\n%% c\n${pad}:: t\n${pad}: zq\n`)
      expect(html).toContain('</p>\n<dl>\n  <dt>t</dt>\n  <dd>zq</dd>\n</dl>\n<section')
    })
  }

  it('attaches a description left of the term', () => {
    const html = carveToHtml('r[^1]\n\n[^1]: x\n%% c\n  :: t\n   : zq\n')
    expect(html).toContain('</p>\n<dl>\n  <dt>t</dt>\n  <dd>zq</dd>\n</dl>\n<section')
  })

  it('still takes a quote flush after a comment in a quoted note body', () => {
    const html = carveToHtml('r[^c]\n\n[^c]: > para\n  %% c\n      > tail\n')
    expect(note(html)).toContain('<blockquote><p>tail</p></blockquote>')
  })

  it('gives a quote after a below-column comment to the document', () => {
    const html = carveToHtml('r[^c]\n\n[^c]: > para\n%% c\n      > tail\n')
    expect(html).toContain('</p>\n<blockquote><p>tail</p></blockquote>\n<section')
  })
})
