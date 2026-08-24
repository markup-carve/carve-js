import { djotToCarve } from './djot-import.js'
import {
  htmlToCarve,
  type HtmlImportDiagnostic,
  type HtmlImportDiagnosticCode,
  type HtmlImportOptions,
} from './html-import.js'
import { markdownToCarve, type MarkdownDialect } from './markdown-migrate.js'

export type SourceFormat = 'html' | 'markdown' | 'djot'
export type MigrationFidelity = 'carried' | 'degraded' | 'dropped'
export type MigrationConfidence = 'exact' | 'inferred' | 'fallback'

export interface MigrationDiagnostic extends HtmlImportDiagnostic {
  fidelity: MigrationFidelity
  confidence: MigrationConfidence
}

export interface MigrationResult {
  value: string
  report: {
    schemaVersion: 1
    sourceFormat: SourceFormat
    diagnostics: MigrationDiagnostic[]
  }
}

function fidelity(code: HtmlImportDiagnosticCode): MigrationFidelity {
  if (code === 'element-dropped' || code === 'attribute-dropped' || code === 'structure-unspellable') {
    return 'dropped'
  }
  if (
    code === 'style-unmapped' || code === 'table-degraded' || code === 'encoding-assumed' ||
    code === 'diagnostics-truncated'
  ) return 'degraded'
  return 'carried'
}

export function migrateHtml(source: string, options: HtmlImportOptions = {}): MigrationResult {
  const result = htmlToCarve(source, options)
  return {
    value: result.value,
    report: {
      schemaVersion: 1,
      sourceFormat: 'html',
      diagnostics: result.report.diagnostics.map((diagnostic) => ({
        ...diagnostic,
        fidelity: fidelity(diagnostic.code),
        confidence: diagnostic.code === 'encoding-assumed' ? 'inferred' : 'exact',
      })),
    },
  }
}

function exact(value: string, sourceFormat: Exclude<SourceFormat, 'html'>): MigrationResult {
  return { value, report: { schemaVersion: 1, sourceFormat, diagnostics: [] } }
}

export function migrateMarkdown(
  source: string,
  options: { dialect?: MarkdownDialect } = {},
): MigrationResult {
  return exact(markdownToCarve(source, options.dialect), 'markdown')
}

export function migrateDjot(source: string): MigrationResult {
  return exact(djotToCarve(source), 'djot')
}
