import { expect, it } from 'vitest'
import { carveToHtml, htmlToCarve } from '../src/index.js'

it.each(['', '{.x title="note"}'])('retains link-footnote attributes %s', attrs => {
  const source = `a [t[^1]${attrs}](/u) b\n\n[^1]: n\n`
  const html = carveToHtml(source)
  expect(carveToHtml(htmlToCarve(html).value)).toBe(html)
})
