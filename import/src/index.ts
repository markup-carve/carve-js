import { importThroughHtml } from './hub.ts'
import { importBbcode } from './bbcode.ts'
import { importHtml } from './html.ts'
import { readAdapter, type Adapter } from './html-adapter.ts'
import { CarveOptionError } from '../../src/options.ts'
import { runImport, type Format, type ImportResult } from './kit.ts'

export { BBCODE_MAX_INPUT_LENGTH, BbcodeInputTooLargeError } from './bbcode.ts'
export { ImportInputError, type ImportDiagnostic, type ImportResult } from './kit.ts'
export type { ImportConstruct } from './hub-constructs.ts'
export type { Format } from './kit.ts'
export { ADAPTERS, type Adapter } from './html-adapter.ts'

/** The options of an import. `rawHtml` keeps comments and raw elements of HTML as raw nodes (C2-M-065, C2-M-066). */
export interface ImportOptions {
  from: Format
  rawHtml?: boolean
  /** C2-M-101: the label map used when the HTML was rendered. */
  labels?: Readonly<Record<string, string>>
  /** C2-M-102: the editor that wrote the HTML; default `generic`. */
  adapter?: Adapter
  /** C2-M-112: HTML only; a table with a cell of blocks becomes a list table. */
  listTable?: boolean
  strictLosses?: boolean
  /** Markdown, GFM and Djot: adds `constructs`, a record of each construct of the input. */
  constructs?: boolean
  allowLosses?: readonly string[]
  maxLosses?: number
}

/** Parse a foreign document to a Carve 0.2 tree and write its canonical source. */
export function importDocument(input: string, options: ImportOptions): ImportResult {
  const adapter = readAdapter(options.adapter)
  if (adapter !== 'generic' && options.from !== 'html') throw new CarveOptionError('adapter', 'HTML only')
  if (options.listTable !== undefined && typeof options.listTable !== 'boolean') throw new CarveOptionError('listTable', 'not a boolean')
  if (options.listTable === true && options.from !== 'html') throw new CarveOptionError('listTable', 'HTML only')
  return runImport(options.from, options, () => importByFormat(input, options))
}

function importByFormat(input: string, options: ImportOptions): ImportResult {
  switch (options.from) {
    case 'markdown':
    case 'gfm':
    case 'djot': return importThroughHtml(input, options.from, options.constructs === true)
    case 'bbcode': return importBbcode(input)
    case 'html': return importHtml(input, options.rawHtml === true, {}, true, options.labels, readAdapter(options.adapter), options)
  }
}
