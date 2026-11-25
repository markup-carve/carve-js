import { describe, expect, it } from 'vitest'
import { format, lint } from '../src/index.ts'
import { checkWriter } from './support/writer-checks.ts'

function captionReports(source: string): number {
  return lint(source).filter((entry) => entry.code === 'unattached-caption').length
}

describe('carve-js#5201: a caret line that holds only a line comment', () => {
  // C2-W-146: unattached-caption reads the line without its line comment, so it reports none of these lines and
  // the caret stays bare (C2-W-088). Below an image the line would attach, so the caret keeps its backslash.
  const cases: [string, string][] = [
    ['x\n\\^ %%', 'x\n^ %%\n'],
    ['x\n\\^ %% a', 'x\n^ %% a\n'],
    ['x\n\\^ %%\ny', 'x\n^ %%\ny\n'],
    ['> x\n> \\^ %%', '> x\n> ^ %%\n'],
    ['- x\n  \\^ %%', '- x\n  ^ %%\n'],
    ['| a |\n\n\\^ %%', '| a |\n\n^ %%\n'],
    ['![a](u)\n\\^ %%', '![a](u)\n\\^ %%\n'],
  ]
  for (const [input, written] of cases) {
    it(`writes ${JSON.stringify(input)} as ${JSON.stringify(written)}`, () => {
      expect(format(input)).toBe(written)
      expect(checkWriter(input)).toBeNull()
    })
  }

  it('still escapes a caret line with text before its comment, which the rule reports', () => {
    expect(captionReports('x\n^ a %%')).toBe(1)
    expect(format('x\n^ a %%')).toBe('x\n\\^ a %%\n')
    expect(captionReports('x\n^ %%')).toBe(0)
  })
})
