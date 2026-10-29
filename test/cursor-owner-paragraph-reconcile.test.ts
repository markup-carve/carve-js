import { describe, expect, it } from 'vitest'

import { parse, renderHtml, resolve } from '../src/index.js'
import { parseCursorPrototype, UnsupportedCursorSyntax } from '../src/parse/cursor-prototype.js'

function expectExact(source: string): void {
  const actual = parseCursorPrototype(source)
  expect(actual, source).toStrictEqual(parse(source))
  expect(renderHtml(resolve(actual)), source).toBe(renderHtml(resolve(parse(source))))
}

describe('cursor owner and paragraph reconciliation', () => {
  it.each([
    '- intro\n%% c\n- next\n',
    '1. intro\n%% c\n2. next\n',
    '- intro\n%% a\n- b\n%% d\n- c\n',
    '- intro\n%% c\n- [ ] next\n',
  ])('keeps a flush-left comment in the item above a following sibling: %s', expectExact)

  it.each([
    '- a\n  [^f]: t\n\n    more\ntail\n\nx[^f]\n',
    '- a\n  [^f]: t\n\n    more\ntail\nz\n\nx[^f]\n',
    '[^f]: t\n\n  more\ntail\n\nx[^f]\n',
  ])('lets a lazy line continue the second paragraph of a note: %s', expectExact)

  it.each([
    '-  [ ] item\n   # H\n',
    '-   [ ] item\n    # H\n',
    '-   [x] item\n    > q\n',
    '-   [ ] item\n    ```\n    c\n    ```\n',
    '  -   [ ] item\n      # H\n',
  ])('reaches a block opener at the task item content column: %s', expectExact)

  it.each([
    '- t\n\n   ![A](a.jpg)\n',
    '- t\n\n    ![A](a.jpg)\n',
    '1. t\n\n    ![A](a.jpg)\n',
    '> - t\n>\n>    ![A](a.jpg)\n',
  ])('reads a lone image indented past the content column as a paragraph: %s', expectExact)

  it('declines an unclosed admonition on a quoted list line whose body is a nested list', () => {
    expect(() => parseCursorPrototype('> - ::: box\n>   - inner\n')).toThrow(UnsupportedCursorSyntax)
  })
})
