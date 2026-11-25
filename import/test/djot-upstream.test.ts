import { describe, expect, it } from 'vitest'
import { importDocument } from '../src/index.ts'

const source = (input: string): string => importDocument(input, { from: 'djot' }).source

describe('Djot import reads with the upstream djot.js fixes that 0.3.2 lacks', () => {
  it('drops a block attribute that a blank line detaches (carve#6641, djot.js df32bf3)', () => {
    expect(source('{#id .class}\n\nA paragraph\n')).toBe('A paragraph\n')
    expect(source('> {#id}\n>\n> para\n')).toBe('> para\n')
    expect(source('{.a}\n\n{.b}\npara\n')).toBe('{.b}\npara\n')
    expect(source('{#id}\npara\n')).toBe('{#id}\npara\n')
  })

  it('keeps an escaped dollar before a code span as text (carve#6642, djot.js 1d4843b)', () => {
    expect(source('\\$`e=mc^2`\n')).toBe('\\$`e=mc^2`\n')
    expect(source('$`x`\n')).toBe('$`x`\n')
  })

  it('opens display math after an even backslash run (carve-js#5590)', () => {
    expect(source('\\\\$$`e=mc^2`\n')).toBe('\\\\$$`e=mc^2`\n')
    expect(source('a \\\\\\\\$$`x` b\n')).toBe('a \\\\\\\\$$`x` b\n')
    expect(source('_a \\\\$$`x`_\n')).toBe('/a \\\\$$`x`/\n')
    expect(source('\\\\\\$$`e=mc^2`\n')).toBe('\\\\\\$$`e=mc^2`\n')
    expect(source('\\$$`x`\n')).toBe('\\$$`x`\n')
    expect(source('$$`x`\n')).toBe('$$`x`\n')
  })

  it('keeps brackets as text before an invalid attribute block (carve#6643, djot.js 00eb258)', () => {
    expect(source('[not a span]{#a<b}\n')).toBe('[not a span]{\\#a<b}\n')
    expect(source('[*not* a span]{#a<b}\n')).toBe('[*not* a span]{\\#a<b}\n')
    expect(source('[not a span]{#a\n')).toBe('[not a span]{\\#a\n')
    expect(source('[a]{.c}\n')).toBe('[a]{.c}\n')
  })

  it('starts a new task list where the bullet changes (carve#6644, djot.js 7892004)', () => {
    expect(source('- [ ] foo\n+ [ ] bar\n* [ ] baz\n')).toBe('- [ ] foo\n\n\n\n- [ ] bar\n\n\n\n- [ ] baz\n')
    expect(source('- [ ] a\n- [x] b\n')).toBe('- [ ] a\n- [x] b\n')
  })

  it('never closes emphasis on a delimiter inside a link destination (carve#6645, djot.js 713a417)', () => {
    expect(source('_[link](http://example.com?foo_bar=1), more text_\n'))
      .toBe('/[link](http://example.com?foo_bar=1), more text/\n')
    expect(source('*[closed](hello*)\n')).toBe('*[closed](hello*)\n')
    expect(source('_hello [link](a_b) world_\n')).toBe('/hello [link](a_b) world/\n')
    expect(source('{=[a](b=c) d=}\n')).toBe('{=[a](b=c) d=}\n')
  })
})
