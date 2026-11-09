import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it.each(['```', '~~~'])('bounds a %s verse payload run to its quote', run => {
  const source = `> - ::: |\n>   ${run}\nz\n>   ${run}\n`
  const body = run === "```" ? "<code>\nz\n</code>" : "~~~<br>\nz<br>\n~~~"
  expect(carveToHtml(source)).toBe(`<blockquote>\n  <ul>\n    <li>\n      <div class="line-block">\n        <p>${body}</p>\n      </div>\n    </li>\n  </ul>\n</blockquote>`)
})
