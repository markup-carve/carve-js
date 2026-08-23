import { describe, expect, it } from 'vitest'
import { carveToHtml, djotToCarve } from '../src/index.js'

describe('djotToCarve', () => {
  it.each([
    ['_em_', '/em/'],
    ['H~2~O', 'H{,2,}O'],
    ['x^2^', 'x{^2^}'],
    ['**bold**', '*bold*'],
    ['~~old~~', '~old~'],
    ['snake_case_name', 'snake{/case/}name'],
    ['+ one\n+ two', '- one\n- two'],
  ])('converts %s', (source, expected) => expect(djotToCarve(source)).toBe(expected))

  it.each([
    ['a #y b', 'a \\#y b'],
    ['a /x/ b', 'a \\/x/ b'],
    ['a =x= b', 'a \\=x= b'],
    ['a @user b', 'a \\@user b'],
    ['%%hidden%% text', '\\%%hidden%% text'],
    ['a {,x,} b', 'a \\{,x,} b'],
  ])('escapes Carve-only text in %s', (source, expected) => {
    expect(djotToCarve(source)).toBe(expected)
  })

  it('does not rewrite code or link destinations', () => {
    const source = '`_x_` [home](/~user/)\n\n```\n_x_\n```'
    expect(djotToCarve(source)).toBe(source)
  })

  it('preserves the source document when rendered', () => {
    const html = carveToHtml(djotToCarve('a #y b and /x/ plus %%hidden%% text'))
    expect(html).toContain('a #y b and /x/ plus %%hidden%% text')
    expect(html).not.toContain('class="tag"')
    expect(html).not.toContain('<em>')
  })

  it('keeps a long blank run inside one Djot list', () => {
    expect(djotToCarve('1. one\n\n\n\n2. two')).toBe('1. one\n\n2. two')
  })
})
