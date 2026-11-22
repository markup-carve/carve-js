import { describe, expect, it } from 'vitest'
import { lint } from '../src/index.ts'
import { caseFold, foldKey } from '../src/case-fold.ts'
import { generateDataTables } from '../lint/generate-data-tables.ts'
import { expectBuiltInputScansLinearly, perfIt } from './helpers/scaling.ts'

const found = (source: string, code: string) => lint(source, {}).filter((entry) => entry.code === code)
const messages = (source: string, code: string) => found(source, code).map((entry) => entry.message)

describe('C2-W-150 value operators', () => {
  it('fold is full Unicode case folding between two NFC passes', () => {
    expect(caseFold('Straße')).toBe('strasse')
    expect(caseFold('ẞ')).toBe('ss')
    expect(caseFold('ΣΑΣ ς')).toBe('σασ σ')
    expect(caseFold('ﬁ')).toBe('fi')
    expect(caseFold('ꭰ')).toBe('Ꭰ')
    expect(caseFold('İ')).toBe('i̇')
    expect(foldKey('Å')).toBe('å')
    expect(foldKey('Å')).toBe(foldKey('å'))
  })

  it('compiles nfc, fold, fold_space and both list forms', () => {
    const rule = (value: unknown) => JSON.stringify({ text_leaves: [], verbatim_leaves: [], row_leaves: [], rules: [{
      id: 'r', over: 'line', report: [{ start: 0, end: 0, values: { v: value } }] }] })
    const code = (value: unknown) => generateDataTables(rule(value))
    expect(code({ nfc: { f: 'text' } })).toContain(".normalize('NFC')")
    expect(code({ fold: { f: 'text' } })).toContain('foldKey(')
    expect(code({ fold_space: { f: 'text' } })).toContain('foldLabel(')
    expect(code({ quoted_list: { f: 'text' } })).toContain('listOf(self.text, \'"\')')
    expect(code({ plain_list: { f: 'text' } })).toContain('listOf(self.text, \'\')')
  })

  it('plain_list joins one, two and three candidates', () => {
    const phrase = (labels: string[]) => messages(`[x][STRASSE]\n\n${labels.map((label, at) => `[${label}]: /${at}\n`).join('')}`,
      'unresolved-reference-link')[0]
    expect(phrase(['Straße'])).toContain('the label Straße differs only in case')
    expect(phrase(['Straße', 'strasse'])).toContain('the labels Straße and strasse differ only in case')
    expect(phrase(['Straße', 'strasse', 'STRAßE'])).toContain('the labels Straße, strasse, and STRAßE differ only in case')
  })
})

describe('C2-W-150 id records', () => {
  it('xref: numbered caption owners and panels qualify, unnumbered ones and divs do not', () => {
    expect(messages('{#tab}\n| a |\n^ #: Cap\n\nSee </#TAB>.\n', 'broken-crossref')[0]).toContain('the id tab differs only in case')
    expect(messages('{#tab}\n| a |\n^ Cap\n\nSee </#TAB>.\n', 'broken-crossref')[0]).toContain('has no matching heading id')
    expect(messages('{#d}\n::: x\ny\n:::\n\nSee </#D>.\n', 'broken-crossref')[0]).toContain('has no matching heading id')
  })

  it('rendered: note marks and notes are fragment targets, a metadata block id is not', () => {
    expect(found('T[^n] T[^n].\n\n[^n]: note\n\n[a](#fn1) [b](#fnref1) [c](#fnref1-2)\n', 'broken-fragment-link')).toEqual([])
    expect(messages('T[^n].\n\n[^n]: note\n\n[a](#FN1)\n', 'broken-fragment-link')[0]).toContain('the id "fn1" differs only in case')
    expect(found('Text.\n\n{#meta}\n--- yaml\na: 1\n---\n\n[z](#meta)\n', 'broken-fragment-link')).toHaveLength(1)
  })

  it('heading_text, not the heading id, gives the reference near miss', () => {
    expect(messages('{#foo}\n# Heading\n\n[x][HEADING]\n', 'unresolved-reference-link')[0]).toContain('the label Heading differs only in case')
    expect(messages('{#foo}\n# Heading\n\n[y][FOO]\n', 'unresolved-reference-link')[0]).toContain('has no matching link definition')
    expect(messages('# A \t B\n\n[x][a b]\n', 'unresolved-reference-link')[0]).toContain('differs only in case')
  })

  it('a key that differs from an id only by normalization is no case candidate, for every link of the document', () => {
    const nfd = 'é'
    const source = `{id="é"}\n# H\n\n[a](#É) [b](#${nfd})\n`
    const messagesOf = found(source, 'broken-fragment-link').map((entry) => entry.message)
    expect(messagesOf).toHaveLength(2)
    expect(messagesOf[0]).toContain('differs only in case')
    expect(messagesOf[1]).toContain('matches no id in this document')
  })
})

describe('lint over the id records stays linear', () => {
  perfIt('scales linearly on headings, notes and fragment links', () => {
    expectBuiltInputScansLinearly((source) => { lint(source, {}) }, (count) => Array.from({ length: count }, (_, at) =>
      `# Head ${at}\n\nT[^n${at}] [a](#HEAD-${at}) [b](#fn${at + 1}) [c](#x${at}) </#HEAD-${at}> [d][HEAD ${at}]\n\n[^n${at}]: n\n\n`).join(''),
    { label: 'id records', smallRepeats: 100 })
  })
})
