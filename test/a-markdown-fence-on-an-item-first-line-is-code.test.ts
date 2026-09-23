import { describe, expect, it } from 'vitest'
import { markdownToCarve } from '../src/index.js'

// A fence on a list item's own first line holds code: its body is written byte
// for byte, its closer closes it, and a line left of the item's content column
// ends it (carve-js#1836).

describe('a Markdown fence on a list item first line', () => {
  it('keeps a closed fence in a nested item without a blank line', () => {
    expect(markdownToCarve('1. a\n   - ```\n     code\n     ```')).toBe('1. a\n   - ```\n     code\n     ```')
  })

  it('reads the closer as a closer, so the text after it is not code', () => {
    expect(markdownToCarve('- ```\n  code\n  ```\n\nz')).toBe('- ```\n  code\n  ```\n\nz')
  })

  it('does the same in a nested item', () => {
    expect(markdownToCarve('- a\n  - ```\n    code\n    ```\n\nz')).toBe('- a\n  - ```\n    code\n    ```\n\nz')
  })

  it('converts the item content after the closer again', () => {
    expect(markdownToCarve('- ```\n  code\n  ```\n  *after*')).toBe('- ```\n  code\n  ```\n  /after/')
  })

  it('writes the body without converting it', () => {
    expect(markdownToCarve('- ```\n  *x* [a](b)\n  + y\n  ```')).toBe('- ```\n  *x* [a](b)\n  + y\n  ```')
  })

  it('keeps a blank line inside the body', () => {
    expect(markdownToCarve('+ ```js title=x\n  a\n\n  b\n  ```\n+ next')).toBe('- ```js\n  a\n\n  b\n  ```\n- next')
  })

  it('ends an unclosed fence before a line left of the content column', () => {
    expect(markdownToCarve('- a\n  - ```\n    code\n\nz')).toBe('- a\n  - ```\n    code\n\nz')
    expect(markdownToCarve('- ```\n  code\n*after*')).toBe('- ```\n  code\n/after/')
  })

  it('takes a tilde closer only for a tilde fence', () => {
    expect(markdownToCarve('- ~~~\n  ```\n  ~~~\n\nz')).toBe('- ````\n  ```\n  ````\n\nz')
  })

  it('does not close on a shorter run', () => {
    expect(markdownToCarve('- ````\n  ```\n  ````\n\nz')).toBe('- ````\n  ```\n  ````\n\nz')
  })
})
