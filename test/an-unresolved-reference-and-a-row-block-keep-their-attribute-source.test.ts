import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

describe('an unresolved reference keeps its whole attribute run as text (carve#4320)', () => {
  it.each([
    ['[a][b]{.c}{.d}', '<p>[a][b]{.c}{.d}</p>'],
    ['[a][]{#i}{.c}', '<p>[a][]{#i}{.c}</p>'],
    ['![a][b]{.c}{.d}', '<p>![a][b]{.c}{.d}</p>'],
    ['[a][b]{.c}{.d}{bad!}', '<p>[a][b]{.c}{.d}{bad!}</p>'],
  ])('%s', (source, html) => {
    expect(carveToHtml(`${source}\n`).trim()).toBe(html)
    expect(carveToCarve(`${source}\n`)).toBe(`${source}\n`)
  })

  it('still attaches the run to a resolved reference', () => {
    expect(carveToHtml('[a][b]{.c}{.d}\n\n[b]: /u\n').trim()).toBe('<p><a href="/u" class="c d">a</a></p>')
  })
})

describe('a quoted row attribute value may hold a pipe (carve#4323)', () => {
  const row = (attrs: string) => `<table>\n  <tbody>\n    <tr ${attrs}><td>a</td></tr>\n  </tbody>\n</table>`

  it.each([
    ['| a |{a="x|y"}', row('a="x|y"')],
    ['| a |{a="|{.b}"}', row('a="|{.b}"')],
    ["| a |{a='|'} ", row('a="|"')],
  ])('%s', (source, html) => {
    expect(carveToHtml(`${source}\n`).trim()).toBe(html)
  })

  it('takes the last block that reads whole, and refuses an invalid one', () => {
    expect(carveToHtml('| a |{a="b}c"}|{.d}\n')).toContain('<tr class="d">')
    expect(carveToHtml('| a |{bad!!}\n').trim()).toBe('<p>| a |{bad!!}</p>')
  })
})
