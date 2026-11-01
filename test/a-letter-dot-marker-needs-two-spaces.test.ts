import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

describe('letter and roman dot markers (carve#4811)', () => {
  it.each([
    ['e. g. foo', '<p>e. g. foo</p>'],
    ['I. one\nII. two', '<p>I. one\nII. two</p>'],
    ['a.{#x} one', '<p>a.{<span class="tag"><strong>#x</strong></span>} one</p>'],
    ['1. one', '<ol>\n  <li>one</li>\n</ol>'],
    ['A) one', '<ol type="A" data-delim=")">\n  <li>one</li>\n</ol>'],
    ['a.  one\nb.  two', '<ol type="a">\n  <li>one</li>\n  <li>two</li>\n</ol>'],
  ])('reads %j by the separator rule', (source, expected) => {
    expect(carveToHtml(source)).toBe(expected)
  })

  it.each([
    ['a.  one', 'a.  one\n'],
    ['iv.  four', 'iv.  four\n'],
    ['a.{#x}  one', 'a.{#x}  one\n'],
    ['A) one', 'A) one\n'],
  ])('writes %j with a parseable separator', (source, expected) => {
    expect(carveToCarve(source)).toBe(expected)
  })
})
