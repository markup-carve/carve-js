import { describe, expect, it } from 'vitest'
import { upgrade } from '../src/index.ts'

describe('carve#6508: a comment line below a term', () => {
  it('U-433 writes the blank line above it instead of moving the term mark', () => {
    const result = upgrade(':: t\n %% c\n   more\n')
    expect(result.output).toBe(':: t\n\n %% c\n   more\n')
    expect(result.check).toBe('pass')
  })

  it('leaves the description rescue of another term in the same source alone', () => {
    const result = upgrade(':: z\n %% c\n: d\n\n:: t\n :  d\n   {.k}\n   # H\n')
    expect(result.output).toBe(':: z\n %% c\n: d\n\n:: t\n:  d\n\n{.k}\n# H\n')
    expect(result.check).toBe('pass')
  })
})
