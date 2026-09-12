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

  it('keeps site frontmatter out of Djot delimiter conversion', () => {
    const source = '---\nkey: my_long_value\n---\n\nBody.'
    expect(djotToCarve(source)).toBe(source)
  })

  it('preserves multiple footnote references and definitions', () => {
    const source = "One.[^foo] Two.[^bar]\n\n[^foo]: First.\n\n[^bar]: Second."
    expect(djotToCarve(source)).toBe(source)
  })

  it('converts Djot definition-list terms and block bodies', () => {
    const source = ': orange\n\n  A citrus fruit.\n\n: apple\n\n  A pome.\n\n  A second paragraph.'
    expect(djotToCarve(source)).toBe(
      '{loose}\n:: orange\n\n:  A citrus fruit.\n\n:: apple\n\n:  A pome.\n\n   A second paragraph.',
    )
    expect(carveToHtml(djotToCarve(source))).toContain('<dl>')
  })

  it('does not start a definition list in the middle of a Djot paragraph', () => {
    expect(djotToCarve('Paragraph\n: still paragraph')).toBe('Paragraph\n: still paragraph')
  })

  it.each([
    [': term\n\n\tTabbed body.', 'Tabbed body.'],
    [': term\n\n  ```\n  code\n  ```', '<pre><code>code'],
    [': outer\n\n  : inner\n\n    Inner body.', '<dl>'],
    ['> : term\n>\n>   body', '<blockquote>'],
  ])('keeps structural Djot content for %s', (source, needle) => {
    expect(carveToHtml(djotToCarve(source))).toContain(needle)
  })

  it.each([
    ['--- yaml\ntitle: a_b_c\n---\n\nBody.', '--- yaml\ntitle: a_b_c\n---\n\nBody.'],
    ['---\ntitle: a_b_c\n---  \nBody.', '---\ntitle: a_b_c\n---  \nBody.'],
    ['---\nkey: value\n---', '---\nkey: value\n---'],
  ])('preserves the complete frontmatter envelope in %s', (source, expected) => {
    expect(djotToCarve(source)).toBe(expected)
  })

  it('keeps code at the start of a definition term', () => {
    expect(djotToCarve(': `code` rest\n\n  body')).toContain(':: `code` rest')
  })

  it('leaves a tight Djot term continuation in the term', () => {
    const html = carveToHtml(djotToCarve(': fruit\n  A thing.'))
    expect(html).toContain('<dt>fruit')
    expect(html).toContain('A thing.</dt>')
  })

  it('recognizes an empty frontmatter envelope before a definition list', () => {
    expect(carveToHtml(djotToCarve('---\n---\n: term\n\n  body'))).toContain('<dl>')
  })
})
