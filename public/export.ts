/**
 * The exports of a Carve 0.2 tree (`@markup-carve/carve/export`): Markdown, plain text and ANSI. The core entry never
 * loads this one. Each format has one call that returns the text and the losses of the run; the writers of the
 * targets `markdown`, `plain` and `ansi` put the same calls behind the writer registry.
 */
import { type DocumentNode } from '../src/ast.ts'
import { exportTo, type ExportOptions, EXPORT_TARGETS, type ExportTarget } from '../src/export/index.ts'
import { createWriterRegistry, EXPORT_WRITER, type Writer, type WriterOptions, type WriterRegistry, type WriterResult } from './writers.ts'

export {
  type AnsiExportOptions, CarveExportError, EXPORT_TARGETS, type ExportOptions, type ExportResult, type ExportTarget,
  type MarkdownExportOptions, type PlainTextExportOptions, toAnsi, toMarkdown, toPlainText,
} from '../src/export/index.ts'

function exportWriter(target: ExportTarget): Writer {
  return {
    target,
    [EXPORT_WRITER]: true,
    write: (document: DocumentNode, options?: WriterOptions) => exportTo(target, document, options as ExportOptions | undefined),
  } as Writer
}

/** The writers of the three export targets, for `WriterRegistry.register`. */
export const exportWriters: readonly Writer[] = EXPORT_TARGETS.map(exportWriter)

/** Registers the writers of `markdown`, `plain` and `ansi` on `registry`, which has none of them yet. */
export function registerExports(registry: WriterRegistry): WriterRegistry {
  for (const writer of exportWriters) registry.register(writer)
  return registry
}

const registry = registerExports(createWriterRegistry())

/**
 * Writes `document` for a target by name: `html`, `carve`, `markdown`, `plain` or `ansi`. An unknown target is
 * refused with `CarveOptionError`, whose message lists the known targets.
 */
export function exportDocument(target: string, document: DocumentNode, options?: WriterOptions): WriterResult {
  return registry.write(target, document, options)
}

/** The targets `exportDocument` writes. */
export function exportTargets(): string[] {
  return registry.targets()
}
