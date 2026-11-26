import { describe, expect, it } from 'vitest'
import { canWriteUpgrade, upgrade } from '../src/index.ts'

const entries = (input: string): string[] => upgrade(input).records.map((record) => record.entry)

describe('carve#6717: an indented line 0.1 read below an abbreviation definition (U-443)', () => {
  it.each([
    ['one indented line', '*[A]: B\n  x\n', '*[A]: B\n\n  x\n'],
    ['two indented lines', '*[A]: B\n  x\n  y\n', '*[A]: B\n\n  x\n  y\n'],
    ['a tab indent', '*[A]: B\n\tx\n', '*[A]: B\n\n\tx\n'],
    ['a lazy line after it', '*[A]: B\n  x\nlazy\n', '*[A]: B\n\n  x\nlazy\n'],
    ['a list marker', '*[A]: B\n  - y\n', '*[A]: B\n\n  - y\n'],
    ['a second definition above', '*[A]: B\n*[C]: D\n  x\n', '*[A]: B\n*[C]: D\n\n  x\n'],
    ['a use below', '*[A]: B\n  x\n\nA here.\n', '*[A]: B\n\n  x\n\nA here.\n'],
  ])('writes a blank line above %s', (_name, input, output) => {
    const result = upgrade(input)
    expect(result.output).toBe(output)
    expect(canWriteUpgrade(result)).toBe(true)
    expect(entries(input)).toContain('U-443')
  })

  it.each([
    ['an unindented line', '*[A]: B\nx\n'],
    ['an indented table row', '*[A]: B\n  | a |\n'],
    ['an indented fence', '*[A]: B\n  ```\n  c\n  ```\n'],
    ['an indented comment line', '*[A]: B\n  %% c\n'],
  ])('leaves %s alone', (_name, input) => {
    expect(entries(input)).not.toContain('U-443')
    expect(canWriteUpgrade(upgrade(input))).toBe(true)
  })
})
