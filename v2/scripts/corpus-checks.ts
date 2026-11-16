// Runs each entry of the conformance corpus through this engine and names every field whose result
// differs from the corpus (conformance/README.md, "Reading it"). HTML and written source compare byte for
// byte; a tree compares with its positions, as this engine claims C2-A-165.
import { treesEqual } from '../src/ast-json.ts'
import { CarveTreeError } from '../src/ast-validate.ts'
import { type Diagnostic } from '../src/diagnostics.ts'
import {
  decodeTree, encodeTree, format, lint, parse, type ParseOptions, parseTree, renderWithDiagnostics, resolveTree, type RenderOptions,
  validateLayout,
} from '../src/index.ts'
import {
  type ClauseCase, type CorpusExample, corpusOptions, corpusResolver, type ExampleTree, type LayoutFixture, type RefusedTree,
} from './corpus.ts'

export interface Mismatch {
  field: string
  actual: unknown
  expected: unknown
}

/** Plain JSON with the keys of every object in order, so that two values compare by content. */
export function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value === null || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  return Object.fromEntries(Object.keys(record).sort().map((key) => [key, canonical(record[key])]))
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b))
}

/** The tree as plain JSON without `pos`. */
export function withoutPositions(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (key, field: unknown) => (key === 'pos' ? undefined : field))) as unknown
}

function outcome<T>(run: () => T): T | string {
  try {
    return run()
  } catch (error) {
    return `threw ${String(error)}`
  }
}

function parseOptions(options: RenderOptions): ParseOptions {
  const out: ParseOptions = {}
  if (options.includes !== undefined) out.includes = options.includes
  if (options.headingIds !== undefined) out.headingIds = options.headingIds
  if (options.extensions !== undefined) out.extensions = options.extensions
  return out
}

function treeOf(source: string, options: ParseOptions): unknown {
  return outcome(() => JSON.parse(encodeTree(parse(source, options))) as unknown)
}

function codes(diagnostics: readonly Diagnostic[]): string[] {
  return diagnostics.map((entry) => entry.code)
}

function renderMismatches(example: CorpusExample, input: string, options: RenderOptions, out: Mismatch[]): void {
  const expected = example.expected
  const rendered = outcome(() => renderWithDiagnostics(input, options))
  const html = typeof rendered === 'string' ? rendered : rendered.html
  if (expected.html !== undefined && html !== expected.html) out.push({ field: 'html', actual: html, expected: expected.html })
  if (expected.htmlIncludes !== undefined && !html.includes(expected.htmlIncludes)) {
    out.push({ field: 'htmlIncludes', actual: html, expected: expected.htmlIncludes })
  }
  if (expected.diagnostics === undefined || example.kind === 'lint') return
  // The codes the text says are reported: those of the render and those of lint.
  const reported = [
    ...(typeof rendered === 'string' ? [] : codes(rendered.diagnostics)),
    ...codes(lint(input, options.includes === undefined ? {} : { includes: options.includes })),
  ]
  const missing = expected.diagnostics.filter((code) => !reported.includes(code))
  if (missing.length > 0) out.push({ field: 'diagnostics', actual: reported, expected: expected.diagnostics })
}

function writeMismatches(example: CorpusExample, input: string, out: Mismatch[]): void {
  const carve = example.expected.carve
  if (carve === undefined) return
  const written = outcome(() => format(input, example.options))
  if (written !== `${carve}\n`) out.push({ field: 'carve', actual: written, expected: carve })
  // C2-W-002: the written source reads back as the tree of the input.
  if (!treesEqual(parse(`${carve}\n`), parse(input))) out.push({ field: 'carve reads back', actual: carve, expected: input })
}

/** The fields of a Carve example (render, write, lint, include) that this engine does not reproduce. */
export function exampleMismatches(example: CorpusExample): Mismatch[] {
  const input = example.input
  if (input === undefined) throw new Error(`${example.id}: a ${example.kind} example without Carve input`)
  const out: Mismatch[] = []
  const options = corpusOptions(example)
  const expected = example.expected
  if (expected.html !== undefined || expected.htmlIncludes !== undefined || expected.diagnostics !== undefined) {
    renderMismatches(example, input, options, out)
  }
  if (expected.tree !== undefined) {
    const tree = treeOf(input, parseOptions(options))
    if (!same(tree, expected.tree)) out.push({ field: 'tree', actual: tree, expected: expected.tree })
  }
  if (example.kind === 'write') writeMismatches(example, input, out)
  if (example.kind === 'lint') {
    const reported = codes(lint(input)).sort()
    const stated = [...expected.diagnostics ?? []].sort()
    if (!same(reported, stated)) out.push({ field: 'lint', actual: reported, expected: stated })
  }
  return out
}

/** The HTML and the children, without positions, of the resolved tree of a clause case. */
export function clauseCaseMismatches(entry: ClauseCase): Mismatch[] {
  const out: Mismatch[] = []
  const html = outcome(() => renderWithDiagnostics(entry.input, entry.options).html)
  if (html !== entry.expected.html) out.push({ field: 'html', actual: html, expected: entry.expected.html })
  const document = outcome(() => resolveTree(parseTree(entry.input), entry.options).document)
  const children = typeof document === 'string'
    ? document
    : (withoutPositions(JSON.parse(encodeTree(document))) as { children: unknown }).children
  if (!same(children, entry.expected.children)) out.push({ field: 'children', actual: children, expected: entry.expected.children })
  return out
}

/** The pointer of the error the reader refuses a tree with, or null when it accepts the tree. */
export function refusalPath(entry: RefusedTree): string | null {
  try {
    decodeTree(JSON.stringify(entry.tree))
    return null
  } catch (error) {
    if (error instanceof CarveTreeError) return error.path
    throw error
  }
}

/** A positive fixture tree: the engine's own tree of its source, and the reader accepts it with its source. */
export function exampleTreeMismatches(entry: ExampleTree): Mismatch[] {
  const options: ParseOptions = {}
  if (entry.options?.headingIds === 'lower') options.headingIds = 'lower'
  if (entry.files !== undefined) options.includes = { resolver: corpusResolver(entry.files), ...entry.options?.includes }
  const out: Mismatch[] = []
  const tree = treeOf(entry.source, options)
  if (!same(tree, entry.tree)) out.push({ field: 'tree', actual: tree, expected: entry.tree })
  const read = outcome(() => decodeTree(JSON.stringify(entry.tree), entry.source))
  if (typeof read === 'string') out.push({ field: 'reader', actual: read, expected: 'accepted' })
  return out
}

/** Whether `validateLayout` accepts the sidecar of a layout fixture. */
export function layoutAccepted(entry: LayoutFixture): boolean {
  return typeof outcome(() => validateLayout(entry.layout)) !== 'string'
}
