import { expect, it } from 'vitest'
import { carveToHtml, htmlToCarve } from '../src/index.js'

it.each([
  'a [^1]{.k}\n\n[^1]: n\n',
  'a [^1]{#z .k}\n\n[^1]: n\n',
  'a [^1]{k=v}\n\n[^1]: n\n',
])('keeps authored attributes on an imported footnote reference', (source) => {
  expect(htmlToCarve(carveToHtml(source)).value).toBe(source)
})

it('leaves generated reference attributes implicit', () => {
  const source = 'a [^1]\n\n[^1]: n\n'
  expect(htmlToCarve(carveToHtml(source)).value).toBe(source)
})

it('drops a producer class while keeping the authored class beside it', () => {
  const source = 'a [^1]{.k}\n\n[^1]: n\n'
  const html = carveToHtml(source).replace('class="k"', 'class="footnote-ref k"')
  expect(htmlToCarve(html).value).toBe(source)
})
