import { describe, it, expect } from 'vitest'
import { carveToCarve, parse } from '../src/index.js'
import type { List } from '../src/ast.js'

const firstList = (src: string): List => {
  const doc = parse(src)
  const node = doc.children[0]!
  expect(node.type).toBe('list')
  return node as List
}

describe('ordered-list delimiter in the AST', () => {
  it('records a period delimiter', () => {
    expect(firstList('1. a\n2. b').delim).toBe('.')
  })

  it('records a paren delimiter', () => {
    expect(firstList('1) a\n2) b').delim).toBe(')')
  })

  it('records the delimiter for alpha and roman dialects', () => {
    expect(firstList('a) x\nb) y').delim).toBe(')')
    expect(firstList('i. x\nii. y').delim).toBe('.')
  })

  it('is absent on unordered lists', () => {
    expect(firstList('- a\n- b').delim).toBeUndefined()
  })

  it('does not change fmt output - canonical form stays 1.', () => {
    // Byte-parity with the other implementations: renderCarve deliberately
    // ignores the source delimiter (metadata for AST consumers only).
    expect(carveToCarve('1) a\n2) b')).toBe('1. a\n2. b\n')
  })
})
