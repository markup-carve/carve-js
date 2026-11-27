// carve#6905 (carve-js): lint keeps a parse entry found across included files, and reports
// comment-in-reference-label only inside a reference label.
import { describe, expect, it } from 'vitest'
import { lint, parseWithDiagnostics } from '../src/index.ts'
import { includes } from './support/includes.ts'

const codes = (source: string) => lint(source).map((entry) => [entry.code, entry.range])

describe('includes-22: a duplicate id in an included file (C2-N-058, C2-T-031)', () => {
  const files = { 'child.crv': '{#tip}\n= Child tip\n\nBack to </#tip>.\n' }
  const source = '{#tip}\n= Parent tip\n\n{{ child.crv }}'

  it('lint reports the parse entry at the later id, in the file that holds it', () => {
    const found = lint(source, { includes: includes(files) })
    expect(found.map((entry) => [entry.code, entry.channel, entry.file, entry.range])).toEqual([
      ['duplicate-id', 'parse', 'child.crv', { startOffset: 1, endOffset: 5 }],
    ])
  })

  it('the parse entry points at the id in the included file, as one in the top file does', () => {
    const found = parseWithDiagnostics(source, { includes: includes(files) }).diagnostics
    expect(found.map((entry) => [entry.code, entry.file, entry.range])).toEqual([
      ['duplicate-id', 'child.crv', { startOffset: 1, endOffset: 5 }],
    ])
  })

  it('a duplicate footnote definition in an included file points at its marker', () => {
    const found = parseWithDiagnostics('{{ c.crv }}\n', { includes: includes({ 'c.crv': 'x\n\n[^n]: b\n\n[^n]: c\n' }) })
      .diagnostics.filter((entry) => entry.code === 'duplicate-footnote-definition')
    expect(found.map((entry) => [entry.file, entry.range])).toEqual([['c.crv', { startOffset: 12, endOffset: 17 }]])
  })

  it('a parse entry outside the lines an include selects is not reported (C2-N-086)', () => {
    const child = { 'c.crv': 'x\n\n[^n]: b\n\n[^n]: c\n' }
    const found = lint('{{ c.crv @lines:1-1 }}\n', { includes: includes(child) })
    expect(found.filter((entry) => entry.code === 'duplicate-footnote-definition')).toEqual([])
    const whole = lint('{{ c.crv }}\n', { includes: includes(child) })
    expect(whole.filter((entry) => entry.code === 'duplicate-footnote-definition').map((entry) => entry.range))
      .toEqual([{ startOffset: 12, endOffset: 17 }])
  })
})

describe('comment-in-reference-label covers reference labels only (C2-I-076, C2-I-077)', () => {
  it('syntax-inline-18: link text is no label', () => {
    expect(codes('[a %% b](/u) c')).toEqual([])
  })

  it('syntax-inline-128: an inline footnote is no label', () => {
    expect(codes('a ^[see b %% check *this*] c')).toEqual([])
  })

  it('a span or a shortcut is no label', () => {
    expect(codes('[a %% b]{.c}')).toEqual([])
    expect(codes('[a %% b]\n\n[a]: /u\n').filter(([code]) => code === 'comment-in-reference-label')).toEqual([])
  })

  it('a bracket pair after a space or a tab is no label (C2-I-072: the label is glued)', () => {
    expect(codes('[x] [a %% b]')).toEqual([])
    expect(codes('[x] [a %% b]\n\n[x]: /u\n')).toEqual([])
    expect(codes('[x]\t[a %% b]\n\n[x]: /u\n')).toEqual([])
  })

  it('the label of a full reference and of a footnote reference still reports', () => {
    expect(codes('[x][a %% b]\n\n[x]: /u\n')).toEqual([['comment-in-reference-label', { startOffset: 5, endOffset: 11 }]])
    expect(codes('[^a %% b]\n').map(([code]) => code)).toContain('comment-in-reference-label')
  })
})
