// The include vectors of 0.1 ported to 0.2 (test/include-vectors, written by scripts/port-include-vectors.ts): each is run
// with a resolver over its virtual files or over a file tree, and its HTML, fmt, warnings, dependencies and positions are
// compared with the expectation the vector states. A changed vector names the clause its expectation comes from.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, posix } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { format, includeDependencies, parse, parseWithDiagnostics, renderWithDiagnostics } from '../src/index.ts'
import { type DocumentNode, forEachSlot, type Node } from '../src/ast.ts'
import { type IncludeConfig, type IncludeResolver } from '../src/include-settings.ts'
import { fileResolver, idOf } from '../cli/include-fs.ts'

interface Warning { code: string, file?: string }

interface Vector {
  name: string
  verdict: 'unchanged' | 'changed'
  clauses: string[]
  resolver: 'virtual' | 'virtual-ids' | 'throws' | 'filesystem' | 'none'
  entry?: string
  files?: Record<string, string>
  tree?: Record<string, string | { symlink: string }>
  entryPath?: string
  root?: string
  options?: { depth?: number, bytes?: number, file?: string, throws?: string }
  checkFmtExpandEquivalence?: boolean
  forbiddenSubstrings?: string[]
  expected: {
    html: string
    fmt: string
    warnings: Warning[]
    dependencies: { id: string, read: boolean }[]
    positions?: { type: string, pos: Record<string, unknown> }[]
    locations?: { code: string, file?: string, line: number, column: number }[]
  }
}

const directory = join(import.meta.dirname, 'include-vectors')
const VECTORS: Vector[] = readdirSync(join(directory, 'vectors')).sort()
  .map((file) => JSON.parse(readFileSync(join(directory, 'vectors', file), 'utf8')) as Vector)
const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8')) as {
  total: number, unchanged: number, changed: number, reclassified: string[], dropped: { name: string, reason: string }[]
}
const temporary: string[] = []

afterAll(() => { for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true }) })

interface Run {
  entry: string
  config: IncludeConfig | undefined
  /** The `<TMP>` base of a file tree, which every output folds back. */
  base: string | null
  /** The id of the entry, from which a top-level path is placed (C2-N-084). */
  entryId: string | undefined
}

function virtual(vector: Vector): IncludeResolver {
  const files = vector.files ?? {}
  return (request) => {
    const path = vector.resolver === 'virtual-ids' && request.path.startsWith('./') ? request.path.slice(2) : request.path
    const text = Object.hasOwn(files, path) ? files[path] : undefined
    return text === undefined ? { error: 'not_found' } : { text, id: path }
  }
}

function materialized(vector: Vector): Run {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'carve2-vector-')))
  temporary.push(base)
  for (const [name, content] of Object.entries(vector.tree ?? {})) {
    const path = join(base, name)
    mkdirSync(dirname(path), { recursive: true })
    if (typeof content === 'string') writeFileSync(path, content)
    else symlinkSync(join(base, content.symlink), path)
  }
  const root = realpathSync(join(base, vector.root ?? '.'))
  const entryPath = join(base, vector.entryPath ?? 'main.crv')
  const entry = readFileSync(entryPath, 'utf8').replaceAll(/<ABS:([^>]+)>/g, (_match, rel: string) => join(base, rel))
  const entryId = idOf(root, realpathSync(entryPath))
  return { entry, config: { resolver: fileResolver(root), file: entryId }, base, entryId }
}

function prepared(vector: Vector): Run {
  if (vector.resolver === 'filesystem') return materialized(vector)
  const entry = vector.entry ?? ''
  if (vector.resolver === 'none') return { entry, config: undefined, base: null, entryId: undefined }
  const thrown = vector.options?.throws
  const resolver: IncludeResolver = thrown === undefined ? virtual(vector) : () => { throw new Error(thrown) }
  const config: IncludeConfig = { resolver }
  if (vector.options?.depth !== undefined) config.depth = vector.options.depth
  if (vector.options?.bytes !== undefined) config.bytes = vector.options.bytes
  if (vector.options?.file !== undefined) config.file = vector.options.file
  return { entry, config, base: null, entryId: vector.options?.file }
}

function fold(run: Run, text: string): string {
  return run.base === null ? text : text.replaceAll(run.base, '<TMP>')
}

function options(run: Run): { includes?: IncludeConfig } {
  return run.config === undefined ? {} : { includes: run.config }
}

