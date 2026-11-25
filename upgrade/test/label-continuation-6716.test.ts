import { describe, expect, it } from 'vitest'
import { canWriteUpgrade, upgrade } from '../src/index.ts'

const entries = (input: string): string[] => upgrade(input).records.map((record) => record.entry)

describe('carve#6716: a line 0.1 joined to a caption (U-442)', () => {
  it.each([
    ['an image caption', '![a](a.png)\n^ cap one\ncontinued\n', '![a](a.png)\n^ cap one\n  continued\n'],
    ['a table caption', '| a |\n^ cap\nNext prose.\n', '| a |\n^ cap\n  Next prose.\n'],
    ['a quote attribution', '> q\n^ Author\nmore\n', '> q\n^ Author\n  more\n'],
    ['a list marker in the caption', '![a](a.png)\n^ cap\n- c\n', '![a](a.png)\n^ cap\n  - c\n'],
    ['two joined lines', '![a](a.png)\n^ cap\none\ntwo\n', '![a](a.png)\n^ cap\n  one\n  two\n'],
    ['a hard break', '![a](a.png)\n^ cap\\\nmore\n', '![a](a.png)\n^ cap\\\n  more\n'],
    ['a caption in an item', '- x\n\n  ![a](a.png)\n  ^ cap\n  more\n', '- x\n\n  ![a](a.png)\n  ^ cap\n    more\n'],
    ['a lazy line in a quote', '> ![a](a.png)\n> ^ cap\nmore\n', '> ![a](a.png)\n> ^ cap\n>   more\n'],
  ])('writes %s at the caption text column', (_name, input, output) => {
    const result = upgrade(input)
    expect(result.output).toBe(output)
    expect(canWriteUpgrade(result)).toBe(true)
    expect(entries(input)).toContain('U-442')
  })

  it('leaves a caption that already continues on indented lines alone', () => {
    const result = upgrade('![a](a.png)\n^ cap\n  more\n')
    expect(result.changed).toBe(false)
    expect(result.check).toBe('pass')
  })

  it('does not take a hard break at the end of the caption for a line', () => {
    const result = upgrade('> ![a](a.png)\n> ^ cap\na\\\n')
    expect(result.output).toBe('> ![a](a.png)\n> ^ cap\n>   a\\\n')
    expect(result.check).toBe('pass')
  })
})

describe('carve#6716: a description mark indented past its term mark (U-180)', () => {
  it('reaches U-180 below a comment line after U-433', () => {
    const result = upgrade(':: t\n %% c\n : d\n')
    expect(result.output).toBe(' :: t\n\n %% c\n : d\n')
    expect(result.check).toBe('pass')
  })

  it('moves the term mark of a term in an item below a comment line', () => {
    const result = upgrade(' - item\n\n  :: c\n    %% note\n    more\n')
    expect(result.output).toBe(' - item\n\n:: c\n\n    %% note\n    more\n')
    expect(result.check).toBe('pass')
  })

  it('moves a description mark to the term column where moving the term mark does not keep the HTML', () => {
    const result = upgrade(':: a\n : b\n>   :: c\n    %% note\n    more\n')
    expect(result.check).toBe('pass')
    expect(entries(':: a\n : b\n>   :: c\n    %% note\n    more\n')).toContain('U-180')
  })
})
