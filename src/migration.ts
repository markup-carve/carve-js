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
  if (code === 'element-unwrapped') return 'normalized'
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
      diagnostics: result.report.diagnostics.map((diagnostic) => ({
        ...diagnostic,
        fidelity: fidelity(diagnostic.code),
        confidence: diagnostic.code === 'encoding-assumed' ? 'inferred' : 'exact',
      })),
    },
  }
}

function normalized(value: string, source: string, sourceFormat: Exclude<SourceFormat, 'html'>): MigrationResult {
  const diagnostics: MigrationDiagnostic[] = value === source ? [] : [{
    code: 'syntax-normalized',
    message: `Converted ${sourceFormat} syntax to canonical Carve source`,
    severity: 'info',
    fidelity: 'normalized',
    confidence: 'exact',
  }]
  return { value, report: { schemaVersion: 2, sourceFormat, diagnostics } }
}

export function migrateMarkdown(
  source: string,
  options: { dialect?: MarkdownDialect } = {},
): MigrationResult {
  return normalized(markdownToCarve(source, options.dialect), source, 'markdown')
}

export function migrateDjot(source: string): MigrationResult {
  const result = normalized(djotToCarve(source), source, 'djot')
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
  return normalized(bbcodeToCarve(source), source, 'bbcode')
}
