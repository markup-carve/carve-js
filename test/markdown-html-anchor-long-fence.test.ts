import { expect, it } from 'vitest'
import { carveToHtml, markdownToCarve } from '../src/index.js'
import { markdownToCarveWithLosses } from '../src/markdown-migrate.js'

it.each(['`', '``', '```'])('flattens a raw HTML anchor whose attribute contains %s', ticks => {
  const source = `[outer <a href="/inner${ticks}path">inner</a> tail](/outer)`
  const html = carveToHtml(markdownToCarve(source))
  expect(html).toContain('<a href="/outer">outer inner tail</a>')
  expect(html.match(/<a\b/g)).toHaveLength(1)
  expect(markdownToCarveWithLosses(source).losses.map(loss => loss.code)).toContain('structure-unspellable')
})
