import { expect, it } from 'vitest'
import { carveToHtml, markdownToCarve } from '../src/index.js'

it('flattens HTML anchors inside active Markdown link labels', () => {
  for (const source of [
    '[outer <a href="/inner">inner</a> tail](/outer)',
    '[outer <a class="x" href="/inner">inner</a> tail](/outer)',
    '[outer <a href="/inner">inner</a> tail][ref]\n\n[ref]: /outer',
  ]) {
    const html = carveToHtml(markdownToCarve(source))
    expect(html).toContain('<a href="/outer">outer inner tail</a>')
    expect(html.match(/<a\b/g)).toHaveLength(1)
  }
  expect(carveToHtml(markdownToCarve('<a href="/inner">inner</a> and [outer](/outer)')))
    .toContain('<a href="/inner">inner</a>')
})
