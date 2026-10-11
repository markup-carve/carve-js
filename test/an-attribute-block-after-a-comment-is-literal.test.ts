import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, parse } from '../src/index.js'

describe('an attribute block after a comment is literal', () => {
  it.each([
    ['*x*{% c %}{.k}', '<p><strong>x</strong>{.k}</p>'],
    ['[x]{% c %}{.k}', '<p>[x]{.k}</p>'],
    ['a{% b %}{.c} d', '<p>a{.c} d</p>'],
    ['[x] {% c %}{.k}', '<p>[x] {.k}</p>'],
    ['*x* {% c %}{.k}', '<p><strong>x</strong> {.k}</p>'],
    ['a {% b %}{.c} d', '<p>a {.c} d</p>'],
    ['*x*{% c %} {.k}', '<p><strong>x</strong> {.k}</p>'],
    ['*x*{% c %}{% d %}{.k}', '<p><strong>x</strong>{.k}</p>'],
    ['*x*{% c\nd %}{.k}', '<p><strong>x</strong>{.k}</p>'],
    ['*x*{% c %}{#i}', '<p><strong>x</strong>{<span class="tag"><strong>#i</strong></span>}</p>'],
  ])('preserves the attribute text in %s', (source, expected) => {
    expect(carveToHtml(source).trim()).toBe(expected)
    const canonical = carveToCarve(source)
    expect(carveToHtml(canonical).trim()).toBe(expected)
    expect(carveToCarve(canonical)).toBe(canonical)
  })

  it.each([
    ['*x*{.k}{% c %}', '<p><strong class="k">x</strong></p>'],
    ['`x`{.k}{% c %}', '<p><code class="k">x</code></p>'],
    ['*x*{.k}{% c %}{.tail}', '<p><strong class="k">x</strong>{.tail}</p>'],
  ])('keeps attributes before the comment in %s', (source, expected) => {
    expect(carveToHtml(source).trim()).toBe(expected)
  })

  it('does not attach the rejected attributes to the comment', () => {
    const document = parse('*x*{% c %}{.k}')
    const paragraph = document.children[0]!
    expect(paragraph.type).toBe('paragraph')
    if (paragraph.type !== 'paragraph') throw new Error('expected paragraph')
    const comment = paragraph.children.find(node => node.type === 'comment')
    expect(comment).toBeDefined()
    expect(comment?.attrs).toBeUndefined()
    expect(paragraph.children.find(node => node.type === 'strong')?.attrs).toBeUndefined()
  })
})
