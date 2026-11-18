// The call `importDocument` of C2-T-005. The public entry imports HTML only: the Markdown, GFM and Djot importers of
// the reference engine are outside the specification (C2-T-003) and stay on the command line.
import { importHtml } from '../../import/src/html.ts'
import { ImportInputError, type ImportResult, runImport } from '../../import/src/kit.ts'
import { CarveOptionError } from '../src/options.ts'
import { checkOptions } from './check.ts'

export { ImportInputError, type ImportDiagnostic, type ImportResult } from '../../import/src/kit.ts'

/** The options of `importDocument` (C2-M-001, C2-M-066, C2-M-082). */
export interface ImportOptions {
  /** The input format. */
  from: 'html'
  /** C2-M-065, C2-M-066: keeps comments and raw elements of HTML as raw nodes. */
  rawHtml?: boolean
  /** C2-M-082: makes each loss of the import an error. */
  strictLosses?: boolean
}

/**
 * Imports an HTML document as a Carve 0.2 tree and writes its canonical source (C2-M-001). Refuses an input the
 * importer cannot read with `ImportInputError` (C2-M-006) and an option it does not know with `CarveOptionError`.
 */
export function importDocument(input: string, options: ImportOptions): ImportResult {
  if (options === undefined) throw new CarveOptionError('from', 'required')
  checkOptions(options, { from: 'string', rawHtml: 'boolean', strictLosses: 'boolean' })
  if (options.from !== 'html') throw new CarveOptionError('from', `unknown value ${JSON.stringify(options.from)}`)
  if (typeof input !== 'string') throw new ImportInputError('the input is not text', 'html')
  return runImport('html', options.strictLosses === true, () => importHtml(input, options.rawHtml === true))
}
