import { describe, expect, it } from 'vitest'
import { upgrade } from '../src/index.ts'

describe('U-038: a definition in an empty quote', () => {
  it('keeps the empty quote when hoisting its definition', () => {
    const result = upgrade('> [f]: ~\n/\n')
    expect(result.output).toBe('>\n[f]: ~\n/\n')
    expect(result.check).toBe('pass')
    expect(result.records.map((record) => record.entry)).toContain('U-038')
  })

  it('does not add an empty quote when the quote already has content', () => {
    const result = upgrade('> See [f][]\n>\n> [f]: ~\n')
    expect(result.output).toBe('> See [f][]\n\n[f]: ~\n')
    expect(result.check).toBe('pass')
  })

  it('keeps a consumed definition as an empty item in the quote', () => {
    const result = upgrade('> - [d]: u\n\n[go][d]\n')
    expect(result.output).toBe('> - {% %}\n\n[d]: u\n\n[go][d]\n')
    expect(result.check).toBe('pass')
  })
})
