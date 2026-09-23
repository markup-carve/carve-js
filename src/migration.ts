import { djotToCarve } from './djot-import.js'
import { bbcodeToCarve } from './bbcode-migrate.js'
import {
  htmlToCarve,
  type HtmlImportAdapter,
  type HtmlImportMode,
  type HtmlImportOptions,
} from './html-import.js'
import { markdownToCarveWithLosses, type MarkdownDialect } from './markdown-migrate.js'

export type SourceFormat = 'html' | 'markdown' | 'djot' | 'bbcode'
export type MigrationFidelity = 'preserved' | 'normalized' | 'degraded' | 'dropped'
export type MigrationConfidence = 'exact' | 'inferred' | 'fallback'

export interface MigrationDiagnostic {
  code: string
  message: string
  severity: 'info' | 'warning' | 'error'
  path?: string
  line?: number
  column?: number
  fidelity: MigrationFidelity
  confidence: MigrationConfidence
}

export interface MigrationResult {
  value: string
  report: {
    schemaVersion: 2
    sourceFormat: SourceFormat
    mode?: HtmlImportMode
    adapter?: HtmlImportAdapter
    diagnostics: MigrationDiagnostic[]
  }
}

export function migrateHtml(source: string, options: HtmlImportOptions = {}): MigrationResult {
  const result = htmlToCarve(source, options)
  return {
    value: result.value,
    report: {
      schemaVersion: 2,
      sourceFormat: 'html',
      mode: result.report.mode,
      adapter: result.report.adapter,
      // The importer STAMPS fidelity and confidence, so they are carried rather
      // than recomputed here. This file used to hold a second copy of the
      // table, which meant the plain import report - the one the shared
      // fixtures compare - was missing a decision this engine had already made,
      // and the two copies could disagree about a code without anything saying
      // so.
      diagnostics: result.report.diagnostics.map((diagnostic) => ({ ...diagnostic })),
    },
  }
}

function unverified(
  value: string,
  sourceFormat: Exclude<SourceFormat, 'html'>,
  known: readonly MigrationDiagnostic[] = [],
): MigrationResult {
  const diagnostics: MigrationDiagnostic[] = [{
    code: 'fidelity-unverified',
    message: `Fidelity was not reported by the ${sourceFormat} importer; dropped is a conservative worst-case release-gate classification`,
    severity: 'warning',
    fidelity: 'dropped',
    confidence: 'fallback',
  }, ...known]
  return { value, report: { schemaVersion: 2, sourceFormat, diagnostics } }
}

export function migrateMarkdown(
  source: string,
  options: { dialect?: MarkdownDialect } = {},
): MigrationResult {
  const result = markdownToCarveWithLosses(source, options.dialect)
  // The construct-level losses the Markdown importer DOES know about. They sit
  // beside `fidelity-unverified` rather than replacing it: the importer still
  // reports nothing about the constructs it has no answer for, so the
  // conservative worst case still stands for the rest of the document.
  return unverified(result.value, 'markdown', result.losses.map((loss) => ({
    code: loss.code,
    message: loss.message,
    severity: 'warning',
    fidelity: 'dropped',
    confidence: 'exact',
  })))
}

export function migrateDjot(source: string): MigrationResult {
  return unverified(djotToCarve(source), 'djot')
}

export function migrateBbcode(source: string): MigrationResult {
  return unverified(bbcodeToCarve(source), 'bbcode')
}
