// The formatter (C2-W-001, C2-W-100): the source is parsed with its sidecar and written again.
import { parseWithLayout } from './api.ts'
import { CarveOptionError, type Options } from './options.ts'
import { OPTION_KINDS } from './option-tables.ts'
import { type Diagnostic } from './diagnostics.ts'
import { writeTree } from './write.ts'

/** The options of the formatter (C2-H-137): `alignTables` (C2-W-068). */
export type FormatOptions = Pick<Options, 'alignTables'>

export interface FormatOutput {
  source: string
  /** The diagnostics of the parse, and what the writer could not write (C2-W-103). */
  diagnostics: Diagnostic[]
}

/** C2-H-137: refuses a name that is no option, an option of another stage and a value of the wrong type. */
function readFormatOptions(options: object | undefined): boolean {
  const given = (options ?? {}) as Readonly<Record<string, unknown>>
  for (const name of Object.keys(given)) {
    const kind = OPTION_KINDS.get(name)
    if (kind === undefined) throw new CarveOptionError(name, 'unknown option')
    if (kind !== 'format') throw new CarveOptionError(name, 'not an option of format')
  }
  const align = given['alignTables']
  if (align !== undefined && typeof align !== 'boolean') throw new CarveOptionError('alignTables', 'not a boolean')
  return align === true
}

/** The canonical form of `source`, with the diagnostics of the parse and of the writer. */
export function formatWithDiagnostics(source: string, options?: FormatOptions): FormatOutput {
  const alignTables = readFormatOptions(options)
  const parsed = parseWithLayout(source)
  const written = writeTree(parsed.document, { layout: parsed.layout, alignTables })
  return { source: written.source, diagnostics: [...parsed.diagnostics, ...written.diagnostics] }
}

/** The canonical form of `source` (spec/0.2/writer.md). C2-W-002: it parses to the tree of `source`. */
export function format(source: string, options?: FormatOptions): string {
  return formatWithDiagnostics(source, options).source
}
