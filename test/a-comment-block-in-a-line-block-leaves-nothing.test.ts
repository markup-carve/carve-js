// markup-carve/carve#4469 (CARVE-P9-047), corpus rows 855-a-comment-block-in-a-line-block-leaves-nothing.
import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, parse } from '../src/index.js'

const strip = (value: unknown): unknown =>
  JSON.parse(JSON.stringify(value, (key, node) => (key === 'pos' ? undefined : node)))

describe('a %%% pair in a line block', () => {
  it.each([
    ['leaves nothing', '::: |\n%%%\nsecret\n%%%\n:::\n', '<div class="line-block">\n\n</div>'],
    ['splits no stanza at a blank line in its body', '::: |\na\n%%%\none\n\ntwo\n%%%\nc\n:::\n',
      '<div class="line-block">\n  <p>a<br>\nc</p>\n</div>'],
    ['closes at an indented closer of the same run', '::: |\na\n%%%% t\nx\n  %%%%\nc\n:::\n',
      '<div class="line-block">\n  <p>a<br>\nc</p>\n</div>'],
  ])('%s', (_name, source, html) => {
    expect(carveToHtml(source)).toBe(html)
  })

  it.each([
    ['an opener with no closer is a comment line', '::: |\na\n%%%\nc\n:::\n', '<div class="line-block">\n  <p>a<br>\n<br>\nc</p>\n</div>'],
    ['an indented opener is verse', '::: |\n %%%\nx\n%%%\n:::\n', '<div class="line-block">\n  <p>&nbsp;%%%<br>\nx<br>\n</p>\n</div>'],
  ])('%s', (_name, source, html) => {
    expect(carveToHtml(source)).toBe(html)
  })

  it('is a block comment in the stanza', () => {
    expect(strip(parse('::: |\na\n%%% t\nx\n%%%\nc\n:::\n').children)).toEqual([{
      type: 'line_block',
      children: [{
        type: 'paragraph',
        children: [
          { type: 'text', value: 'a' },
          { type: 'comment', block: true, content: 't\nx' },
          { type: 'hard_break' },
          { type: 'text', value: 'c' },
        ],
      }],
    }])
  })

  it.each([
    '::: |\n%%%\nsecret\n%%%\n:::\n',
    '::: |\na\n%%%\none\n\ntwo\n%%%\nc\n:::\n',
    '::: |\n%%%\nx\n%%%\nc\n:::\n',
    '> ::: |\n> a\\\n> %%%\n> x\n> %%%\n> :::\n',
  ])('is written back unchanged: %j', (source) => {
    expect(carveToCarve(source)).toBe(source)
  })

  it('opens the next stanza when a blank line precedes it', () => {
    const source = '::: |\na\n\n%%%\nx\n%%%\n\nb\n:::\n'
    const once = carveToCarve(source)
    expect(once).toBe('::: |\na\n\n%%%\nx\n%%%\nb\n:::\n')
    expect(strip(parse(once).children)).toEqual(strip(parse(source).children))
    expect(carveToHtml(source)).toBe('<div class="line-block">\n  <p>a</p>\n  <p>b</p>\n</div>')
  })

  it('takes a fence no earlier comment line pairs with', () => {
    const source = '::: |\n%%% t\n%%%%\n  %%%%\na\n:::\n'
    const once = carveToCarve(source)
    expect(strip(parse(once).children)).toEqual(strip(parse(source).children))
    expect(carveToHtml(once)).toBe('<div class="line-block">\n  <p><br>\na</p>\n</div>')
  })
})
