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

  it('carries block attributes over an invisible comment and blank line', () => {
    const source = '{.chapter}{#first}\n\n%% note\n# Title\n'
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

  it.each([
    '> quote\n^ Caption\n',
    '> quote\n\n^ Caption\n',
    '```\ncode\n```\n^ Caption\n',
    '| Head |\n|---|\n| body |\n^ Caption\n',
  ])('keeps a caption on its block target: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it('declines source forms that have not been migrated', () => {
    expect(() => parseCursorPrototype('::: note\nBody\n:::')).toThrow(UnsupportedCursorSyntax)
    expect(() => parseCursorPrototype('Text\n::: note\nBody\n:::')).toThrow(UnsupportedCursorSyntax)
    expect(() => parseCursorPrototype('A\r\nB')).toThrow(UnsupportedCursorSyntax)
    expect(() => parseCursorPrototype('| a\\|b | c |\n|---|---|\n| x | y |')).toThrow(UnsupportedCursorSyntax)
  })
})
