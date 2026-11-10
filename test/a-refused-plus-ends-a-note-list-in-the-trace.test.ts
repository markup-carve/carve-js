import { expect, it } from 'vitest'
import { decisionTrace } from '../src/index.js'

const owners = (source: string): Array<[number, string, string, number?]> =>
  decisionTrace(source).map(record => record.plus === undefined
    ? [record.line, record.owner, record.form]
    : [record.line, record.owner, record.form, record.plus])

// The list a note's `+` attached sits in the note, so a `+` at their marker column reaches the note (carve#5601).
it('gives a refused plus and its follower to the note (carve-js#4797)', () => {
  expect(owners('[^a]: +\n- li\n  ```\n+\n  p\n\nsee[^a]\n').slice(3)).toEqual([
    [4, 'doc/footnote:1', 'plus'],
    [5, 'doc/footnote:1', 'text'],
    [6, 'doc/footnote:1', 'blank'],
    [7, 'doc', 'text'],
  ])
})

it('reaches the note from a later item of the same list', () => {
  expect(owners('> [^a]: +\n> - li\n> - l2\n>   ```\n> +\n>   p\n\nsee[^a]\n')[4]).toEqual(
    [5, 'doc/quote:1/footnote:1', 'plus'],
  )
})

it('keeps a claimed second plus in the note chain', () => {
  expect(owners('[^a]: +\n- li\n  ```\n+\n+\n  p\n\nsee[^a]\n').slice(3, 6)).toEqual([
    [4, 'doc/footnote:1', 'plus'],
    [5, 'doc/footnote:1', 'plus'],
    [6, 'doc/footnote:1', 'text', 5],
  ])
})

it('ends a marker-line note at its refused plus, so the item reads the next block (carve#5515)', () => {
  expect(owners('- [^a]: +\n  - li\n    ```\n  +\n    p\n\nsee[^a]\n').slice(3, 5)).toEqual([
    [4, 'doc/item:1/footnote:1', 'plus'],
    [5, 'doc/item:1', 'text'],
  ])
  expect(owners('- [^a]: +\n  - li\n    ```\n  +\n  +\n    p\n\nsee[^a]\n')[4]).toEqual([5, 'doc/item:1', 'text'])
})
