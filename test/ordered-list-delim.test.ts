import { describe, it, expect } from 'vitest'
import { carveToCarve, carveToHtml, parse } from '../src/index.js'
import type { List } from '../src/ast.js'

const firstList = (src: string): List => {
  const doc = parse(src)
  const node = doc.children[0]!
  expect(node.type).toBe('list')
  return node as List
}

describe('ordered-list delimiter in the AST', () => {
  it('omits the default period delimiter (carve#2828)', () => {
    // The schema calls `.` absent, so recording it would give one document two
    // legal trees and leave a consumer comparing engines or versions to guess
    // which it holds.
    expect('delim' in firstList('1. a\n2. b')).toBe(false)
  })

  it('records a paren delimiter', () => {
    expect(firstList('1) a\n2) b').delim).toBe(')')
  })

  it('records the delimiter for alpha and roman dialects', () => {
    expect(firstList('a) x\nb) y').delim).toBe(')')
    expect('delim' in firstList('i. x\nii. y')).toBe(false)
  })

  it('is absent on unordered lists', () => {
    expect(firstList('- a\n- b').delim).toBeUndefined()
  })

  it('records only a non-default bullet character (carve#2828)', () => {
    // The control that separates the ruling from deleting the field: `*` is
    // still recorded, and only `-` - the value absence already spells - is not.
    expect('bulletChar' in firstList('- a\n- b')).toBe(false)
    expect(firstList('* a\n* b').bulletChar).toBe('*')
    expect(firstList('1. a').bulletChar).toBeUndefined()
  })

  it('adjacent sibling lists separated only by their marker stay separate (issue 286)', () => {
    // fmt invariant: toHtml(fmt(x)) === toHtml(x). Before marker
    // preservation these merged into one list on re-parse.
    for (const src of ['1. a\n1) b', '1. a\n\n1) b', '- a\n* b', '- a\n\n* b']) {
      const formatted = carveToCarve(src)
      expect(carveToCarve(formatted)).toBe(formatted)
      expect(carveToHtml(formatted)).toBe(carveToHtml(src))
    }
  })

  it('fmt preserves the authored delimiter (issue 286)', () => {
    // The delimiter is semantic (§11): normalizing `1)` to `1.` would merge
    // adjacent lists separated only by their delimiter.
    expect(carveToCarve('1) a\n2) b')).toBe('1) a\n2) b\n')
    expect(carveToCarve('1. a\n2. b')).toBe('1. a\n2. b\n')
  })
})
