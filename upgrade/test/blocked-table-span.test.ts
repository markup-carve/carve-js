import { describe, expect, it } from 'vitest'
import { upgrade } from '../src/upgrade.ts'

describe('U-259 blocked table span markers', () => {
  it('removes a first row caret that the 0.1 parse kept empty', () => {
    const result = upgrade('|= ^ |\n| x |\n')
    expect(result.output).toBe('|=  |\n| x |\n')
    expect(result.check).toBe('pass')
    expect(result.records.map((record) => record.entry)).toContain('U-259')
  })

  it('removes a first column left marker that cannot join a cell', () => {
    const result = upgrade('| < |\n| x |\n')
    expect(result.output).toBe('|  |\n| x |\n')
    expect(result.check).toBe('pass')
  })

  it('leaves a caret that joins the cell above alone', () => {
    const source = '| a |\n| ^ |\n'
    expect(upgrade(source).output).toBe(source)
  })
})
