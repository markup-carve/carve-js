import { expect, test } from 'vitest'
import { carveToHtml } from '../src/index.js'

for (const tail of ['[x](`url)', '[x](/u "`title")']) {
  test(`backtick in ${tail} does not open paragraph code`, () => {
    const input = `p\n ${tail}\n {.x\n .y}\n \`\`\`\n z\n`
    const link = tail === '[x](`url)' ? '<a href="`url">x</a>' : '<a href="/u" title="`title">x</a>'
    expect(carveToHtml(input)).toBe(`<p>p\n${link}\n{.x\n.y}\n<code>\nz</code></p>`)
  })
}

for (const text of ['foo](`url)', '\\[x](`url)']) {
  test(`literal ${text} leaves its backtick active`, () => {
    const input = `p\n ${text}\n {.x\n .y}\n \`\`\`\n z\n`
    const rendered = text.startsWith('\\') ? text.slice(1) : text
    expect(carveToHtml(input)).toBe(`<p>p\n${rendered.replace('`', '<code>')}\n{.x\n.y}</code></p>\n<pre><code>z\n</code></pre>`)
  })
}
