// carve#6440: a fence opened behind a task box, a footnote label or glued attributes strips up to its opener's indent
// from each line (C2-B-029), so a value line that starts with whitespace is written at the opener's column, and the
// closer with it (C2-W-033).
import { expect, it } from 'vitest'
import { format, parse, write } from '../src/index.ts'

it.each([
  '- [x] ```\n        y\n      ```\n',
  '- [ ] ```js\n        y\n\n      z\n      ```\n',
  '. [x] ```\n          y\n      ```\n',
  '-{.a} ```\n        y\n      ```\n',
  '[^n]: ```\n        y\n      ```\n',
  '- - [x] ```\n          y\n        ```\n',
  '> - [x] ```\n>         y\n>       ```\n',
  '[^n]: > - [x] ```\n  >         y\n  >       ```\n',
  '- [x] ```=html\n        <b>\n      ```\n',
  '- [x] %%%\n        y\n      %%%\n',
  // Without whitespace at the start of a line, the lines stand at the content column (C2-W-024).
  '- [x] ```\n  y\n  ```\n',
  // The same fence without the task box.
  '- ```\n      y\n  ```\n',
])('writes %j back unchanged', (input) => {
  expect(format(input)).toBe(input)
  expect(format(input, { normalize: true })).toBe(input)
  expect(write(parse(input))).toBe(input)
})
