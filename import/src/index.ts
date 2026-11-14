import { importMarkdown } from './markdown.ts'
import { importDjot } from './djot.ts'
import { importHtml } from './html.ts'
import { ImportInputError, type Format, type ImportResult } from './kit.ts'

export { ImportInputError, type ImportDiagnostic, type ImportResult } from './kit.ts'
export type { Format } from './kit.ts'

/** Parse a foreign document to a Carve 0.2 tree and write its canonical source. */
export function importDocument(input: string, options: { from: Format }): ImportResult {
  try {
    switch (options.from) {
      case 'markdown':
      case 'gfm': return importMarkdown(input, options.from)
      case 'djot': return importDjot(input)
      case 'html': return importHtml(input)
    }
  } catch (error) {
    if (error instanceof ImportInputError) throw error
    throw new ImportInputError(error instanceof Error ? error.message : String(error), options.from)
  }
}
