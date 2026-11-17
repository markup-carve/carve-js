import { importMarkdown } from './markdown.ts'
import { importDjot } from './djot.ts'
import { importHtml } from './html.ts'
import { ImportInputError, type Format, type ImportResult } from './kit.ts'
import { MAX_TREE_DEPTH } from '../../v2/src/index.ts'

export { ImportInputError, type ImportDiagnostic, type ImportResult } from './kit.ts'
export type { Format } from './kit.ts'

/** The options of an import. `rawHtml` keeps comments and raw elements of HTML as raw nodes (C2-M-065, C2-M-066). */
export interface ImportOptions { from: Format, rawHtml?: boolean, strictLosses?: boolean }

/** Parse a foreign document to a Carve 0.2 tree and write its canonical source. */
export function importDocument(input: string, options: ImportOptions): ImportResult {
  try {
    const result = importByFormat(input, options)
    if (options.strictLosses) for (const entry of result.diagnostics) {
      if (entry.channel === 'render-loss') entry.severity = 'error'
    }
    return result
  } catch (error) {
    if (error instanceof ImportInputError) throw error
    if (error instanceof RangeError && error.message.includes('stack')) {
      throw new ImportInputError(`Foreign input exceeds the engine tree depth limit of ${MAX_TREE_DEPTH}`, options.from)
    }
    throw new ImportInputError(error instanceof Error ? error.message : String(error), options.from)
  }
}

function importByFormat(input: string, options: ImportOptions): ImportResult {
  switch (options.from) {
    case 'markdown':
    case 'gfm': return importMarkdown(input, options.from)
    case 'djot': return importDjot(input)
    case 'html': return importHtml(input, options.rawHtml === true)
  }
}
