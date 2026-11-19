// The Markdown, plain-text and ANSI exports of a 0.2 tree: one call per format, and a writer of each target for the
// writer registry.
import { type DocumentNode } from '../ast.ts'
import {
  checkExportOptions, type ExportOptions, type ExportResult, type ExportTarget, finishExport, startExport,
} from './common.ts'
import { exportMarkdown } from './markdown.ts'
import { exportText } from './text.ts'

export { CarveExportError, EXPORT_LOSS_CODES, type ExportOptions, type ExportResult, type ExportTarget } from './common.ts'

export type MarkdownExportOptions = ExportOptions
export type PlainTextExportOptions = ExportOptions
export type AnsiExportOptions = ExportOptions

/** The targets of the exports, in the order the writer registry lists them. */
export const EXPORT_TARGETS: readonly ExportTarget[] = ['markdown', 'plain', 'ansi']

function run(target: ExportTarget, document: DocumentNode, options: ExportOptions | undefined): ExportResult {
  checkExportOptions(options)
  const x = startExport(target, document, options)
  const output = target === 'markdown' ? exportMarkdown(x) : exportText(x, target === 'ansi')
  return finishExport(x, output, options?.strictLosses)
}

/** The Markdown (CommonMark with GFM tables, task lists, strikethrough and footnotes) of a tree. */
export function toMarkdown(document: DocumentNode, options?: MarkdownExportOptions): ExportResult {
  return run('markdown', document, options)
}

/** The plain text of a tree. */
export function toPlainText(document: DocumentNode, options?: PlainTextExportOptions): ExportResult {
  return run('plain', document, options)
}

/** The text of a tree styled with ANSI escape sequences for a terminal. */
export function toAnsi(document: DocumentNode, options?: AnsiExportOptions): ExportResult {
  return run('ansi', document, options)
}

/** The export of `document` for `target`. */
export function exportTo(target: ExportTarget, document: DocumentNode, options?: ExportOptions): ExportResult {
  return run(target, document, options)
}
