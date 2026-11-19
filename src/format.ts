// The formatter (C2-W-001, C2-W-100): the source is parsed with its sidecar and written again.
import { parseWithLayout } from './api.ts'
import { CarveOptionError, checkType, type Options } from './options.ts'
import { OPTION_KINDS } from './option-tables.ts'
import { type Diagnostic } from './diagnostics.ts'
import { CarveWriteError, writeTree, writerHasLoss } from './write.ts'

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
  // C2-W-091: the tree is the parse of the source, so the writer does not parse its plan again.
  const writeOptions = normalize ? { alignTables, extensions } : { layout: parsed.layout, alignTables, extensions }
  const written = writeTree(parsed.document, writeOptions, false)
  // C2-N-005: a processor whose output is Carve source expands nothing, so no include is missing a resolver.
  const found = parsed.diagnostics.filter((entry) => entry.code !== 'include-no-resolver')
  return { source: written.source, diagnostics: [...found, ...written.diagnostics] }
}

/** The canonical form of `source` (spec/0.2/writer.md). C2-W-002: it parses to the tree of `source`. */
export function format(source: string, options?: FormatOptions): string {
  const result = formatWithDiagnostics(source, options)
  if (writerHasLoss(result.diagnostics)) throw new CarveWriteError(result.diagnostics)
  return result.source
}
