import { afterEach, expect, it } from 'vitest'
import { lint } from '../lint/lint.ts'

function found(source: string, mode: 'data' | 'code', rule: string): string[] {
  process.env.CARVE_LINT_RULES = mode
  return lint(source, { rules: { [rule]: 'on' } }).filter((item) => item.code === rule && item.range !== undefined)
    .map((item) => `${item.range!.startOffset}-${item.range!.endOffset}`)
}

afterEach(() => { delete process.env.CARVE_LINT_RULES })

it('C2-W-147: odd backslash runs escape pair openers in both lint modes', () => {
  for (const [mark, rule] of [
    ['**', 'markdown-strong-double-star'], ['~~', 'markdown-strikethrough-double-tilde'],
    ['_', 'djot-emphasis-underscore'], ['~', 'djot-subscript-tilde'], ['^', 'djot-superscript-caret'],
  ] as const) {
    for (const count of [1, 3, 5]) {
      const source = `a ${'\\'.repeat(count)}${mark}b${mark} c\n`
      expect(found(source, 'data', rule), source).toEqual([])
      expect(found(source, 'code', rule), source).toEqual([])
    }
    const source = `a \\\\${mark}b${mark} c\n`
    expect(found(source, 'data', rule), source).toEqual(found(source, 'code', rule))
  }
})

it('C2-B-137: attributed block opener skips intervening comment-only lines', () => {
  const rule = 'block-opener-overindented'
  for (const comments of ['  %% x\n', '  %% x\n %% y\n']) {
    const source = `{.a}\n${comments}# h\n`
    expect(found(source, 'data', rule), source).toEqual([])
    expect(found(source, 'code', rule), source).toEqual([])
    const indented = `{.a}\n${comments}  # h\n`
    expect(found(indented, 'data', rule), indented).toEqual(found(indented, 'code', rule))
  }
})
