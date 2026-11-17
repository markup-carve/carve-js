// Upgrade rows changed at freeze candidate 5: U-162 rewritten, U-269 and U-270 added, U-185 withdrawn.
import { expect, it } from 'vitest'
import { upgrade } from '../src/index.ts'

function entries(source: string): string[] {
  return upgrade(source).records.map((record) => record.entry)
}

it('C2-B-182, U-162: a glued vertical mark moves into a brace block after `?`', () => {
  const result = upgrade('|?v |\n')
  expect(result.output).toBe('|{?v} |\n')
  expect(result.check).toBe('pass')
  expect(entries('|?v |\n')).toContain('U-162')
  expect(upgrade(result.output).output).toBe(result.output)
})

it('C2-B-174, U-269: marks of a spanning head cell move to the cell the span covers', () => {
  const source = '|= A |={>^} < |\n| a | b |\n'
  const result = upgrade(source)
  expect(result.output).toBe('|= A |= < |\n| a |{>^} b |\n')
  expect(entries(source)).toContain('U-269')
  expect(upgrade(result.output).output).toBe(result.output)
})

it('C2-B-171, X-003: a bare header mark that 0.1 read as text is escaped, since U-185 is withdrawn', () => {
  const result = upgrade('|=|\n')
  expect(result.output).toBe('|\\=|\n')
  expect(result.check).toBe('pass')
  expect(entries('|=|\n')).toEqual(['X-003'])
})

it('U-270: a header mark glued to text applies to candidate 5 sources only, so 0.1 input is left alone', () => {
  expect(upgrade('|=a|\n| x |\n').records).toEqual([])
})
