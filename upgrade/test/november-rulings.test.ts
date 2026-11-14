import { expect, it } from 'vitest'
import { upgrade } from '../src/index.ts'

it('C2-B-046, U-120: ordered task text is escaped after decimal and Roman markers', () => {
  for (const source of ['1. [ ] x\n', 'II) [x] y\n']) {
    const result = upgrade(source)
    expect(result.check).toBe('pass')
    expect(result.output).toContain('\\[')
    expect(result.records.map((record) => record.entry)).toContain('U-120')
    expect(upgrade(result.output).output).toBe(result.output)
  }
})

it('C2-I-072, U-121: defined link and image shortcuts remain text', () => {
  for (const source of ['[text]\n\n[text]: /u\n', '![text]\n\n[text]: /u\n']) {
    const result = upgrade(source)
    expect(result.check).toBe('pass')
    expect(result.output).toContain('\\[text]')
    expect(result.records.map((record) => record.entry)).toContain('U-121')
    expect(upgrade(result.output).output).toBe(result.output)
  }
})
