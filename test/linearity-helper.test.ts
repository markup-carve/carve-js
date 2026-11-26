import { describe, expect, it } from 'vitest'
import { LINEARITY_LIMIT, linearityExcess } from './support/linearity.ts'

const linear = (n: number): number => {
  let sum = 0
  for (let i = 0; i < n * 200; i++) sum = (sum + i * 7) % 1_000_003
  return sum
}

const quadratic = (n: number): number => {
  let sum = 0
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) sum = (sum + i * j) % 1_000_003
  return sum
}

describe('linearityExcess', () => {
  it('passes linear work', () => {
    expect(linearityExcess(() => linear(2_000), () => linear(16_000), 8)).toBeLessThan(LINEARITY_LIMIT)
  })

  it('rejects quadratic work', () => {
    expect(linearityExcess(() => quadratic(500), () => quadratic(4_000), 8)).toBeGreaterThan(LINEARITY_LIMIT)
  })

  it('rejects a quadratic term mixed with a linear one', () => {
    const mixed = (n: number): number => linear(n) + quadratic(n)
    expect(linearityExcess(() => mixed(400), () => mixed(3_200), 8)).toBeGreaterThan(LINEARITY_LIMIT)
  })
})
