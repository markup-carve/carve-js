import { djotToCarve } from './djot-import.js'
import { djotMigrationWarnings } from './djot-migrate.js'
import { bbcodeToCarve } from './bbcode-migrate.js'
import {
  htmlToCarve,
  type HtmlImportDiagnosticCode,
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
    mode?: string
    adapter?: string
    diagnostics: MigrationDiagnostic[]
  }
}

function fidelity(code: HtmlImportDiagnosticCode): MigrationFidelity {
  if (code === 'element-dropped' || code === 'attribute-dropped' || code === 'structure-unspellable') {
    return 'dropped'
  }
  if (
    code === 'element-unwrapped' || code === 'style-unmapped' || code === 'table-degraded' || code === 'encoding-assumed' ||
    code === 'diagnostics-truncated'
  ) return 'degraded'
  // Everything else is PRESERVED, and `attribute-preserved` belongs here rather
  // than beside `attribute-dropped` above: it is the row saying an attribute
  // reached the output inside preserved raw bytes, so filing it as a drop would
  // restate the false claim it exists to remove (markup-carve/carve-js#1468).
  return 'preserved'
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
        confidence: diagnostic.code === 'encoding-assumed'
          ? 'inferred'
          : diagnostic.code === 'diagnostics-truncated' ? 'fallback' : 'exact',
      })),
    },
  }
}

function unverified(value: string, sourceFormat: Exclude<SourceFormat, 'html'>): MigrationResult {
  const diagnostics: MigrationDiagnostic[] = [{
    code: 'fidelity-unverified',
    message: `Fidelity was not reported by the ${sourceFormat} importer; degraded is a conservative release-gate classification`,
    severity: 'warning',
    fidelity: 'degraded',
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
  const result = unverified(djotToCarve(source), 'djot')
  const decisions = djotMigrationWarnings(source).map((warning): MigrationDiagnostic => ({
    code: warning.rule,
    message: `Normalized ${warning.rule} to Carve-compatible syntax`,
    severity: 'info',
    fidelity: 'normalized',
    confidence: 'exact',
    line: warning.line,
    column: warning.column,
  }))
  if (decisions.length) result.report.diagnostics.push(...decisions)
  return result
}

export function migrateBbcode(source: string): MigrationResult {
  return unverified(bbcodeToCarve(source), 'bbcode')
}
