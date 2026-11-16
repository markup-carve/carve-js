// C2-H-112 to C2-H-120: parse, render with `roundtrip`, import the HTML, and compare the trees (C2-A-161, C2-A-162).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse, render, treesEqual, type DocumentNode } from '../../v2/src/index.ts'
import { generate, loadCorpus, random } from '../../v2/proptest/generate.ts'
import { importDocument } from '../src/index.ts'
import { project } from './roundtrip-losses.ts'

type Value = unknown
type Fields = Record<string, unknown>

interface ResultEntry { field: string, when?: string }
const root = join(import.meta.dirname, '../..')
const results = (JSON.parse(readFileSync(join(root, 'v2/data/ast-results.json'), 'utf8')) as
  { nodes: Record<string, ResultEntry[]> }).nodes
const GEOMETRY = ['pos', 'segments', 'srcByteLength']

/** `raw`: the trees are equal as they stand; `equal`: equal once the losses of `losses` are applied to the parsed tree. */
export interface Outcome { raw: boolean, equal: boolean, classes: string[], losses: string[], html: string, error?: string }
export interface ClassTally { documents: number, example: string }
export interface Report {
  documents: number, raw: number, equal: number, errors: number, classes: Map<string, ClassTally>, losses: Map<string, ClassTally>
}

function isFields(value: Value): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function typeOf(value: Value): string {
  return isFields(value) && typeof value['type'] === 'string' ? value['type'] : typeof value
}

/** C2-A-162: the fields equality skips on `node`. */
function skipped(node: Fields, name: string, spanMarks: boolean): boolean {
  if (GEOMETRY.includes(name)) return true
  const entry = results[typeOf(node)]?.find(item => item.field === name)
  if (entry === undefined) return false
  if (entry.when === 'reference use') return node['key'] !== undefined
  if (entry.when === 'derived from authored span mark') return spanMarks
  return true
}

/** C2-A-040: adjacent text nodes compare as one. */
function coalesced(list: Value[]): Value[] {
  const out: Value[] = []
  for (const item of list) {
    const last = out.at(-1)
    if (isFields(item) && isFields(last) && item['type'] === 'text' && last['type'] === 'text') {
      out[out.length - 1] = { ...last, value: `${String(last['value'])}${String(item['value'])}` }
    } else out.push(item)
  }
  return out
}

function hasSpanMarks(table: Fields): boolean {
  const lists = (node: Value, name: string): Value[] => {
    const list = isFields(node) ? node[name] : undefined
    return Array.isArray(list) ? list : []
  }
  return lists(table, 'children').some(group => lists(group, 'children').some(row => lists(row, 'children')
    .some(cell => isFields(cell) && cell['span'] !== undefined)))
}

/** The longest common subsequence of two type lists, as index pairs. */
function alignment(left: string[], right: string[]): [number, number][] {
  const width = right.length + 1
  const table = new Uint32Array((left.length + 1) * width)
  for (let i = left.length - 1; i >= 0; i--) {
    for (let j = right.length - 1; j >= 0; j--) {
      table[i * width + j] = left[i] === right[j] ? (table[(i + 1) * width + j + 1] ?? 0) + 1
        : Math.max(table[(i + 1) * width + j] ?? 0, table[i * width + j + 1] ?? 0)
    }
  }
  const pairs: [number, number][] = []
  let i = 0
  let j = 0
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) { pairs.push([i, j]); i++; j++ }
    else if ((table[(i + 1) * width + j] ?? 0) >= (table[i * width + j + 1] ?? 0)) i++
    else j++
  }
  return pairs
}

function diffLists(owner: string, a: Value[], b: Value[], spanMarks: boolean, out: Set<string>): void {
  const left = coalesced(a)
  const right = coalesced(b)
  const pairs = alignment(left.map(typeOf), right.map(typeOf))
  const usedLeft = new Set(pairs.map(([i]) => i))
  const usedRight = new Set(pairs.map(([, j]) => j))
  left.forEach((item, at) => { if (!usedLeft.has(at)) out.add(`${owner}: lost ${typeOf(item)}`) })
  right.forEach((item, at) => { if (!usedRight.has(at)) out.add(`${owner}: added ${typeOf(item)}`) })
  for (const [i, j] of pairs) diffValues(owner, left[i], right[j], spanMarks, out)
}

function diffObjects(owner: string, a: Fields, b: Fields, spanMarks: boolean, out: Set<string>): void {
  const type = typeof a['type'] === 'string' ? a['type'] : owner
  const inner = type === 'table' ? hasSpanMarks(a) || hasSpanMarks(b) : spanMarks
  const names = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const name of [...names].sort()) {
    const left = a[name]
    const right = b[name]
    if (skipped(a, name, inner) || (left === undefined && right === undefined)) continue
    if (left === undefined) out.add(`${type}.${name}: added`)
    else if (right === undefined) out.add(`${type}.${name}: lost`)
    else if (Array.isArray(left) || isFields(left)) diffValues(`${type}.${name}`, left, right, inner, out)
    else if (left !== right) out.add(`${type}.${name}`)
  }
}