/** C2-N-084: the id a host watches for a node that was not read: the place its path names from its including file. */
function placeOf(vector: Vector, run: Run, path: string, from: string | undefined): string {
  if (vector.resolver !== 'filesystem' || path.startsWith('/')) return fold(run, path)
  const place = posix.normalize(posix.join(posix.dirname(from ?? run.entryId ?? ''), path))
  return place.startsWith('..') ? path : place
}

function dependencies(vector: Vector, run: Run, document: DocumentNode): { id: string, read: boolean }[] {
  const seen = new Set<string>()
  const out: { id: string, read: boolean }[] = []
  for (const dep of includeDependencies(document)) {
    const id = dep.file ?? placeOf(vector, run, dep.path, dep.from)
    const key = `${id}\u0000${dep.read}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ id, read: dep.read })
  }
  return out
}

function sortedWarnings(warnings: readonly Warning[]): Warning[] {
  const key = (warning: Warning): string => `${warning.code}\u0000${warning.file ?? ''}`
  return [...warnings].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0))
}

/** The positioned nodes an included file produced, in tree order, of the types the vector checks. */
function positions(document: DocumentNode, types: ReadonlySet<string>): { type: string, pos: Record<string, unknown> }[] {
  const out: { type: string, pos: Record<string, unknown> }[] = []
  const visit = (node: Node): void => {
    if (node.pos?.file !== undefined && types.has(node.type)) out.push({ type: node.type, pos: { ...node.pos } })
    forEachSlot(node, (nodes) => { for (const child of nodes) visit(child) })
  }
  visit(document)
  return out
}

function lineColumn(text: string, byte: number): { line: number, column: number } {
  const before = new TextDecoder().decode(new TextEncoder().encode(text).subarray(0, byte))
  const lines = before.split('\n')
  return { line: lines.length, column: [...(lines.at(-1) ?? '')].length + 1 }
}

describe('the 0.1 include vectors under 0.2', () => {
  it('_VECTORS.md: 212 vectors, 127 unchanged and 60 changed, of which a clause changes 21 more, and 25 dropped', () => {
    expect([manifest.total, manifest.unchanged + manifest.reclassified.length, manifest.changed - manifest.reclassified.length,
      manifest.dropped.length]).toEqual([212, 127, 60, 25])
    expect([manifest.unchanged, manifest.changed]).toEqual([106, 81])
    expect(VECTORS.length).toBe(187)
  })

  for (const vector of VECTORS) {
    it(`${vector.clauses.join(', ')}: ${vector.name} (${vector.verdict})`, () => {
      const run = prepared(vector)
      const rendered = renderWithDiagnostics(run.entry, options(run))
      expect(fold(run, rendered.html), 'html').toBe(vector.expected.html)
      expect(fold(run, format(run.entry)), 'fmt').toBe(vector.expected.fmt)
      const warnings = rendered.diagnostics.map((entry) => (entry.file === undefined ? { code: entry.code } : { code: entry.code,
        file: entry.file }))
      expect(sortedWarnings(warnings), 'warnings').toEqual(sortedWarnings(vector.expected.warnings))
      for (const forbidden of vector.forbiddenSubstrings ?? []) expect(JSON.stringify(rendered.diagnostics)).not.toContain(forbidden)
      const document = parse(run.entry, options(run))
      expect(dependencies(vector, run, document), 'dependencies').toEqual(vector.expected.dependencies)
      const expectedPositions = vector.expected.positions
      if (expectedPositions !== undefined) {
        expect(positions(document, new Set(expectedPositions.map((entry) => entry.type))), 'positions').toEqual(expectedPositions)
      }
      for (const location of vector.expected.locations ?? []) {
        const found = parseWithDiagnostics(run.entry, options(run)).diagnostics.find((entry) => entry.code === location.code)
        const text = location.file === undefined ? run.entry : vector.files?.[location.file] ?? ''
        expect({ code: found?.code, file: found?.file, ...lineColumn(text, found?.range?.startOffset ?? 0) }).toEqual(location)
      }
      if (vector.checkFmtExpandEquivalence === true) {
        const formatted = format(run.entry)
        expect(renderWithDiagnostics(formatted, options(run)).html).toBe(rendered.html)
        expect(dependencies(vector, run, parse(formatted, options(run)))).toEqual(vector.expected.dependencies)
      }
    })
  }
})
