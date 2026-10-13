import { expect, it } from 'vitest'
import { htmlToCarve } from '../src/index.js'

it.each([false, true])('keeps separate bare notes with wrapper id=%s', id => {
  const html = '<p><a href="/u">t<sup id="fnref1">1</sup><sup id="fnref2">2</sup></a></p>'
    + `<section role="doc-endnotes"><div${id ? ' id="notes"' : ''}>`
    + '<p id="fn1">first <a href="#fnref1" role="doc-backlink">back</a></p>'
    + '<p id="fn2">second <a href="#fnref2" role="doc-backlink">back</a></p></div></section>'
  expect(htmlToCarve(html).value).toBe('[t[^1][^2]](/u)\n\n[^1]: first\n\n[^2]: second\n')
})
