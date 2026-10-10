import { expect, it } from 'vitest'
import { djotReferenceLayout } from '../src/djot-reference-layout.js'

it.each([
  ['[a [b]][r]\n\n{.c}\n[r]: /u', '[a [b]](/u){.c}\n'],
  ['\\[a][r] [b][r]\n\n{.c}\n[r]: /u', '\\[a][r] [b](/u){.c}\n'],
  ['[a `[` b][r]\n\n{.c}\n[r]: /u', '[a `[` b](/u){.c}\n'],
  ['[a][r\\]x] [b][r]\n\n{.c}\n[r]: /u', '[a][r\\]x] [b](/u){.c}\n'],
  ['[_link_][]\n\n[link]: /u', '[_link_](/u)\n'],
])('preserves reference label boundaries: %s', (source, expected) => {
  expect(djotReferenceLayout(source, () => 0)).toBe(expected)
})

it('resolves a formatted reference after many unfinished labels', () => {
  const prefix = '[a '.repeat(8192)
  expect(djotReferenceLayout(prefix + '[_link_][]\n\n[link]: /u', () => 0))
    .toBe(prefix + '[_link_](/u)\n')
})

it.each([
  ['[a\n b][r]\n\n[r]: /u', '[a b][r]\n\n[r]: /u'],
  ['[a][r\nname]\n\n[r name]: /u', '[a][r name]\n\n[r name]: /u'],
  ['[b][^unknown\nlabel][c\nd]\n\n[c d]: /u', '[b][^unknown\nlabel][c\nd]\n\n[c d]: /u'],
])('preserves multiline reference matching: %s', (source, expected) => {
  expect(djotReferenceLayout(source, () => 0)).toBe(expected)
})

it('preserves a long unmatched multiline label', () => {
  const source = '[a][b\n' + 'prose line\n'.repeat(8192)
  expect(djotReferenceLayout(source, () => 0)).toBe(source)
})

it('keeps whitespace inside a multiline label', () => {
  const spaces = ' '.repeat(32768)
  const source = `[a${spaces}b\nc][r]\n\n[r]: /u`
  expect(djotReferenceLayout(source, () => 0)).toBe(`[a${spaces}b c][r]\n\n[r]: /u`)
})

it('merges definition attributes in source order', () => {
  const source = '[a][r]\n\n{x=first}\n{y=middle x=last}\n[r]: /u'
  expect(djotReferenceLayout(source, () => 0)).toBe('[a](/u){x=last y=middle}\n')
})

it('uses a short override instead of a long definition attribute', () => {
  const uses = '[a][r]{title=short} '.repeat(1024)
  const source = `${uses}\n\n{title="${'a'.repeat(32768)}"}\n[r]: /u`
  expect(djotReferenceLayout(source, () => 0)).toBe('[a](/u){title=short} '.repeat(1024) + '\n')
})
