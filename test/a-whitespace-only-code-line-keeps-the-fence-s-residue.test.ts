import { describe, expect, it } from 'vitest'

import { carveToHtml } from '../src/index.js'

const code = (source: string): string => {
  const match = /<pre><code[^>]*>([\s\S]*?)<\/code><\/pre>/.exec(carveToHtml(source))
  if (!match) throw new Error(`no code block in the render of ${JSON.stringify(source)}`)
  return match[1]!
}

describe("a whitespace-only code line keeps the fence's residue", () => {
  it('item at 2, fence at 2, line 2', () => {
    expect(code('- item\n\n  ```\n  a\n  \n  b\n  ```\n')).toBe('a\n\nb\n')
  })

  it('item at 2, fence at 4, line 4', () => {
    expect(code('- item\n\n    ```\n    a\n    \n    b\n    ```\n')).toBe('a\n\nb\n')
  })

  it('item at 2, fence at 4, line 6', () => {
    expect(code('- item\n\n    ```\n    a\n      \n    b\n    ```\n')).toBe('a\n  \nb\n')
  })

  it('note at 4, fence at 6, line 6', () => {
    const source = 'x[^1]\n\n[^1]: note\n\n      ```\n      a\n      \n      b\n      ```\n'
    expect(code(source)).toBe('a\n\nb\n')
  })

  it('nested item, fence at 4, line 6', () => {
    expect(code('- - item\n\n    ```\n    a\n      \n    b\n    ```\n')).toBe('a\n  \nb\n')
  })

  it('nested item, fence at 6, line 8', () => {
    expect(code('- - item\n\n      ```\n      a\n        \n      b\n      ```\n')).toBe('a\n  \nb\n')
  })

  it('defn desc at 3, fence at 5, line 7', () => {
    expect(code(':: t\n:  d\n\n     ```\n     a\n       \n     b\n     ```\n')).toBe('a\n  \nb\n')
  })

  it('quote+item, fence at 4, line 6', () => {
    expect(code('> - item\n>\n>     ```\n>     a\n>       \n>     b\n>     ```\n')).toBe('a\n  \nb\n')
  })

  it('item at 2, fence at 4, line 5', () => {
    expect(code('- item\n\n    ```\n    a\n     \n    b\n    ```\n')).toBe('a\n \nb\n')
  })
})

describe('column and block boundaries', () => {
  it('measures a tab crossing the opener column in columns', () => {
    expect(code('- item\n\n     ```\n     a\n\t\t\n     b\n     ```\n')).toBe('a\n   \nb\n')
  })

  it('keeps whitespace outside a fence separating paragraphs', () => {
    expect(carveToHtml('- a\n      \n  b\n')).toBe(carveToHtml('- a\n\n  b\n'))
    expect(carveToHtml(':: t\n:  a\n       \n   b\n')).toBe(carveToHtml(':: t\n:  a\n\n   b\n'))
  })

  it('counts whitespace-only lines toward the three-blank boundary', () => {
    const html = carveToHtml('- a\n      \n      \n      \n- b\n')
    expect(html).toBe(carveToHtml('- a\n\n\n\n- b\n'))
    expect(html.match(/<ul>/g)).toHaveLength(2)
  })
})
