import { describe, expect, it } from 'vitest'
import { markdownToCarve } from '../src/index.js'

// A fence cannot continue lazily, so a line left of its list item's content
// ends the item and the fence (carve-js#1823). The bytes are carve-php's.

describe('a Markdown fence in a list item', () => {
  it('closes before a dedented line after a blank line', () => {
    expect(markdownToCarve('1. x\n\n   ```\n   code\n\n*after*')).toBe('{loose}\n1. x\n\n   ```\n   code\n\n   ```\n/after/')
  })

  it('closes before a dedented line with no blank line', () => {
    expect(markdownToCarve('1. x\n\n   ```\n   code\n*after*')).toBe('{loose}\n1. x\n\n   ```\n   code\n   ```\n/after/')
  })

  it('closes at the column of its item', () => {
    expect(markdownToCarve('- x\n\n  ~~~~\n  code\n*after*')).toBe('{loose}\n- x\n\n  ```\n  code\n  ```\n/after/')
  })

  it('closes before a new list', () => {
    expect(markdownToCarve('1. x\n\n   ```\n   code\n- *next*')).toBe('{loose}\n1. x\n\n   ```\n   code\n   ```\n\n- /next/')
  })

  it('closes before a heading', () => {
    expect(markdownToCarve('- x\n\n  ```\n  code\n# *h*')).toBe('{loose}\n- x\n\n  ```\n  code\n  ```\n\n# /h/')
  })

  // Left open: closed, the item would read tight where GFM reads it loose.
  it('stays open across a blank line to a line at the content column', () => {
    expect(markdownToCarve('- x\n\n  ```\n  code\n\n  *still*')).toBe('- x\n\n  ```\n  code\n\n  *still*')
  })

  it('runs to the end of the document', () => {
    expect(markdownToCarve('```\ncode\n*x*')).toBe('```\ncode\n*x*\n```')
  })
})
