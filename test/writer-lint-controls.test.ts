// C2-W-144: the formatter keeps a next-line control comment directly above the line it suppresses (C2-B-216).
import { describe, expect, it } from 'vitest'
import { format, parse, treesEqual, write } from '../src/index.ts'
import { lint } from '../lint/lint.ts'

const CONTROL = '%% carve-lint-disable-next-line'
const FENCE = '```'

/** The findings the control comments of `source` suppress, by rule: a disarmed copy reports them. */
function suppressed(source: string): string {
  const count = (src: string): Map<string, number> => {
    const found = new Map<string, number>()
    for (const entry of lint(src)) {
      if (entry.channel !== 'parse') found.set(entry.code, (found.get(entry.code) ?? 0) + 1)
    }
    return found
  }
  const armed = count(source)
  const all = count(source.replaceAll('carve-lint-', 'carve-lintx-'))
  return [...all].map(([code, n]) => `${code}:${n - (armed.get(code) ?? 0)}`).filter((entry) => !entry.endsWith(':0'))
    .sort().join(',')
}

describe('C2-W-144: a next-line control comment keeps its line', () => {
  it('writes no blank line between the comment and the block it suppresses', () => {
    expect(format(`para\n\n${CONTROL}\n## Heading\n`)).toBe(`para\n\n${CONTROL}\n== Heading\n`)
    expect(format(`x\n\n${CONTROL}\n|a|b|\n`)).toBe(`x\n\n${CONTROL}\n| a | b |\n`)
    expect(format(`x\n\n${CONTROL}\n${FENCE}\ncode\n${FENCE}\n`)).toBe(`x\n\n${CONTROL}\n${FENCE}\ncode\n${FENCE}\n`)
    expect(format(`> x\n>\n> ${CONTROL}\n> > q\n`)).toBe(`> x\n>\n> ${CONTROL}\n> > q\n`)
  })

  it('keeps the blank line below a comment that suppresses nothing in the source', () => {
    expect(format(`x\n\n${CONTROL}\n\n## See [a]()\n`)).toBe(`x\n\n${CONTROL}\n\n== See [a]()\n`)
    expect(format(`- a\n\n${CONTROL}\n\n- b\n`)).toBe(`- a\n\n  ${CONTROL}\n\n- b\n`)
    // C2-W-114 writes no blank line between two descriptions; this one stays, or the comment would suppress `: [a]()`.
    expect(format(`:: t\n: d\n\n${CONTROL}\n\n: [a]()\n`)).toBe(`:: t\n: d\n\n  ${CONTROL}\n\n: [a]()\n`)
  })

  it('writes a supplied tree with the comment directly above the next block', () => {
    const tree = parse(`x\n\n${CONTROL}\n\n## See [a]()\n`)
    expect(write(tree)).toBe(`x\n\n${CONTROL}\n== See [a]()\n`)
  })

  it('writes the comment that ends an item directly above the next item', () => {
    expect(format(`- a\n\n${CONTROL}\n- b\n`)).toBe(`- a\n\n  ${CONTROL}\n- b\n`)
  })

  it('keeps the blank line where leaving it out would change the tree', () => {
    expect(format(`a ${CONTROL}\n\nb\n`)).toBe(`a ${CONTROL}\n\nb\n`)
    expect(format(`${FENCE}\n${CONTROL}\n\nx\n${FENCE}\n`)).toBe(`${FENCE}\n${CONTROL}\n\nx\n${FENCE}\n`)
  })

  it('fmt then lint suppresses what lint suppresses, for generated documents', () => {
    const finding = '[a]()'
    const targets = [`para ${finding}`, `== H ${finding}`, `| ${finding} | b |`, `- ${finding}`, `> ${finding}`,
      `: ${finding}`, `::: note\n${finding}\n:::`, `1. ${finding}`, `{.c}\npara ${finding}`]
    const befores = ['', 'x\n\n', '== T\n\n', '- a\n\n', '| a | b |\n\n', `${FENCE}\nc\n${FENCE}\n\n`, '> q\n\n', '%% other\n']
    const wraps = [
      (s: string) => s,
      (s: string) => s.split('\n').map((line) => line === '' ? '>' : `> ${line}`).join('\n'),
      (s: string) => s.split('\n').map((line, index) => line === '' ? '' : (index === 0 ? '- ' : '  ') + line).join('\n'),
      (s: string) => `:::: w\n${s}\n::::`,
    ]
    let checked = 0
    for (const wrap of wraps) for (const before of befores) for (const target of targets) for (const blank of ['', '\n']) {
      const source = `${wrap(`${before}${CONTROL}\n${blank}${target}`)}\n`
      const expected = suppressed(source)
      const formatted = format(source)
      expect(suppressed(formatted), JSON.stringify(source)).toBe(expected)
      expect(treesEqual(parse(formatted), parse(source))).toBe(true)
      expect(format(formatted)).toBe(formatted)
      checked++
    }
    expect(checked).toBeGreaterThan(500)
  })
})
