import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('keeps an own-line attached fence closer inside its quoted item', () => {
  for (const [marker, tag] of [['-', 'ul'], ['1.', 'ol']] as const) {
    const source = `> ${marker} x\n> +\n> \`\`\`\n> \n>  a\n> \n> b\n> \`\`\`\n> \n> z\n`
    expect(carveToHtml(source).trim()).toBe(
      `<blockquote>\n  <${tag}>\n    <li>x\n      <pre><code>\n a\n\nb\n</code></pre>\n    </li>\n  </${tag}>\n  <p>z</p>\n</blockquote>`,
    )
  }
})

it('closes the active fence when a refused marker follows a different delimiter', () => {
  expect(carveToHtml('- ```\n  ```\n  ~~~\n+\n  x\n').trim()).toBe(
    '<ul>\n  <li>\n    <pre><code></code></pre>\n    <pre><code></code></pre>\n    x\n  </li>\n</ul>',
  )
})
