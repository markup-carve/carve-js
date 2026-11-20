import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { fix, lint } from '../public/index.ts'

interface ClauseCase { kind: string, input?: string }
const clauseCases = (JSON.parse(readFileSync(new URL('../data/conformance/clause-cases.json', import.meta.url), 'utf8')) as { cases: ClauseCase[] }).cases

function counts(source: string): Map<string, number> {
  const result = new Map<string, number>()
  for (const finding of lint(source)) result.set(finding.code, (result.get(finding.code) ?? 0) + 1)
  return result
}

function check(source: string): void {
  const before = counts(source)
  const result = fix(source)
  const after = counts(result.output)
  for (const [rule] of result.applied) expect(after.get(rule) ?? 0).toBe(0)
  for (const [rule, count] of after) expect(count).toBeLessThanOrEqual(before.get(rule) ?? 0)
  expect(fix(result.output).output).toBe(result.output)
}

describe('fix output is lint closed', () => {
  it('covers the pinned lint clause cases', () => {
    for (const row of clauseCases) if (row.kind === 'lint' && typeof row.input === 'string') check(row.input)
  })

  it('covers 1,000 nested, shifted, and contained collisions', () => {
    const words = ['x', 'xy', 'a-b', 'two words', 'á', 'x.y', '3', 'x y z', 'a_b', 'z9']
    const forms = ['**_%s_**', '**_/%s/_**', '**_**%s**_**', '*_%s_*', '_**%s**_', '**_%s_** and **y**', 'before **_%s_** after', '[**_%s_**](u)', '**_`%s`_**', '**_@%s_**']
    const containers = ['', '> ', '- ', '1. ', '::: note\n', '## ', ':: term\n: ', 'a\n\n', '> > ', '- a\n  ']
    for (let index = 0; index < 1000; index++) {
      const text = forms[index % forms.length]!.replace('%s', words[Math.floor(index / forms.length) % words.length]!)
      const prefix = containers[Math.floor(index / (forms.length * words.length)) % containers.length]!
      check(`${prefix}${text}\n${prefix === '::: note\n' ? ':::\n' : ''}`)
    }
  })

  it('braces a migrated span where two fixes would make a comment shape', () => {
    expect(fix('**_x_**\n').output).toBe('*{/x/}*\n')
    expect(counts(fix('**_x_**\n').output).get('comment-shaped-emphasis')).toBeUndefined()
  })

  it('continues when one fix exposes another fixable spelling', () => {
    const source = '_**_a_**\n'
    const output = fix(source).output
    expect(output).not.toBe(source)
    expect(counts(output)).toEqual(new Map())
    expect(fix(output).output).toBe(output)
  })
})
