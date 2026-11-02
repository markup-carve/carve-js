import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const compact = (source: string): string => carveToHtml(source).replace(/>\s+</g, '><').trim()

// A bare run of another width opens a nested div, after an invalid opener too (carve#4863).
describe('a div closes only on a run of its own width', () => {
  it.each([
    ['a wider run', ':::\n:::e\n::::\nq\n:::\nafter\n', '<div><p>:::e</p><div><p>q</p><div><p>after</p></div></div></div>'],
    ['text before the invalid opener', ':::\nx\n:::e\n::::\n:::\nafter\n', '<div><p>x\n:::e</p><div><div><p>after</p></div></div></div>'],
    ['a wider div', '::::\n:::e\n:::\nq\n::::\nafter\n', '<div><p>:::e</p><div><p>q</p><div><p>after</p></div></div></div>'],
    ['a valid paragraph still lets the run open', ':::\nx\n::::\nq\n::::\n:::\nafter\n', '<div><p>x</p><div><p>q</p></div></div><p>after</p>'],
    ['a blank before the run', ':::\n:::e\n\n::::\nq\n::::\n:::\nafter\n', '<div><p>:::e</p><div><p>q</p></div></div><p>after</p>'],
  ])('%s', (_name, source, html) => {
    expect(compact(source)).toBe(html)
  })
})

// CARVE-P9-047: a `%%%` opener indented by at most three spaces is a comment in verse.
describe('a comment block in a line block', () => {
  it.each([
    ['two spaces', '::: |\n  %%%\n  secret\n  %%%\n:::\n', '<div class="line-block"></div>'],
    ['three spaces', '::: |\na\n   %%%\nsecret\n%%%\nc\n:::\n', '<div class="line-block"><p>a<br>\nc</p></div>'],
  ])('leaves nothing: %s', (_name, source, html) => {
    expect(compact(source)).toBe(html)
  })

  it('four spaces stay verse', () => {
    expect(compact('::: |\n    %%%\n:::\n')).toContain('%%%')
  })
})
