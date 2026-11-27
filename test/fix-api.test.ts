import { describe, expect, it } from 'vitest'
import { fixSource } from '../lint/fix.ts'
import { CarveOptionError, type Diagnostic, fix, fixableRules, fixEdits, lint } from '../public/index.ts'

const allFixable = { rules: Object.fromEntries(fixableRules.map((rule) => [rule, 'on'])) } as Parameters<typeof lint>[1]

function applyEdits(source: string, edits: readonly { startOffset: number, endOffset: number, text: string }[]): string {
  const bytes = new TextEncoder().encode(source)
  let output = ''
  let at = 0
  for (const edit of [...edits].sort((a, b) => a.startOffset - b.startOffset)) {
    output += new TextDecoder().decode(bytes.subarray(at, edit.startOffset)) + edit.text
    at = edit.endOffset
  }
  return output + new TextDecoder().decode(bytes.subarray(at))
}

function refusedOption(run: () => unknown): string {
  try {
    run()
  } catch (error) {
    expect(error).toBeInstanceOf(CarveOptionError)
    return (error as CarveOptionError).option
  }
  throw new Error('the call was not refused')
}

describe('fix', () => {
  it('rewrites as carve lint --fix does', () => {
    const result = fix('**bold** and ~~strike~~\n', { rules: { 'djot-plus-bullet': 'off' } })
    expect(result.output).toBe('*bold* and {~strike~}\n')
    expect([...result.applied]).toEqual([['markdown-strong-double-star', 1], ['markdown-strikethrough-double-tilde', 1]])
  })

  it('fixes two-star pairs next to letters even when the replacement stays text', () => {
    for (const source of ['x**b**y', 'x**b** y', 'x **b**y']) {
      expect(lint(source).some((entry) => entry.code === 'markdown-strong-double-star')).toBe(true)
      expect(fix(source).output).toBe(source.replaceAll('**', '*'))
    }
  })

  it('matches the CLI fix pass on each habit', () => {
    for (const source of ['**a**\n', '~~a~~\n', 'a _b_ c\n', 'snake_case_name\n', 'H~2~O\n', 'x^2^\n', 'a =b= c\n', '+ a\n+ b\n',
      '# Title ##  \n', 'a\n\n---\n', 'Text\n+ x\n']) {
      expect(fix(source)).toEqual(fixSource(source, {}))
    }
  })

  it('keeps a rule off that rules turns off', () => {
    expect(fix('**a**\n', { rules: { 'markdown-strong-double-star': 'off' } })).toEqual({ output: '**a**\n', applied: new Map() })
  })

  it('refuses includes and bad options', () => {
    expect(refusedOption(() => fix('a', { includes: () => null } as never))).toBe('includes')
    expect(refusedOption(() => fix('a', 'x' as never))).toBe('fix')
    expect(refusedOption(() => fix(1 as never))).toBe('source')
    expect(refusedOption(() => fix('a', { rules: { nope: 'on' } } as never))).toBe('rules')
  })

  it('lists the fixable rules', () => {
    expect(fixableRules).toContain('markdown-strong-double-star')
    expect(Object.isFrozen(fixableRules)).toBe(true)
  })
})

describe('fixEdits', () => {
  it('gives the byte ranges and replacements of one finding', () => {
    const source = 'ä **bold**\n'
    const finding = lint(source).find((entry) => entry.code === 'markdown-strong-double-star')!
    const edits = fixEdits(source, finding)
    expect(edits).toEqual([{ startOffset: 3, endOffset: 5, text: '*' }, { startOffset: 9, endOffset: 11, text: '*' }])
    expect(applyEdits(source, edits!)).toBe('ä *bold*\n')
  })

  it('agrees with fix for a document with one finding per rule', () => {
    for (const source of ['**a**\n', '~~a~~\n', 'a _b_ c\n', 'snake_case_name\n', 'x^2^\n', 'a =b= c\n', '+ a\n', '# Title ##  \n', 'a\n\n---\n']) {
      const findings = lint(source, allFixable).filter((entry) => fixEdits(source, entry) !== null)
      expect(findings).toHaveLength(1)
      expect(applyEdits(source, fixEdits(source, findings[0]!)!)).toBe(fix(source, allFixable).output)
    }
  })

  it('returns null where the rule has no fix or the fix would not hold', () => {
    const source = 'Text\n+ x\n'
    const bullet = lint(source, allFixable).find((entry) => entry.code === 'djot-plus-bullet')!
    expect(fixEdits(source, bullet)).toBeNull()
    const other: Diagnostic = { code: 'a11y/image-alt', severity: 'warning', channel: 'lint', message: '', range: { startOffset: 0, endOffset: 2 } }
    expect(fixEdits('![](a.png)', other)).toBeNull()
    const outside: Diagnostic = { ...bullet, code: 'markdown-strong-double-star', range: { startOffset: 0, endOffset: 99 } }
    expect(fixEdits('**a**', outside)).toBeNull()
  })

  it('offers each choice where fix leaves two rules on one range to the author', () => {
    const source = 'a ~x~ b\n'
    const options = { upgrade: true, rules: { 'djot-subscript-tilde': 'on' } } as const
    expect(fix(source, options).output).toBe(source)
    const choices = lint(source, options).map((entry) => fixEdits(source, entry)).filter((edits) => edits !== null)
    expect(choices.map((edits) => applyEdits(source, edits)).sort()).toEqual(['a {,x,} b\n', 'a {~x~} b\n'])
  })

  it('refuses a source or diagnostic of the wrong type', () => {
    expect(refusedOption(() => fixEdits(1 as never, {} as never))).toBe('source')
    expect(refusedOption(() => fixEdits('a', null as never))).toBe('diagnostic')
  })
})
