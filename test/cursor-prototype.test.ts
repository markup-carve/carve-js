import { describe, expect, it } from 'vitest'
import { parse, renderHtml, resolve } from '../src/index.js'
import { parseCursorPrototype, UnsupportedCursorSyntax } from '../src/parse/cursor-prototype.js'

describe('experimental block cursor', () => {
  it('matches the public AST and HTML across its migrated block families', () => {
    const source = [
      '# Unicode 😀',
      '',
      'A [link][site] with *strong* text.',
      '',
      '- first item',
      '- second item',
      '  - nested item',
      '  - another item',
      '',
      '> A quoted /word/.',
      '',
      '```js',
      'const n = 1',
      '```',
      '',
      '| Name | Value |',
      '|:---|---:|',
      '| left | 1 |',
      '',
      '[site]: https://example.com',
      '',
    ].join('\n')
    const reference = parse(source)
    const cursor = parseCursorPrototype(source)
    expect(cursor).toStrictEqual(reference)
    expect(renderHtml(resolve(cursor))).toBe(renderHtml(resolve(reference)))
  })

  it('keeps fenced definitions inert and accepts longer valid closers', () => {
    const source = [
      '#   Heading',
      '',
      '```',
      '[ref]: https://wrong.example',
      '````',
      '',
      '[label][ref]',
      '',
    ].join('\n')
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it('resolves root abbreviations and retains line comments', () => {
    const source = 'HTML is short.\n\n*[HTML]: Hyper Text\n\n%% editorial note\n'
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it('keeps a root block comment and ignores definitions inside it', () => {
    const source = '%%% note\n[ref]: /wrong\n%%%\n\n[ref][ref]\n'
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['[^f]: note\n\nSee [^f].\n', '[^f]:   note\n', '[^f]: {empty}\n',
    '[^__proto__]: note\n', '[^f]: a\n\n[^f]: b\n'])
  ('keeps a one-line footnote definition in the document sidecar: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it('declines a multiline footnote until its body collector is migrated', () => {
    expect(() => parseCursorPrototype('[^f]: note\n  more\n')).toThrow(UnsupportedCursorSyntax)
    expect(() => parseCursorPrototype('[^f]: note\n\n  more\n')).toThrow(UnsupportedCursorSyntax)
    expect(() => parseCursorPrototype('[^f]: \n')).toThrow(UnsupportedCursorSyntax)
  })

  it.each(['- [x] done\n', '- [ ] todo\n', '- [-] dropped\n', '- [+] plain\n'])
  ('preserves authored task list state: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['---\n', '***\n', '___\n'])('preserves thematic break spelling: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it('carries block attributes over an invisible comment and blank line', () => {
    const source = '{.chapter}{#first}\n\n%% note\n# Title\n'
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it('consumes a loose-list attribute before publishing the AST', () => {
    const source = '{loose}\n1. Note text.\n'
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['  text\n', '   # H\n', 'a\n  b\n', '  a\n  b\n'])
  ('trims paragraph indentation without changing source positions: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it('keeps a heading marker without text as a paragraph', () => {
    const source = '#  \n'
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each([
    'a. apple\nb. banana\n',
    'iii. three\niv. four\n',
    '. first\n. second\n',
    '1) first\n2) second\n',
    '* first\n* second\n',
  ])('retains authored list marker dialect: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['-{.c} A classed item.\n', '-{#k} [x] bare\n',
    '.{#x} attributed\n', '-{title="a}b"} text\n',
    '-{.c} a\n  b\n', '.{#x} a\n  b\n'])
  ('preserves an attribute on a list item marker: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it('keeps task state before item attributes in the serialized AST', () => {
    const source = '-{#k} [x] bare\n  # inside\n'
    expect(JSON.stringify(parseCursorPrototype(source))).toBe(JSON.stringify(parse(source)))
  })

  it('promotes a paragraph containing one image to the public block node', () => {
    const source = '# Gallery\n\n![alt](photo.png)\n'
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each([
    '![alt](photo.png)\n^ Caption\n',
    '![alt](photo.png)\n\n^ Caption\n',
    '![alt](photo.png)\n\n\n^ Caption\n',
  ])('preserves image caption reach: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it('keeps a caption-looking line in a paragraph led by an image and other text', () => {
    const source = '![a](p.png) text\n^ Caption\n'
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it('continues the outer list item after a blank below a nested list', () => {
    const source = '- a\n  - b\n\n  c\n'
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it('keeps markers on a marker line in one nested list', () => {
    const source = '- - A\n\n    second\n  - B\n'
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['- a\n+\nc\n- b\n', '1. a\n+\nc\n2. b\n'])
  ('attaches a single paragraph after a root list continuation marker: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it('declines a plus that precedes an indented line', () => {
    expect(() => parseCursorPrototype('- a\n+\n  c\n')).toThrow(UnsupportedCursorSyntax)
  })

  it.each([
    '- ```\n  a\n\n  b\n  ```\n',
    '- ```\n  - x\n  ```\n',
    '- a\n\n  b\n',
  ])('keeps a list item body intact across its lines: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['- a\n\n  > q\n', '- a\n\n  # H\n',
    '- a\n\n  b\n', '- > a\n\n  > b\n',
    '- a\n\n  {.x}\n  b\n', '- a\n\n  {.x}\n  # H\n'])
  ('classifies a blank before a new item block: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each([
    '> [a]: /x\n\nSee [t][a].\n',
    '- [a]: /x\n\nSee [t][a].\n',
  ])('declines a nested reference definition until its prepass is migrated: %s', (source) => {
    expect(() => parseCursorPrototype(source)).toThrow(UnsupportedCursorSyntax)
  })

  it('parses nested blocks through the same cursor inside a quote', () => {
    const source = '> # Heading\n>\n> - one\n> - two\n>\n> > nested quote\n'
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['::: note\nBody\n:::\n', '::: toc\nBody\n:::\n',
    '::: note\n# Heading\n\n- item\n:::\n'])
  ('parses a simple named container through the shared block cursor: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['::: figure\nBody\n:::\n', '::: list-table\n- item\n:::\n',
    '> ::: note\n> Body\n> :::\n', '::: note\n```\n:::\n```\n:::\n'])
  ('declines specialized or nested containers until their ownership is migrated: %s', (source) => {
    expect(() => parseCursorPrototype(source)).toThrow(UnsupportedCursorSyntax)
  })

  it.each([
    '- > quote\n',
    '- ```\n  code\n  ```\n',
    '- # Heading\n',
    '- | a |\n  |---|\n  | b |\n',
    '- first\n  > quote\n',
  ])('parses a block inside a list item: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each([
    '> quote\n^ Caption\n',
    '> quote\n\n^ Caption\n',
    '```\ncode\n```\n^ Caption\n',
    '| Head |\n|---|\n| body |\n^ Caption\n',
  ])('keeps a caption on its block target: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it('declines source forms that have not been migrated', () => {
    expect(() => parseCursorPrototype('::: note\n::: tip\nBody\n:::\n:::')).toThrow(UnsupportedCursorSyntax)
    expect(() => parseCursorPrototype('::: note\nBody\n')).toThrow(UnsupportedCursorSyntax)
    expect(() => parseCursorPrototype('A\r\nB')).toThrow(UnsupportedCursorSyntax)
    expect(() => parseCursorPrototype('| a\\|b | c |\n|---|---|\n| x | y |')).toThrow(UnsupportedCursorSyntax)
  })
})
