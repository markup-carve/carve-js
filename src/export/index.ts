// The Markdown, plain-text and ANSI exports of a 0.2 tree: one call per format, and a writer of each target for the
// writer registry.
import { type DocumentNode } from '../ast.ts'
import {
  checkExportOptions, type ExportOptions, type ExportResult, type ExportTarget, finishExport, loss, startExport,
} from './common.ts'
import { firstAboveSix, HEADING_SHIFT_CODE, headingShiftMessage, shiftHeadings } from '../heading-shift.ts'
import { exportMarkdown } from './markdown.ts'
import { exportText } from './text.ts'

export { CarveExportError, EXPORT_LOSS_CODES, type ExportOptions, type ExportResult, type ExportTarget } from './common.ts'

export interface MarkdownExportOptions extends ExportOptions {
  /** C2-H-209: levels every heading moves down, 0 to 5; a level above 6 is written as 6 and reported. */
  headingShift?: number
}
export type PlainTextExportOptions = ExportOptions
export type AnsiExportOptions = ExportOptions

/** The targets of the exports, in the order the writer registry lists them. */
export const EXPORT_TARGETS: readonly ExportTarget[] = ['markdown', 'plain', 'ansi']

function run(target: ExportTarget, document: DocumentNode, options: MarkdownExportOptions | undefined): ExportResult {
  checkExportOptions(options, [], target)
  const x = startExport(target, document, options)
  const headingShift = options?.headingShift
  // C2-H-209: the shift runs on the resolved copy, and the Markdown writer spells a level above 6 as 6.
  if (headingShift !== undefined && headingShift !== 0) {
    shiftHeadings(x.document, headingShift)
    const above = firstAboveSix(x.document)
    if (above !== undefined) loss(x, above, HEADING_SHIFT_CODE, headingShiftMessage(headingShift))
  }
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
export function exportTo(target: ExportTarget, document: DocumentNode, options?: MarkdownExportOptions): ExportResult {
  return run(target, document, options)
}
