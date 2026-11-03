import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const flat = (source: string) => carveToHtml(source).replace(/\n\s*/g, '')

// §17 L1c and CARVE-P9-013 property 3: a column-0 invisible run between the item and its sibling keeps the item's blank.
describe('an invisible tail keeps its blank across a column-0 comment (markup-carve/carve#5031)', () => {
  it.each([
    '- a\n\n  %% y\n%% z\n- c\n',
    '- a\n\n  {.x}\n%% z\n- c\n',
    '- a\n\n  %% y\n[s]: /v\n- c\n',
    '- a\n\n  %% y\n%% z\n\n- c\n',
    '1. a\n\n   *[A]: b\n%% z\n2. c\n',
    '> - a\n>\n>   %% y\n> %% z\n> - c\n',
  ])('%j', (source) => {
    expect(flat(source)).toContain('<li><p>c</p></li>')
  })

  it('loosens a nested list the same way', () => {
    expect(flat('- a\n  - b\n\n    %% y\n%% z\n  - c\n')).toContain('<ul><li><p>b</p></li><li><p>c</p></li></ul>')
  })

  it.each([
    '- a\n  {.x}\n%% z\n- c\n',
    '- a\n  %% y\n%% z\n- c\n',
  ])('stays tight without a blank before only invisible lines: %j', (source) => {
    expect(flat(source)).toContain('<li>c</li>')
  })
})

// The same item shape, its quote + follower at the item's content column (markup-carve/carve#5048).
describe('a quote + on a list marker line attaches a follower at the item content column', () => {
  it.each([
    ['- > +\n  : x\n  > q\n', '<ul><li><blockquote><p>: x</p><p>q</p></blockquote></li></ul>'],
    ['1. > +\n   : x\n   > q\n', '<ol><li><blockquote><p>: x</p><p>q</p></blockquote></li></ol>'],
    ['> - > +\n>   : x\n>   > q\n', '<blockquote><ul><li><blockquote><p>: x</p><p>q</p></blockquote></li></ul></blockquote>'],
    ['- a\n  * > +\n    x\n  * b\n', "<ul><li>a<ul><li><blockquote><p>x</p></blockquote></li><li>b</li></ul></li></ul>"],
  ])('%j', (source, html) => {
    expect(flat(source)).toBe(html)
  })

  it('refuses the + for a follower below the content column', () => {
    expect(flat('- > +\n: x\n')).toBe('<ul><li><blockquote></blockquote></li></ul><p>: x</p>')
  })
})
