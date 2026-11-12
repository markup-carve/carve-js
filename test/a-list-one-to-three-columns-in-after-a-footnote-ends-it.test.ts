import { describe, expect, it } from 'vitest'
import { markdownToCarve } from '../src/index.js'

// carve-js#4993: a footnote body continues only at four columns, so a list one
// to three columns in after it is a document-level list.

describe('a list one to three columns in after a footnote', () => {
  it.each([1, 2, 3])('ends the note after a blank line at column %i', (col) => {
    const pad = ' '.repeat(col)
    expect(markdownToCarve(`a[^1]\n\n[^1]: b\n\n${pad}- t\n`)).toBe('a[^1]\n\n- t\n\n[^1]: b\n')
    expect(markdownToCarve(`a[^1]\n\n[^1]: b\n\n${pad}1. t\n`)).toBe('a[^1]\n\n1. t\n\n[^1]: b\n')
  })

  it('ends the note after a definition in its body', () => {
    expect(markdownToCarve('a[^1]\n\n[^1]: b\n\n    [r]: https://e\n\n  - t\n'))
      .toBe('a[^1]\n\n- t\n\n[^1]: b\n\n[r]: https://e\n')
  })

  it.each([
    ['bullet', '  - t\n  - u\n', '- t\n- u\n'],
    ['ordered', '   1. t\n   2. u\n', '1. t\n2. u\n'],
  ])('keeps every %s item at document level without a blank line', (_name, list, carve) => {
    expect(markdownToCarve(`a[^1]\n\n[^1]: b\n${list}`)).toBe(`a[^1]\n\n${carve}\n[^1]: b\n`)
  })

  it('keeps a four-column list in the note', () => {
    expect(markdownToCarve('a[^1]\n\n[^1]: b\n\n    - t\n')).toBe('a[^1]\n\n[^1]: b\n  - t\n')
  })
})

describe('a quote line one to three columns in after a quote in a footnote', () => {
  it.each([0, 1, 2, 3])('ends the note at column %i', (col) => {
    expect(markdownToCarve(`a[^1]\n\n[^1]: b\n\n    > q\n${' '.repeat(col)}> r\n`))
      .toBe('a[^1]\n\n> r\n\n[^1]: b\n\n  > q\n')
  })

  it('keeps a four-column quote line in the note', () => {
    expect(markdownToCarve('a[^1]\n\n[^1]: b\n\n    > q\n    > r\n')).toBe('a[^1]\n\n[^1]: b\n\n  > q\n  > r\n')
  })
})
