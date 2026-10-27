import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import { perfIt } from './helpers/scaling.js'

const quotedList = (depth: number): string => `${'> '.repeat(depth)}- - x\n    [r]: /\n`

it('keeps a lazy definition-shaped line in the inner item', () => {
  const html = carveToHtml(quotedList(1))
  expect(html).toContain('<li>x\n[r]: /</li>')
  expect(html).not.toContain('<li>x</li>')
})

perfIt('renders a deeply quoted nested list within a generous time bound', () => {
  carveToHtml(quotedList(8))
  const start = performance.now()
  const html = carveToHtml(quotedList(30))
  const elapsed = performance.now() - start
  expect(html).toContain('<li>x\n[r]: /</li>')
  expect(elapsed).toBeLessThan(5000)
})
