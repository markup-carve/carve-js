import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it.each(['```', '~~~'])('keeps the trailing blank in an open %s fence attached by an own-line plus (carve#5560)', (fence) => {
  for (const interior of ['', '\n']) {
    const source = `[^f]: n\n+\n${fence}\na\n${interior}  b\n\nsee[^f]\n`
    const html = carveToHtml(source)
    expect(html).toMatch(/<pre><code>a\n(?:\n)? *b\n\n<\/code><\/pre>/)
  }
})
