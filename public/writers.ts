// One interface for every output of a resolved 0.2 tree. HTML and Carve are built in. The Markdown, plain-text and
// ANSI exports live in `@markup-carve/carve/export`, which registers them under their reserved targets.
import { CarveRenderError, renderWithDiagnostics } from '../src/api.ts'
import { type DocumentNode } from '../src/ast.ts'
import { type Diagnostic } from '../src/diagnostics.ts'
import { CarveOptionError, type RenderOptions } from '../src/options.ts'
import { CarveWriteError, writerHasLoss, writeWithDiagnostics } from '../src/write.ts'
import { checkOptions } from './check.ts'

/** The options every writer reads; a writer also reads its own, and refuses a name it does not know. */
export interface WriterOptions {
  /** Throws instead of returning a result that lost something: `CarveRenderError` for HTML, `CarveWriteError` for Carve. */
  strictLosses?: boolean
  [option: string]: unknown
}

/** What a writer returns: its output and the diagnostics of the run. */
export interface WriterResult {
  output: string
  diagnostics: Diagnostic[]
}

/** A writer of one target: it takes a tree that `parse` returned or that `validateTree` passed. */
export interface Writer {
  readonly target: string
  write(document: DocumentNode, options?: WriterOptions): WriterResult
}

export interface WriterRegistry {
  /** Adds a writer. Refuses a target that is taken, reserved or not a lower-case name. */
  register(writer: Writer): void
  has(target: string): boolean
  /** The targets in the order they were registered, the built-in ones first. */
  targets(): string[]
  /** Writes `document` for `target`. Refuses an unknown target with `CarveOptionError`. */
  write(target: string, document: DocumentNode, options?: WriterOptions): WriterResult
}

/** Targets kept for the exports of `@markup-carve/carve/export`, which only they may register. */
export const RESERVED_WRITER_TARGETS: readonly string[] = ['markdown', 'plain', 'ansi']

/** Marks the writers of `@markup-carve/carve/export`; a symbol of the registry, so it holds across separate bundles. */
export const EXPORT_WRITER: unique symbol = Symbol.for('@markup-carve/carve.exportWriter') as never

function isExportWriter(writer: Writer): boolean {
  return (writer as Writer & { [EXPORT_WRITER]?: unknown })[EXPORT_WRITER] === true
}

const TARGET = /^[a-z][a-z0-9-]*$/u

const htmlWriter: Writer = {
  target: 'html',
  write(document, options) {
    const result = renderWithDiagnostics(document, options as RenderOptions | undefined)
    const losses = result.diagnostics.filter((entry) => entry.channel === 'render-loss')
    if (options?.strictLosses === true && losses.length > 0) throw new CarveRenderError(losses)
    return { output: result.html, diagnostics: result.diagnostics }
  },
}

const carveWriter: Writer = {
  target: 'carve',
  write(document, options) {
    checkOptions(options, { strictLosses: 'boolean', extensions: 'extensions', layout: 'layout', alignTables: 'boolean', check: 'boolean' })
    const { strictLosses, ...rest } = options ?? {}
    const result = writeWithDiagnostics(document, rest)
    if (strictLosses === true && writerHasLoss(result.diagnostics)) throw new CarveWriteError(result.diagnostics)
    return { output: result.source, diagnostics: result.diagnostics }
  },
}

/** A registry that holds the built-in writers, `html` and `carve`, and takes more. */
export function createWriterRegistry(): WriterRegistry {
  const writers = new Map<string, Writer>([[htmlWriter.target, htmlWriter], [carveWriter.target, carveWriter]])
  return {
    register(writer) {
      if (typeof writer !== 'object' || writer === null || typeof writer.write !== 'function') {
        throw new CarveOptionError('writer', 'not a writer')
      }
      const target: unknown = writer.target
      if (typeof target !== 'string' || !TARGET.test(target)) throw new CarveOptionError('writer', 'the target is not a lower-case name')
      if (RESERVED_WRITER_TARGETS.includes(target) && !isExportWriter(writer)) {
        throw new CarveOptionError('writer', `the target ${target} is reserved`)
      }
      if (writers.has(target)) throw new CarveOptionError('writer', `the target ${target} is taken`)
      writers.set(target, writer)
    },
    has: (target) => writers.has(target),
    targets: () => [...writers.keys()],
    write(target, document, options) {
      const writer = writers.get(target)
      if (writer === undefined) {
        throw new CarveOptionError('target', `unknown writer target ${JSON.stringify(target)}; known targets: ${[...writers.keys()].join(', ')}`)
      }
      return writer.write(document, options)
    },
  }
}

const builtIn = createWriterRegistry()

/** Writes `document` with a built-in writer: `html` or `carve`. */
export function writeDocument(target: string, document: DocumentNode, options?: WriterOptions): WriterResult {
  return builtIn.write(target, document, options)
}
