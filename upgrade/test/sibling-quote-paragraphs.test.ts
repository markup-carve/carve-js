import { describe, expect, it } from 'vitest'
import { canWriteUpgrade, upgrade } from '../src/index.ts'

describe('the sibling quote after a list', () => {
  it('keeps its two old paragraphs outside the list', () => {
    const source = '- x\n  > a\nd\n> +\nq\nd\n  > b\n'
    const result = upgrade(source)
    expect(result.output).toBe('- x\n\n  > a\nd\n\n> q\nd\n>\n> b\n')
    expect(result.records.map((record) => record.entry)).toContain('U-125')
    expect(result.records.map((record) => record.entry)).toContain('U-126')
    expect(canWriteUpgrade(result)).toBe(true)
  })
})
