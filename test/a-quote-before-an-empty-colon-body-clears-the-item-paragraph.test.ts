import { expect, it } from 'vitest'
import { carveToHtml, parse } from '../src/index.js'

for (const lead of ['x', ':: term']) {
  for (const [tail, type, html] of [['tail', 'paragraph', '<p>tail</p>'], ['| a |', 'table', '<tr><td>a</td></tr>\n  </tbody>\n</table>']]) {
    it(`ends the item after an empty colon body following a quote: ${lead}, ${tail}`, () => {
      const source = `- ${lead}\n  : p\n   > q\n   ::: note\n ${tail}\n`
      const ast = parse(source)
      expect(ast.children.map(node => node.type)).toEqual(['list', type])
      expect(carveToHtml(source)).toContain(`<aside class="admonition note" aria-label="Note">\n\n`)
      expect(carveToHtml(source).endsWith(html)).toBe(true)
    })
  }
}
