/**
 * `@markup-carve/carve/import`: `importDocument` for Markdown, GFM, Djot, BBCode and HTML. The core entry never loads
 * this module, so the Markdown and Djot libraries it uses are loaded only by a host that imports it.
 *
 * Markdown and GFM (micromark) and Djot (djot.js) are rendered to HTML by their reference library and read by the 0.2
 * HTML importer (C2-M); BBCode is written as HTML by the engine. Every route writes its Carve source with the engine
 * writer. These formats are outside the specification (C2-T-003); `html` is the call of the core entry.
 */
import { importDocument as importAny, type ImportResult } from '../import/src/index.ts'
import { ImportInputError } from '../import/src/kit.ts'
import { CarveOptionError } from '../src/options.ts'
import { checkOptions } from './check.ts'

export { BBCODE_MAX_INPUT_LENGTH, BbcodeInputTooLargeError } from '../import/src/bbcode.ts'
export { ImportInputError, type ImportDiagnostic, type ImportResult } from '../import/src/kit.ts'
export type { ImportConstruct } from '../import/src/hub-constructs.ts'

/** The formats this entry reads. */
export type ImportFormat = 'markdown' | 'gfm' | 'djot' | 'bbcode' | 'html'
const FORMATS: readonly string[] = ['markdown', 'gfm', 'djot', 'bbcode', 'html'] satisfies ImportFormat[]

/** The options of `importDocument`. */
export interface ImportOptions {
  /** The input format. */
  from: ImportFormat
  /** HTML only (C2-M-065, C2-M-066): keeps comments and raw elements as raw nodes. Markdown and Djot keep raw HTML always. */
  rawHtml?: boolean
  /** C2-M-101: the label map used when the HTML was rendered. */
  labels?: Readonly<Record<string, string>>
  /** HTML only (C2-M-102): the editor that wrote the HTML; default `generic`. */
  adapter?: 'generic' | 'tiptap' | 'prosemirror' | 'ckeditor' | 'tinymce' | 'word' | 'google-docs'
  /** C2-M-082: makes each loss of the import an error. */
  strictLosses?: boolean
  /** Markdown, GFM and Djot: adds `constructs`, a record of each construct of the input and whether the tree holds it. */
  constructs?: boolean
}

/**
 * Imports a document as a Carve 0.2 tree and writes its canonical source. Refuses an input the importer cannot read
 * with `ImportInputError` (BBCode past its limit with `BbcodeInputTooLargeError`) and an unknown option with
 * `CarveOptionError`.
 */
export function importDocument(input: string, options: ImportOptions): ImportResult {
  if (options === undefined) throw new CarveOptionError('from', 'required')
  checkOptions(options, { from: 'string', rawHtml: 'boolean', labels: 'labels', adapter: 'string', strictLosses: 'boolean', constructs: 'boolean' })
  if (!FORMATS.includes(options.from)) throw new CarveOptionError('from', `unknown value ${JSON.stringify(options.from)}`)
  if (typeof input !== 'string') throw new ImportInputError('the input is not text', options.from)
  return importAny(input, options)
}
