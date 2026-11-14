// The formatter (C2-W-001, C2-W-100): the source is parsed with its sidecar and written again.
import { parseWithLayout } from './api.ts'
import { CarveOptionError, checkType, type Options } from './options.ts'
import { OPTION_KINDS } from './option-tables.ts'
import { type Diagnostic } from './diagnostics.ts'
import { writeTree } from './write.ts'

/** The options of the formatter (C2-H-137): `alignTables` (C2-W-068) and `normalize` (C2-W-127). */
export type FormatOptions = Pick<Options, 'alignTables' | 'normalize' | 'extensions'>

export interface FormatOutput {
  source: string
  /** The diagnostics of the parse, and what the writer could not write (C2-W-103). */
  diagnostics: Diagnostic[]
}

/** C2-H-137: refuses a name that is no option, an option of another stage and a value of the wrong type. */
function readFormatOptions(options: FormatOptions | undefined): { alignTables: boolean, normalize: boolean,
  extensions: NonNullable<Options['extensions']> } {
  const given = (options ?? {}) as Readonly<Record<string, unknown>>
  for (const name of Object.keys(given)) {
    if (!OPTION_KINDS.has(name)) throw new CarveOptionError(name, 'unknown option')
    checkType(name, given[name])
  }
  for (const name of Object.keys(given)) {
    if (OPTION_KINDS.get(name) !== 'format' && name !== 'extensions') throw new CarveOptionError(name, 'not an option of format')
  }
  return { alignTables: given['alignTables'] === true, normalize: given['normalize'] === true,
    extensions: options?.extensions ?? [] }
}

/** The canonical form of `source`, with the diagnostics of the parse and of the writer. */
export function formatWithDiagnostics(source: string, options?: FormatOptions): FormatOutput {
  const { alignTables, normalize, extensions } = readFormatOptions(options)
  const parsed = parseWithLayout(source, { extensions })
  // C2-W-127: with `normalize` the writer gets no sidecar, so every spelling takes its default form.
  const written = writeTree(parsed.document, normalize ? { alignTables, extensions } : { layout: parsed.layout, alignTables, extensions })
  return { source: written.source, diagnostics: [...parsed.diagnostics, ...written.diagnostics] }
}

/** The canonical form of `source` (spec/0.2/writer.md). C2-W-002: it parses to the tree of `source`. */
export function format(source: string, options?: FormatOptions): string {
  return formatWithDiagnostics(source, options).source
}
