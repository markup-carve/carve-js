import { expect, it } from 'vitest'
import { carveToHtml, markdownToCarve } from '../src/index.js'

it.each([
  '<details><summary>More</summary><p>Body</p></details>',
  '<details>\n<summary>More</summary>\n<p>Body</p>\n</details>',
])('keeps details HTML during Markdown import', html => {
  const source = markdownToCarve(html)
  expect(source).toContain('```=html\n<details>')
  expect(carveToHtml(source)).toBe(html)
})
