import { describe, expect, it } from 'vitest'
import { markdownToCarve } from '../src/index.js'

// A fence's three columns of slack count from its list item's content column,
// for the opener and the closer alike (carve-js#1825).

describe('a Markdown fence measured from its item', () => {
  it('keeps an unclosed fence in a nested item', () => {
    expect(markdownToCarve('- a\n  - b\n\n    ```\n    code')).toBe('- a\n  {loose}\n  - b\n\n    ```\n    code\n    ```')
  })

  it('moves a fence indented past its item back to the content column', () => {
    expect(markdownToCarve('- b\n\n     ```\n     code')).toBe('{loose}\n- b\n\n  ```\n  code\n  ```')
  })

  it('reads four columns past the content column as indented code', () => {
    expect(markdownToCarve('- a\n\n      ```\n      code')).toBe('{loose}\n- a\n\n  ````\n  ```\n  code\n  ````')
  })

  it('closes a nested fence, so the text after it is converted', () => {
    expect(markdownToCarve('- a\n  - b\n\n    ```\n    code\n    ```\n\n*z*')).toBe('- a\n  {loose}\n  - b\n\n    ```\n    code\n    ```\n\n/z/')
  })

  it('adds no blank line before a line that returns to the outer item', () => {
    expect(markdownToCarve('- a\n  - b\n\n    ```\n    code\n    ```\n  *mid*')).toBe('- a\n  {loose}\n  - b\n\n    ```\n    code\n    ```\n  /mid/')
  })

  it('adds a blank line before a line that stays in the same item', () => {
    expect(markdownToCarve('- a\n  - b\n\n    ```\n    code\n    ```\n    *in*')).toBe('- a\n  - b\n\n    ```\n    code\n    ```\n\n    /in/')
  })

  it('adds a blank line before a line at column 0', () => {
    expect(markdownToCarve('- b\n\n  ```\n  code\n  ```\n*mid*')).toBe('{loose}\n- b\n\n  ```\n  code\n  ```\n\n/mid/')
  })
})
