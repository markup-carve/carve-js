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

  it('keeps an unclosed admonition on a quoted list line with a nested list body', () => {
    expectExact('> - ::: box\n>   - inner\n')
  })

  it.each([
    '> text\n~~~\n~~~\n  +\n- a\n```\n',
    '> >- q\n```\n    b\n```\n  +\n- b\n  ```\n',
  ])('ends quote attachment risk at a root code block: %s', expectExact)

  it('keeps a heading attached to a quote after a lazy item marker', () => {
    expectExact('+\n> q\n> text\n  - c\n+\n# Heading\n  text\n')
  })

  it.each([
    '> q\n>> - z\n> q\n>   - sub\n+\n',
    '> q\n- a\n>   - sub\n>   - sub\n+\n',
  ])('keeps a terminal plus in the quote paragraph after a list marker: %s', expectExact)

  it('attaches a list after a blank run below a note paragraph plus', () => {
    expectExact('[^f]: note\ntail\n  +\n\n\n    - d\n  \n')
  })

  it('returns a link definition to the root after a note owned list', () => {
    expectExact('[^f]: note\n    b\n\n    - d\n[r]: /u\n    - d\ntext\n:: term\n')
  })

  it('keeps a note owned list paragraph lazy below its source column', () => {
    expectExact('  :  nested\n[r]: /u\n[^f]: note\n  a\n\n    - d\n  text\n::: note\n')
  })

  it('attaches a definition line after a nested quote item plus', () => {
    expectExact('> q\n> >- q\n+\n:  meaning\n')
  })

  it('loosens a list when a blank precedes a nested link definition and paragraph', () => {
    expectExact('- b\n  :::\n- b\n\n  [r]: /u\n  text\n%% c\n')
  })

  it.each([
    '  ::: note\n- b\n  \n  text\n  text\n> > deep\n%% c\n',
    '> q\n  :::\n1. one\n  \n    b\n\n  - c\n::: note\n',
    ':::\n- a\n  \n    b\ntail\n  - c\ntext\n',
  ])('treats whitespace-only list gaps inside a colon as loose: %s', expectExact)

  it('loosens a nested colon list before an indented plus paragraph', () => {
    expectExact('  ::: note\n  ::: note\n- b\n  \n  +\n')
  })

  it.each([
    '    - d\n\n  \n> > deep\n  ~~~\n\n:::\n- b\n',
    '# Heading\n  - c\n\n  \n  :  nested\n>> - z\n',
    '- b\ntext\n  - c\n\n  \n> - x\n',
    '- b\n\n\n  \n\n>> 1. y\n  :  nested\n',
    '1. one\n\n  \n    - d\n- b\ntext\n',
  ])('counts whitespace-only lines in a list blank run: %s', expectExact)

  it.each([
    '\n- b\n  ```\n  \ntail\n>> - z\n:  meaning\n> - x\n',
    '[r]: /u\n- a\n  ```\n  \n- b\n:  meaning\n  - c\n[r]: /u\n',
    '- a\n>> 1. y\n\n  ```\n  \n',
  ])('uses a list code block end position at a whitespace-only fence boundary: %s', expectExact)

  it.each([
    ':: t\n:  +\n flush\n',
    ':: t\n:  +\n  flush\n',
  ])('ends an empty description before a below-column paragraph: %s', expectExact)

  it('opens a thematic break at the description body column', () => {
    expectExact(':: term\n:  definition\n    ***\ntail\n')
  })

  it.each([
    '::: note\npara\n```\ncode\n::::\n:::\nafter *b*\n',
    '::: note\n- %% c\n```\ncode\n::::\n:::\nafter *b*\n',
    '::: note\n> para\n> %% c\n```\ncode\n::::\n:::\nafter *b*\n',
    '::: note\n- {#x}\n```\ncode\n::::\n:::\nafter *b*\n',
  ])('uses a colon owned unclosed fence after a completed block: %s', expectExact)

  it.each([
    '::: note\n> > deep\n> >- q\n  a\n~~~\n  :  nested\n- b\n',
    '  :::\n  - c\n\n+\n  ```\n',
    '::: note\n> {#x}\n```\ncode\n::::\n:::\nafter *b*\n',
    '::: note\n- para\n  - {#x}\n```\ncode\n::::\n:::\nafter *b*\n',
  ])('declines an unclosed fence with an unresolved earlier owner: %s', (source) => {
    expect(() => parseCursorPrototype(source)).toThrow(UnsupportedCursorSyntax)
  })

  it.each([
    ':: t\n: d\n  - para\n    # H\nx\n',
    ':: t\n: d\n  - para\n    {#k}\nx\n',
  ])('reads a list block at the description body column: %s', expectExact)

  it('declines a description list with an unresolved lazy tail', () => {
    expect(() => parseCursorPrototype(':: term\n:  meaning\n    - d\ntext\n  +\n+\n'))
      .toThrow(UnsupportedCursorSyntax)
  })

  it('declines a late nested link definition after an earlier unresolved reference', () => {
    expect(() => parseCursorPrototype('[t][r]\n\n- b\ntail\n  [r]: /u\n'))
      .toThrow(UnsupportedCursorSyntax)
  })

  it('does not collect a nested note from a duplicate footnote body', () => {
    expectExact('[^a]: x\n\n[^a]: y\n\n   [^b]: z\n   tail\n')
  })
})
