import { describe, expect, it } from 'vitest'
import { upgrade } from '../src/upgrade.ts'

describe('upgrade keeps opaque payload bytes', () => {
  it.each([
    '```\n_a=b_ /X /y/ z/  \n```\n',
    '```=html\n_a=b_ /X /y/ z/  \n```\n',
    '`_a=b_ /X /y/ z/`{=html}\n',
    '{% _a=b_ /X /y/ z/  %}\n',
  ])('keeps the code, raw, or comment payload of %s', (source) => {
    expect(upgrade(source).output).toBe(source)
  })
})
