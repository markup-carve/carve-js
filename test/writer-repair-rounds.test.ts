import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { type DocumentNode, formatWithDiagnostics, parse, treesEqual, writeWithDiagnostics } from '../src/index.ts'
import { type Inline } from '../src/ast.ts'
import { writeTreeWithStats } from '../src/write.ts'

const cases = (JSON.parse(readFileSync(new URL('../data/conformance/clause-cases.json', import.meta.url), 'utf8')) as {
  cases: { id: string, input: string, expected: { carve?: string } }[]
}).cases

function caseOf(id: string): { input: string, expected: string } {
  const found = cases.find((entry) => entry.id === id)!
  return { input: found.input, expected: found.expected.carve! }
}

function paragraph(children: Inline[]): DocumentNode {
  return { type: 'document', astVersion: '2.0', children: [{ type: 'paragraph', children }] }
}

it('C2-W-088 repairs every reported construct from one parse of a capped fence group', () => {
  const n = 230
  const openers = Array.from({ length: n }, (_, at) => ':'.repeat(n + 3 - at))
  const input = [...openers, '+', '', ...openers.slice().reverse()].join('\n') + '\n'
  const result = writeTreeWithStats(parse(input), undefined, 'repair', true, undefined, input)
  expect(result.output.diagnostics).toEqual([])
  expect(result.stats.parses).toBeLessThan(200)
  expect(treesEqual(parse(result.output.source), parse(input))).toBe(true)
})

it('C2-W-088 escapes nested block openers reported by the same read-back parse', () => {
  expect(formatWithDiagnostics('[^a]: x\n- > a')).toEqual({ source: '[^a]: x\n  \\- \\> a\n', diagnostics: [] })
  expect(formatWithDiagnostics('[^a]: x\n- ```')).toEqual({ source: '[^a]: x\n  \\- \\```\n', diagnostics: [] })
})

it('C2-W-088 repairs the superscript paragraph in rounds bounded by its nesting depth', () => {
  const { input, expected } = caseOf('CC-1566')
  const result = writeTreeWithStats(parse(input), undefined, 'repair', true, undefined, input)
  expect(result.output.source).toBe(expected)
  expect(result.output.diagnostics).toEqual([])
  expect(result.stats.parses).toBeLessThan(325)
})

it('C2-W-125 keeps bracket pairs on opposite sides of a nested link separate', () => {
  const { input, expected } = caseOf('CC-1567')
  expect(formatWithDiagnostics(input)).toEqual({ source: expected, diagnostics: [] })
})

it('C2-W-117 repairs a text construct behind a text whose leading space is lost', () => {
  const result = writeWithDiagnostics(paragraph([{ type: 'text', value: ' w' }, { type: 'text', value: 'a *b*' }]))
  expect(result.source).toBe(' wa \\*b*\n')
  expect(result.diagnostics.map((entry) => [entry.code, entry.path])).toEqual([
    ['field-unspellable', '/children/0/children/0/value'],
  ])
})

it('C2-W-117 repairs a pair behind a lost leading space', () => {
  const result = writeWithDiagnostics(paragraph([
    { type: 'text', value: ' w' }, { type: 'emphasis', children: [{ type: 'text', value: 'b ' }] },
  ]))
  expect(result.source).toBe(' w{/b /}\n')
  expect(result.diagnostics.map((entry) => [entry.code, entry.path])).toEqual([
    ['field-unspellable', '/children/0/children/0/value'],
  ])
})

it('C2-W-117 reports fields on a later text after an earlier text is lost', () => {
  const result = writeWithDiagnostics(paragraph([
    { type: 'text', value: ' \t' }, { type: 'text', value: ' w', dir: 'rtl' },
  ]))
  expect(result.source).toBe(' \t w\n')
  expect(result.diagnostics.map((entry) => [entry.code, entry.path])).toEqual([
    ['field-unspellable', '/children/0/children/0/value'],
    ['field-unspellable', '/children/0/children/1'],
  ])
})
