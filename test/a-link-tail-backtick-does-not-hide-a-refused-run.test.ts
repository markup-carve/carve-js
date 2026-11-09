import { expect, test } from 'vitest'
import { carveToHtml } from '../src/index.js'

for (const tail of ['[x](`url)', '[x](/u "`title")']) {
  test(`backtick in ${tail} does not open paragraph code`, () => {
    const input = `p\n ${tail}\n {.x\n .y}\n \`\`\`\n z\n`
    const link = tail === '[x](`url)' ? '<a href="`url">x</a>' : '<a href="/u" title="`title">x</a>'
    expect(carveToHtml(input)).toBe(`<p>p\n${link}\n{.x\n.y}\n<code>\nz</code></p>`)
  })
}
