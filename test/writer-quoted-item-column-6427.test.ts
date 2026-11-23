// carve#6427: a body opened behind a quote mark on a footnote marker line counts its columns from behind that mark
// (C2-B-003), so the width of the footnote marker in front of the quote does not indent its continuation lines.
import { expect, it } from 'vitest'
import { format, parse, write } from '../src/index.ts'

it.each([
  '[^n]: > - ```\n  >   y\n  >   ```\n',
  '[^n]: > - a\n  >\n  >   b\n',
  '[^n]: > - - ```\n  >     y\n  >     ```\n',
  '[^n]: > > - ```\n  > >   y\n  > >   ```\n',
  '[^n]: > . ```\n  >   y\n  >   ```\n',
  '[^n]: > - > ```\n  >   > y\n  >   > ```\n',
  '[^n]: > - [x] a\n  >\n  >   b\n',
  // Without a quote between them, the item keeps the column of its own marker on the footnote line (C2-B-229).
  '[^n]: - a\n\n        b\n',
  '[^n]: - > - a\n        >\n        >   b\n',
])('writes %j back unchanged', (input) => {
  expect(format(input)).toBe(input)
  expect(format(input, { normalize: true })).toBe(input)
  expect(write(parse(input))).toBe(input)
})
