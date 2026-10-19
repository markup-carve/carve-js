import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('keeps a blank in an unterminated fence two list levels deep', () => {
  expect(carveToHtml('- - ```\n    x\n\n[^1]: a')).toBe('<ul>\n  <li>\n    <ul>\n      <li>\n        <pre><code>x\n\n</code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>')
})

it('keeps the fence blank at every depth and before every follower', () => {
  for (const depth of [1, 2, 3]) {
    const source = `${'- '.repeat(depth)}\`\`\`\n${'  '.repeat(depth)}x\n\n`
    for (const follower of ['tail', '[^1]: a', '[r]: /u', '{.x}']) {
      for (const finalBreak of ['', '\n']) {
        const html = carveToHtml(source + follower + finalBreak)
        expect(html.match(/<pre><code>([^]*?)<\/code><\/pre>/)?.[1], `${depth} levels, ${follower}, final break ${Boolean(finalBreak)}`).toBe('x\n\n')
      }
    }
  }
})

it('keeps a blank in an unterminated fence one list level deep', () => {
  expect(carveToHtml('- ```\n  x\n\ny')).toContain('<pre><code>x\n\n</code></pre>')
})

it('ends an outer quote after a nested marker-line fence', () => {
  expect(carveToHtml('> - > ~~~\n  > y')).toBe('<blockquote>\n  <ul>\n    <li>\n      <blockquote>\n        <pre><code></code></pre>\n      </blockquote>\n    </li>\n  </ul>\n</blockquote>\n<p>&gt; y</p>')
})

it('keeps a marked line in the outer quote after a nested marker-line fence', () => {
  expect(carveToHtml('> - > ~~~\n> y')).toBe('<blockquote>\n  <ul>\n    <li>\n      <blockquote>\n        <pre><code></code></pre>\n      </blockquote>\n    </li>\n  </ul>\n  <p>y</p>\n</blockquote>')
})
