import { djotToCarve } from './djot-import.js'
import { bbcodeToCarve } from './bbcode-migrate.js'
import {
  htmlToCarve,
  type HtmlImportDiagnosticCode,
  type HtmlImportAdapter,
  type HtmlImportMode,
  type HtmlImportOptions,
} from './html-import.js'
import { markdownToCarve, type MarkdownDialect } from './markdown-migrate.js'

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

function fidelity(code: HtmlImportDiagnosticCode): MigrationFidelity {
  if (code === 'element-dropped' || code === 'attribute-dropped' || code === 'structure-unspellable') {
    return 'dropped'
  }
  if (
    code === 'element-unwrapped' || code === 'style-unmapped' || code === 'table-degraded' || code === 'encoding-assumed' ||
    code === 'raw-preserved'
  ) return 'degraded'
  if (code === 'diagnostics-truncated') return 'dropped'
  if (code === 'attribute-preserved') return 'preserved'
  return 'dropped'
}

function confidence(code: HtmlImportDiagnosticCode): MigrationConfidence {
  if (code === 'encoding-assumed') return 'inferred'
  if (code === 'diagnostics-truncated') return 'fallback'
  if (
    code === 'element-dropped' || code === 'attribute-dropped' || code === 'structure-unspellable' ||
    code === 'element-unwrapped' || code === 'style-unmapped' || code === 'table-degraded' ||
    code === 'attribute-preserved' || code === 'raw-preserved'
  ) return 'exact'
  return 'fallback'
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
      diagnostics: result.report.diagnostics.map((diagnostic) => ({
        ...diagnostic,
        fidelity: fidelity(diagnostic.code),
        confidence: confidence(diagnostic.code),
      })),
    },
  }
}

function unverified(value: string, sourceFormat: Exclude<SourceFormat, 'html'>): MigrationResult {
  const diagnostics: MigrationDiagnostic[] = [{
    code: 'fidelity-unverified',
    message: `Fidelity was not reported by the ${sourceFormat} importer; dropped is a conservative worst-case release-gate classification`,
    severity: 'warning',
    fidelity: 'dropped',
    confidence: 'fallback',
  }]
  return { value, report: { schemaVersion: 2, sourceFormat, diagnostics } }
}

export function migrateMarkdown(
  source: string,
  options: { dialect?: MarkdownDialect } = {},
): MigrationResult {
  return unverified(markdownToCarve(source, options.dialect), 'markdown')
}

export function migrateDjot(source: string): MigrationResult {
  return unverified(djotToCarve(source), 'djot')
}

export function migrateBbcode(source: string): MigrationResult {
  return unverified(bbcodeToCarve(source), 'bbcode')
}
