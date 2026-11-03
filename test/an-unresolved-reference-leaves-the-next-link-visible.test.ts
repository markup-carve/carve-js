import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('an unresolved reference leaves a following link visible (carve#5068)', () => {
  it.each([
    ['[][]{#i}[#}]()', '<p>[][]{#i}<a href="">#}</a></p>'],
    ['[][]{v}{#i}[#}]()', '<p>[][]{v}{#i}<a href="">#}</a></p>'],
    ['[x][missing]{#i}[#}]()', '<p>[x][missing]{#i}<a href="">#}</a></p>'],
    ['[x][missing]{foo="{x}"}{#i}[#}]()', '<p>[x][missing]{foo="{x}"}{#i}<a href="">#}</a></p>'],
    ['[x][missing]{#i#}[#}]()', '<p>[x][missing]<span class="critic-comment">i</span><a href="">#}</a></p>'],
  ])('%s', (source, html) => {
    expect(carveToHtml(`${source}\n`).trim()).toBe(html)
  })

  it('keeps brackets inside an unattached editorial comment opaque', () => {
    expect(carveToHtml('[{#id}]#}](u)\n').trim()).toBe(
      '<p><a href="u"><span class="critic-comment">id}]</span></a></p>',
    )
    expect(carveToHtml('[x{#a}[#}]()](/u)\n').trim()).toBe(
      '<p><a href="">x<span class="critic-comment">a}[</span></a>](/u)</p>',
    )
  })

  it.each(['{}', '{ }'])('does not extend a reference attribute run through %s', (empty) => {
    const source = `[outer [x][y]${empty}{foo="]"}](/u)\n`
    expect(carveToHtml(source).trim()).toBe(
      `<p>[outer [x][y]${empty}{foo=“]”}](/u)</p>`,
    )
  })

  it('keeps a quoted bracket in a nested reference attribute visible to pairing', () => {
    expect(carveToHtml('[outer [x][y]{foo="a]b"}](/u)\n').trim()).toBe(
      '<p>[outer [x][y]{foo="a]b"}](/u)</p>',
    )
  })
})
