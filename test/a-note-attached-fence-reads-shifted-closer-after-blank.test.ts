import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('keeps an interior blank when the attached fence closes one column right', () => {
  const html = carveToHtml('[^m]: +\n```\nx\n\ny\n ```\n\nsee[^m]\n')
  expect(html).toContain('<pre><code>x\n\ny\n</code></pre>')
  expect(html.startsWith('<p>see')).toBe(true)
})

it('reads the same closer inside a quoted note', () => {
  const html = carveToHtml('> [^m]: +\n> ```\n> x\n>\n> y\n>  ```\n\nsee[^m]\n')
  expect(html).toContain('<pre><code>x\n\ny\n</code></pre>')
})

it('keeps a delimiter two columns right as fence payload', () => {
  const html = carveToHtml('[^m]: +\n```\nx\n  ```\n\nsee[^m]\n')
  expect(html).toContain('<pre><code>x\n  ```\n')
})
