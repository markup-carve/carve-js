import { describe, expect, it } from 'vitest'
import { DEFAULT_DENIED_SCHEMES, isUrlAllowed, render, urlScheme } from '../src/index.ts'

describe('public URL sink policy', () => {
  it('C2-H-159, C2-H-173: the public predicate and deny list match the renderer', () => {
    expect(DEFAULT_DENIED_SCHEMES).toContain('javascript')
    expect(urlScheme('ja\u0001va\ufffdscript:X')).toBe('javascript')
    expect(isUrlAllowed('ja\u0001va\ufffdscript:X')).toBe(false)
    expect(isUrlAllowed('/relative')).toBe(true)
    expect(isUrlAllowed('https://example.com', { allow: ['https'] })).toBe(true)
    expect(isUrlAllowed('ftp://example.com', { allow: ['https'] })).toBe(false)
    expect(render('[x](ja\u0001va\ufffdscript:X)')).toContain('href=""')
  })
})
