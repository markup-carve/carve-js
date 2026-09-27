import { describe, it, expect } from 'vitest'
import { carveToCarve, htmlToCarve, parse } from '../src/index.js'

// CARVE-P11-016: a verbatim line in a list item is its residue past the content
// column, whitespace-only or not, as it already is in a block quote.
const codeOf = (src: string): string => {
  const list = parse(src).children[0] as { items: Array<{ children: Array<{ content: string }> }> }
  return list.items[0]!.children[0]!.content
}

describe('a whitespace-only code line in a list item keeps its content', () => {
  it('keeps the spaces past the content column', () => {
    expect(codeOf('- ```\n  a\n    \n  b\n  ```\n')).toBe('a\n  \nb')
  })

  it('reads a line no wider than the content column as an empty line', () => {
    expect(codeOf('- ```\n  a\n  \n  b\n  ```\n')).toBe('a\n\nb')
    expect(codeOf('- ```\n  a\n\n  b\n  ```\n')).toBe('a\n\nb')
  })

  it('makes an imported whitespace-only line a fmt fixed point', () => {
    const src = htmlToCarve('<ul><li><pre>a\n \nb</pre></li></ul>').value
    expect(codeOf(src)).toBe('a\n \nb')
    expect(carveToCarve(src)).toBe(src)
  })
})
