import { trimEndMatchingEdges } from './trim-non-nbsp.js'
import { djotToCarveWithLosses, stripDjotFootnoteDefinitionAttributes } from './djot-import.js'
import { bbcodeToCarve } from './bbcode-migrate.js'
import {
  htmlToCarve,
  type HtmlImportAdapter,
  type HtmlImportMode,
  type HtmlImportOptions,
} from './html-import.js'
import { markdownToCarveWithLosses, type MarkdownDialect } from './markdown-migrate.js'
import { assessMarkdown } from './markdown-assessment.js'
import { ORDERED_TASK_ITEM_UNSPELLABLE } from './import-report-messages.js'

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

function assessed(
  source: string,
  value: string,
  sourceFormat: Exclude<SourceFormat, 'html'>,
  known: readonly MigrationDiagnostic[] = [],
  verifyLiteral = true,
): MigrationResult {
  const literal = trimEndMatchingEdges(source.replace(/\r\n?/g, '\n'), (code) => code === 10)
  const written = trimEndMatchingEdges(value, (code) => code === 10)
  if (verifyLiteral && known.length === 0 && (literal === '' || /^[\p{L}\p{N}]+(?: [\p{L}\p{N}]+)*$/u.test(literal)) && written === literal) {
    return { value, report: { schemaVersion: 2, sourceFormat, diagnostics: [{
      code: 'literal-text-verified',
      message: 'Verified the complete input as literal text.',
      severity: 'info',
      fidelity: 'preserved',
      confidence: 'exact',
    }] } }
  }
  const diagnostics: MigrationDiagnostic[] = [{
    code: 'fidelity-unverified',
    message: sourceFormat === 'markdown' ? 'Markdown construct assessment is incomplete.' : `Fidelity was not reported by the ${sourceFormat} importer; dropped is a conservative worst-case release-gate classification`,
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
  const supportedDialect = !Object.values(options.dialect ?? {}).some(Boolean)
  const assessment = supportedDialect ? assessMarkdown(source, result.value) : { complete: false, diagnostics: [] }
  const fallback = assessed(source, result.value, 'markdown', result.losses.map(loss => {
    const path = loss.line === undefined ? undefined : `line:${loss.line}`
    return {
      code: loss.code,
      message: loss.message,
      // `frontmatter-synthesized` records a DECISION between two readings, not
      // a loss: the mapping is carried over whole. The other codes name
      // something the conversion could not spell.
      severity: loss.code === 'frontmatter-synthesized' ? 'info' : 'warning',
      // `normalized`, not `preserved`: a bare `---` block becoming front
      // matter is an alternate block form resolved, which is what the term
      // covers in docs/format-bridges.md (markup-carve/carve#2806).
      // A loss may name its own fidelity where the construct survives and the
      // text does not: a raw span keeps its tag and loses the whitespace Carve
      // drops at a content line's end (markup-carve/carve#2804).
      fidelity: loss.fidelity ?? (loss.code === 'frontmatter-synthesized' ? 'normalized' : 'dropped'),
      confidence: loss.confidence ?? 'exact',
      ...(path ? { path } : {}),
    }
  }), supportedDialect)
  if (fallback.report.diagnostics[0]?.code === 'literal-text-verified') {
    fallback.report.diagnostics[0].path = 'line:1'
    return fallback
  }
  if (assessment.complete && result.losses.every(loss => loss.message === ORDERED_TASK_ITEM_UNSPELLABLE) && result.losses.length <= assessment.diagnostics.filter(row => row.code === 'structure-unspellable').length) {
    return { value: result.value, report: { schemaVersion: 2, sourceFormat: 'markdown', diagnostics: assessment.diagnostics } }
  }
  return fallback
}

export function migrateDjot(source: string): MigrationResult {
  const stripped = stripDjotFootnoteDefinitionAttributes(source)
  const imported = djotToCarveWithLosses(source)
  const result = assessed(source, imported.value, 'djot', imported.losses.map(loss => ({ code: loss.code, message: loss.message, severity: 'warning', fidelity: 'dropped', confidence: 'exact', path: `line:${loss.line}` })))
  for (const loss of stripped.losses) result.report.diagnostics.push({
    code: 'djot-footnote-definition-attributes-dropped',
    message: 'Carve cannot represent attributes on a footnote definition; they were dropped instead of applying them to later content.',
    severity: 'warning', fidelity: 'dropped', confidence: 'exact', path: `line:${loss.line}`,
  })
  return result
}

export function migrateBbcode(source: string): MigrationResult {
  return assessed(source, bbcodeToCarve(source), 'bbcode')
}
