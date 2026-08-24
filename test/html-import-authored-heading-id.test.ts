import { describe, expect, it } from 'vitest'
import { htmlToAst, htmlToCarve, parse } from '../src/index.js'

describe('authored HTML heading ids', () => {
  it('keeps an id equal to the generated slug in both import exits', () => {
    const html = '<h1 id="Target">Target</h1><p>See <a href="#Target">Target</a>.</p>'
    const source = htmlToCarve(html).value
    const imported = htmlToAst(html).value

    expect(source).toBe('{#Target}\n# Target\n\nSee [Target](#Target).\n')
    expect(parse(source, { positions: false }).children).toEqual(imported.children)
  })
})
