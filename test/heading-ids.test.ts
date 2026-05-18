import { describe, it, expect } from 'vitest'
import { slugify, inlineText } from '../src/heading-ids.js'
import type { InlineNode } from '../src/ast.js'

describe('slugify', () => {
  it('lowercases and dashes spaces', () => {
    expect(slugify('Getting Started')).toBe('getting-started')
  })
  it('preserves Unicode letters, dashes separators', () => {
    expect(slugify('Café & Crème')).toBe('café-crème')
    expect(slugify('Über uns')).toBe('über-uns')
    expect(slugify('日本語の見出し')).toBe('日本語の見出し')
  })
  it('deletes CSS-unsafe punctuation before dashing', () => {
    expect(slugify("What's New?")).toBe('whats-new')
    expect(slugify('RFC 2119: Key Words')).toBe('rfc-2119-key-words')
  })
  it('preserves underscore and hyphen', () => {
    expect(slugify('user_id field')).toBe('user_id-field')
  })
  it('prefixes section- when starting with a digit', () => {
    expect(slugify('2024 Recap')).toBe('section-2024-recap')
  })
  it('falls back to section when empty', () => {
    expect(slugify('!!!')).toBe('section')
    expect(slugify('')).toBe('section')
    expect(slugify('   ')).toBe('section')
  })
  it('collapses and trims dashes', () => {
    expect(slugify('a -- b')).toBe('a-b')
    expect(slugify('  spaced  ')).toBe('spaced')
  })
})

describe('inlineText', () => {
  it('flattens emphasis, keeps code, ignores images/breaks', () => {
    const nodes: InlineNode[] = [
      { type: 'text', value: 'Why ' },
      { type: 'italic', children: [{ type: 'text', value: 'Carve' }] },
      { type: 'text', value: '?' },
    ]
    expect(inlineText(nodes)).toBe('Why Carve?')
  })
  it('includes inline code text', () => {
    const nodes: InlineNode[] = [
      { type: 'text', value: 'The ' },
      { type: 'code', value: 'id' },
      { type: 'text', value: ' field' },
    ]
    expect(inlineText(nodes)).toBe('The id field')
  })
})
