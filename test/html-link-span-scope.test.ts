import { expect, test } from 'vitest'
import { htmlToCarve, carveToHtml } from '../src/index.js'

test.each(['em', 'strong', 'u', 's', 'mark'])('an HTML %s inside a link has its own scope', (tag) => {
  const source = `<p><${tag}>foo <a href="/url"><${tag}>bar</${tag}></a> baz</${tag}></p>`
  const result = htmlToCarve(source)
  expect(carveToHtml(result.value).trim()).toBe(source)
})

test('same-kind HTML spans without a link still lose the inner level', () => {
  expect(carveToHtml(htmlToCarve('<p><em>foo <em>bar</em></em></p>').value).trim()).toBe('<p><em>foo bar</em></p>')
})

test('a forced span between superscripts inside a link keeps its scope', () => {
  const source = '<p><sup>foo <a href="/url"><em><sup>bar</sup></em></a> baz</sup></p>'
  expect(carveToHtml(htmlToCarve(source).value).trim()).toBe(source)
})
