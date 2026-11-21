import { describe, expect, it } from 'vitest'
import { upgrade } from '../src/upgrade.ts'

const cases: [string, string, string][] = [
  ['U-276 tab', '::: note "Title"\t[First]\nx\n:::\n', '::: note\nx\n:::\n'],
  ['U-276 space tab', '::: note "Title" \t[First]\nx\n:::\n', '::: note\nx\n:::\n'],
  ['U-277 tab', '```js "T"\t[L]\nx\n```\n', '```js\nx\n```\n'],
  ['U-277 space tab', '```js "T" \t[L]\nx\n```\n', '```js\nx\n```\n'],
]

describe('0.1 fence title parsing decides metadata rewrites', () => {
  for (const [name, source, expected] of cases) {
    it(name, () => {
      const result = upgrade(source)
      expect(result.output).toBe(expected)
      expect(result.check).toBe('pass')
    })
  }

  it('keeps a recognized title and its label', () => {
    const source = '::: note "Title" [First]\nx\n:::\n'
    expect(upgrade(source).output).toBe(source)
  })

  it('leaves title shaped text inside a code body byte identical', () => {
    const source = '```\n::: note "Title"\t[First]\n```\n'
    expect(upgrade(source).output).toBe(source)
  })
})
