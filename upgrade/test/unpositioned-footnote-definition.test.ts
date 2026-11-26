import { describe, expect, it } from 'vitest'
import { canWriteUpgrade, upgrade } from '../src/index.ts'

describe('footnote definitions whose old body is positioned but the definition is not', () => {
  it('moves the whole definition to column zero using its body range', () => {
    const source = ' [^a]: intro\n %% c\n   more\n\nsee[^a]\n'
    const result = upgrade(source)
    expect(result.output).toBe('[^a]: intro\n%% c\n  more\n\nsee[^a]\n')
    expect(result.records.some((record) => record.entry === 'U-039')).toBe(true)
    expect(canWriteUpgrade(result)).toBe(true)
  })
})