function diffValues(owner: string, a: Value, b: Value, spanMarks: boolean, out: Set<string>): void {
  if (Array.isArray(a)) {
    if (Array.isArray(b)) diffLists(owner, a, b, spanMarks, out)
    else out.add(`${owner}: shape`)
  } else if (isFields(a) && isFields(b)) {
    if (a['type'] !== b['type']) out.add(`${owner}: ${typeOf(a)} became ${typeOf(b)}`)
    else diffObjects(owner, a, b, spanMarks, out)
  } else if (a !== b) out.add(`${owner}: value`)
}

/** The difference classes between a parsed tree and an imported one, as `node.field: what` lines. */
export function diffTrees(expected: DocumentNode, actual: DocumentNode): string[] {
  const out = new Set<string>()
  diffValues('document', expected, actual, false, out)
  return [...out].sort()
}

/** The imported tree without the provenance the importer adds to every document. */
function withoutProvenance(document: DocumentNode): DocumentNode {
  const copy: DocumentNode = { ...document }
  const data = { ...copy.data }
  delete data['carve.source']
  delete data['carve.style']
  if (Object.keys(data).length === 0) delete copy.data
  else copy.data = data
  const extensions = (copy.extensions ?? []).filter(entry => entry.name !== 'carve.source' && entry.name !== 'carve.style')
  if (extensions.length === 0) delete copy.extensions
  else copy.extensions = extensions
  return copy
}

/** One round trip of `source`. */
export function roundTrip(source: string): Outcome {
  const expected = parse(source)
  const html = render(source, { roundtrip: true })
  const projected = project(expected)
  try {
    const actual = withoutProvenance(importDocument(html, { from: 'html' }).document)
    const raw = treesEqual(expected, actual)
    const equal = raw || treesEqual(projected.tree, actual)
    return { raw, equal, classes: equal ? [] : diffTrees(projected.tree, actual), losses: raw ? [] : projected.losses, html }
  } catch (error) {
    return { raw: false, equal: false, classes: ['import: exception'], losses: [], html, error: String(error) }
  }
}

function count(map: Map<string, ClassTally>, names: readonly string[], source: string): void {
  for (const name of names) {
    const entry = map.get(name)
    if (entry === undefined) map.set(name, { documents: 1, example: source })
    else {
      entry.documents++
      if (source.length < entry.example.length) entry.example = source
    }
  }
}

export function tally(report: Report, source: string, outcome: Outcome): void {
  report.documents++
  if (outcome.raw) report.raw++
  if (outcome.equal) report.equal++
  if (outcome.error !== undefined) report.errors++
  count(report.classes, outcome.classes, source)
  count(report.losses, outcome.losses, source)
}

export function emptyReport(): Report {
  return { documents: 0, raw: 0, equal: 0, errors: 0, classes: new Map(), losses: new Map() }
}

export interface Examples { input: string, flags: string[] }

/** The specification examples, and `count` generated documents of at most `maxBytes` bytes from `seed`. */
export function harnessInputs(count: number, seed: number, maxBytes: number): { examples: string[], generated: string[] } {
  const examples = (JSON.parse(readFileSync(join(root, 'v2/data/examples.json'), 'utf8')) as Examples[]).map(entry => entry.input)
  const previous = process.cwd()
  process.chdir(root)
  try {
    const corpus = loadCorpus()
    const rng = random(seed)
    const generated = Array.from({ length: count }, () => generate(rng, corpus, maxBytes))
    return { examples, generated }
  } finally {
    process.chdir(previous)
  }
}

export function measure(inputs: readonly string[]): Report {
  const report = emptyReport()
  for (const source of inputs) {
    let outcome: Outcome
    try { outcome = roundTrip(source) }
    catch (error) {
      outcome = { raw: false, equal: false, classes: ['parse or render: exception'], losses: [], html: '', error: String(error) }
    }
    tally(report, source, outcome)
  }
  return report
}

function cell(text: string): string {
  return text.replaceAll('\\', '\\\\').replaceAll('|', '\\|').replaceAll('\n', '\\n').replaceAll('`', 'ˋ')
}

function rows(map: Map<string, ClassTally>, exampleLength: number): string[] {
  const entries = [...map].sort((a, b) => b[1].documents - a[1].documents || a[0].localeCompare(b[0]))
  return entries.map(([name, entry]) => {
    const example = entry.example.length > exampleLength ? `${entry.example.slice(0, exampleLength)}…` : entry.example
    return `| ${cell(name)} | ${entry.documents} | ` + '`' + cell(example) + '` |'
  })
}

/** The report as Markdown: the losses the specification names, then the differences that remain, the most frequent first. */
export function reportTable(title: string, report: Report, exampleLength = 80): string[] {
  return [`## ${title}`, '', `Documents: ${report.documents}; equal as they stand: ${report.raw}; ` +
    `equal after the specified losses: ${report.equal}; import exceptions: ${report.errors}.`, '',
    'Specified losses (documents whose parsed tree the clause changed):', '',
    '| Clause | Documents | Shortest input |', '| --- | ---: | --- |', ...rows(report.losses, exampleLength), '',
    'Differences that remain after the losses:', '',
    '| Difference | Documents | Shortest input |', '| --- | ---: | --- |', ...rows(report.classes, exampleLength), '']
}
