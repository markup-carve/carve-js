import { importThroughHtml } from './hub.ts'
import { importBbcode } from './bbcode.ts'
import { importHtml } from './html.ts'
import { runImport, type Format, type ImportResult } from './kit.ts'

export { BBCODE_MAX_INPUT_LENGTH, BbcodeInputTooLargeError } from './bbcode.ts'
export { ImportInputError, type ImportDiagnostic, type ImportResult } from './kit.ts'
export type { Format } from './kit.ts'

/** The options of an import. `rawHtml` keeps comments and raw elements of HTML as raw nodes (C2-M-065, C2-M-066). */
export interface ImportOptions { from: Format, rawHtml?: boolean, strictLosses?: boolean }

/** Parse a foreign document to a Carve 0.2 tree and write its canonical source. */
export function importDocument(input: string, options: ImportOptions): ImportResult {
  return runImport(options.from, options.strictLosses === true, () => importByFormat(input, options))
}

function importByFormat(input: string, options: ImportOptions): ImportResult {
  switch (options.from) {
    case 'markdown':
    case 'gfm':
    case 'djot': return importThroughHtml(input, options.from)
    case 'bbcode': return importBbcode(input)
    case 'html': return importHtml(input, options.rawHtml === true)
  }
}
