import { describe, it, expect } from 'vitest'
import { parse } from '../src/index.js'
import type { List } from '../src/index.js'

// A blank line inside a marker-line note's body is the note's, so it does not
// loosen the item that hoists the note (corpus 585-2, 586-2). A comment closes
// the note's paragraph: a paragraph after a later blank is the item's own.
const tight = (src: string): boolean => (parse(src).children[0] as List).tight

describe('a blank inside a marker-line note', () => {
  it.each([
    ['comment and fence after the blank (585-2)', '- [^n]: text\n\n    %% c\n    ```\n    code\n    ```\nafter [^n]\n'],
    ['unclosed fence after the blank (586-2)', '- [^n]: text\n\n    %% c\n    ```\n    code\n'],
    ['second note paragraph', '- [^n]: text\n\n    more\n- b\n'],
    ['closed fence', '- [^n]: text\n\n    ```\n    x\n    ```\n- b\n'],
    ['comment alone', '- [^n]: text\n\n    %% c\n- b\n'],
  ])('keeps the list tight: %s', (_name, src) => {
    expect(tight(src)).toBe(true)
  })

  it.each([
    ['item paragraph at its content column', '- [^n]: text\n\n  own\n'],
    ['paragraph after a comment closed the note', '- [^n]: text\n    %% c\n\n    more\n- b\n'],
    ['paragraph after a blank, comment and blank', '- [^n]: text\n\n    %% c\n\n    more\n- b\n'],
    ['blank after the comment that closed the note', '- [^n]: text\n\n    %% c\n\n    %% d\n- b\n'],
    ['blanks before the comment do not count toward a hard boundary', '- [^n]: text\n\n\n    %% c\n\n- b\n'],
  ])('still loosens: %s', (_name, src) => {
    expect(tight(src)).toBe(false)
  })
})
