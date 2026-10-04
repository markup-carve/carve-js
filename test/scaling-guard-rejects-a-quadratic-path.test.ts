import { describe, expect } from 'vitest'
import { expectScansLinearly, perfIt } from './helpers/scaling.js'

// The guards in this suite only mean something if they can refuse. The
// re-sample below `MAX_PER_BYTE_RATIO` makes that worth asserting rather than
// assuming: a retry that silently swallowed every reading would leave the
// whole family green and blind.
describe('the scaling guard can refuse', () => {
  perfIt('rejects a deliberately quadratic converter', () => {
    const quadratic = (input: string): void => {
      let sink = 0
      for (let i = 0; i < input.length; i++) for (let j = 0; j < input.length; j++) sink += input.charCodeAt(j)
      if (sink === -1) throw new Error('unreachable')
    }

    let threw: Error | undefined
    try {
      expectScansLinearly((source) => quadratic(source), 'x', { label: 'control quadratic', smallRepeats: 1500 })
    } catch (error) {
      threw = error as Error
    }

    expect(threw, 'the guard accepted a quadratic path').toBeDefined()
    expect(threw!.message).toContain('Per-byte cost grew')
  })
})
