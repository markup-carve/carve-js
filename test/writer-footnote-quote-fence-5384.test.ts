// carve-js#5384: a fence in a container opened on a footnote marker line keeps the prefix of that container on its
// value lines and closer (C2-W-024, C2-W-033), so a quote there keeps its `>` marks.
import { expect, it } from 'vitest'
import { format, parse, write } from '../src/index.ts'

it.each([
  '[^n]: > ```\n  > y\n  > ```\n',
  '[^n]: > ```js\n  > a\n  >\n  > b\n  > ```\n',
  '[^n]: > > ```\n  > > y\n  > > ```\n',
  '[^n]: - > ```\n        > y\n        > ```\n',
  '[^n]: > ````\n  > ```\n  > ````\n',
  '[^n]: > ```=html\n  > <b>\n  > ```\n',
  '[^m]: z\n\n[^n]: > ```\n  > y\n  > ```\n---yaml\nk: v\n---\n',
  // The list item behind the footnote marker keeps the column of its own marker (C2-B-229).
  '[^n]: - ```\n        y\n        ```\n',
  '[^n]: ```\n  y\n  ```\n',
])('writes %j back unchanged', (input) => {
  expect(format(input)).toBe(input)
  expect(format(input, { normalize: true })).toBe(input)
  expect(write(parse(input))).toBe(input)
})
