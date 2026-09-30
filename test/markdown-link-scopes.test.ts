import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { markdownToCarve, carveToHtml } from '../src/index.js'

const cases = JSON.parse(readFileSync(new URL('./fixtures/commonmark-link-scope.json', import.meta.url), 'utf8')) as { example: number; markdown: string; html: string }[]
for (const { example, markdown, html } of cases) {
  test(`CommonMark link scope ${example}`, () => {
    expect(carveToHtml(markdownToCarve(markdown))).toBe(html.trimEnd())
  })
}

for (const [source, html] of [
  ['[a ~~b~~](/u)', '<p><a href="/u">a <s>b</s></a></p>'],
  ['[a &amp; b](/u)', '<p><a href="/u">a &amp; b</a></p>'],
  ['[say "hi"](/u)', '<p><a href="/u">say "hi"</a></p>'],
  ['[<em>x</em>](/u)', '<p><a href="/u"><em>x</em></a></p>'],
]) {
  test(`link labels retain other inline conversions: ${source}`, () => {
    expect(carveToHtml(markdownToCarve(source!))).toBe(html)
  })
}
