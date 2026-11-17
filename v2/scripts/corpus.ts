// The conformance corpus of the pinned specification (data/spec-pin.json): spec/0.2/conformance and
// spec/0.2/trees, copied to data/ by pin-spec.ts. Every reader of the examples reads them from here.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { type IncludeAnswer, type IncludeRequest } from '../src/include-settings.ts'
import { type RenderOptions } from '../src/options.ts'

export const DATA = join(import.meta.dirname, '../data')

export type CorpusKind = 'render' | 'write' | 'lint' | 'include' | 'import'
export type CorpusFile = { text: string } | { bytes: string }

export interface CorpusExpected {
  html?: string
  htmlIncludes?: string
  tree?: unknown
  children?: unknown[]
  carve?: string
  diagnostics?: string[]
}

/** One entry of `conformance/examples.json` (conformance/README.md, "Examples"). */
export interface CorpusExample {
  id: string
  document: string
  number: number
  section: string
  clauses: string[]
  kind: CorpusKind
  input?: string
  html?: string
  files?: Record<string, CorpusFile>
  options: Record<string, unknown>
  expected: CorpusExpected
  status: 'verified' | 'unverified'
  reason: string
  note?: string
}

/** One entry of `conformance/clause-cases.json`. */
export interface ClauseCase {
  id: string
  clauses: string[]
  why: string
  summary: string
  input: string
  options: RenderOptions
  expected: { html: string, children: unknown[] }
}

/** One entry of `conformance/refused-trees.json` and of `trees/refused.json`. */
export interface RefusedTree {
  id: string
  clauses: string[]
  reason: string
  refusedBy: 'schema' | 'reader'
  tree: unknown
}

/** One entry of a `trees/examples-*.json` file. */
export interface ExampleTree {
  id: string
  source: string
  options?: { includes?: Record<string, unknown>, headingIds?: string }
  files?: Record<string, string>
  tree: unknown
}

export interface SuppliedTree {
  id: string
  clauses: string[]
  note: string
  tree: unknown
}

export interface LayoutFixture {
  id: string
  clauses: string[]
  input?: string
  /** `true` where the layout schema refuses the record, `reader` where only a reader check does (C2-L-058). */
  refused?: boolean | 'reader'
  layout: unknown
}

function read<T>(path: string, list: string): T[] {
  return (JSON.parse(readFileSync(join(DATA, path), 'utf8')) as Record<string, T[]>)[list]!
}

export const SPEC_PIN = (JSON.parse(readFileSync(join(DATA, 'spec-pin.json'), 'utf8')) as { commit: string }).commit
export const CORPUS_EXAMPLES: readonly CorpusExample[] = read('conformance/examples.json', 'examples')
export const CLAUSE_CASES: readonly ClauseCase[] = read('conformance/clause-cases.json', 'cases')
export const REFUSED_TREES: readonly RefusedTree[] = read('conformance/refused-trees.json', 'trees')
export const TREE_FILES = ['examples-syntax-blocks', 'examples-syntax-inline', 'examples-html', 'examples-writer', 'examples-includes']
export const EXAMPLE_TREES: ReadonlyMap<string, readonly ExampleTree[]> = new Map(
  TREE_FILES.map((file) => [file, read<ExampleTree>(`trees/${file}.json`, 'trees')]),
)
export const SUPPLIED_TREES: readonly SuppliedTree[] = read('trees/nodes.json', 'trees')
export const LAYOUT_FIXTURES: readonly LayoutFixture[] = read('trees/layouts.json', 'layouts')

/** The bytes of a hex string such as `61 FF 62`. */
export function hexBytes(hex: string): Uint8Array {
  return Uint8Array.from(hex.split(' '), (pair) => Number.parseInt(pair, 16))
}

/** The content of a corpus file: its text, or its bytes. */
export function fileContent(file: CorpusFile | string): string | Uint8Array {
  if (typeof file === 'string') return file
  return 'text' in file ? file.text : hexBytes(file.bytes)
}

/** A resolver that serves exactly `files` and returns each name as its id (includes.md, conventions). */
export function corpusResolver(files: Readonly<Record<string, CorpusFile | string>>, calls: IncludeRequest[] = []) {
  return (request: IncludeRequest): IncludeAnswer => {
    calls.push(request)
    const file = Object.hasOwn(files, request.path) ? files[request.path] : undefined
    return file === undefined ? { error: 'not_found' } : { text: fileContent(file), id: request.path }
  }
}

/** The options of an example, with the resolver of an include example built from its files. */
export function corpusOptions(example: CorpusExample): RenderOptions {
  const options = { ...example.options } as RenderOptions & { includes?: unknown }
  if (example.kind !== 'include') return options
  const limits = (example.options['includes'] ?? {}) as Record<string, unknown>
  return { ...options, includes: { resolver: corpusResolver(example.files ?? {}), ...limits } }
}

/** A Carve example of the four chapters that state HTML: the shape the property tests and gates iterate. */
export interface SpecExample {
  file: string
  number: number
  status: 'verified' | 'unverified'
  input: string
  html: string
  options: RenderOptions
}

/** Every render example with a stated HTML, in the order of the corpus. */
export const EXAMPLES: readonly SpecExample[] = CORPUS_EXAMPLES.flatMap((example) =>
  example.kind === 'render' && example.input !== undefined && example.expected.html !== undefined
    ? [{ file: example.document, number: example.number, status: example.status, input: example.input, html: example.expected.html,
      options: example.options as RenderOptions }]
    : [])

/** Every Carve source of the corpus: the inputs of the render, write, lint and include examples and of the clause cases. */
export const CARVE_SOURCES: readonly { id: string, input: string }[] = [
  ...CORPUS_EXAMPLES.flatMap((example) => (example.input === undefined ? [] : [{ id: example.id, input: example.input }])),
  ...CLAUSE_CASES.map((entry) => ({ id: entry.id, input: entry.input })),
]
