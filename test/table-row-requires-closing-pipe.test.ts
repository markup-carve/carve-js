import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const html = (s: string) => carveToHtml(s)

describe('a table row needs a closing pipe', () => {
  it('a stray leading `|` with no closing `|` is paragraph text', () => {
    expect(html('| a')).toBe('<p>| a</p>')
    expect(html('| a | b')).toBe('<p>| a | b</p>')
  })

  it('a complete row (opens and closes with `|`) is a table', () => {
    expect(html('| a |')).toBe(
      '<table>\n  <tbody>\n    <tr><td>a</td></tr>\n  </tbody>\n</table>',
    )
  })

  it('an incomplete row does not interrupt a paragraph or heading', () => {
    expect(html('para\n| a')).toBe('<p>para\n| a</p>')
    expect(html('# H\n| a')).toBe('<section id="h-a">\n  <h1>H\n| a</h1>\n</section>')
  })
})
