import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it.each([
  ['::: |\n[a](/u\t"t")', '<div class="line-block">\n  <p>[a](/u&nbsp;&nbsp;“t”)</p>\n</div>'],
  ['::: |\n[a](/u  "t")', '<div class="line-block">\n  <p>[a](/u&nbsp;&nbsp;“t”)</p>\n</div>'],
  ['::: |\n[a](/u "t")', '<div class="line-block">\n  <p><a href="/u" title="t">a</a></p>\n</div>'],
])('keeps a synthetic gap out of a link destination: %s', (source, rendered) => {
  expect(carveToHtml(source)).toBe(rendered)
})
