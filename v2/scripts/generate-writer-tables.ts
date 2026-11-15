// Writes src/write-tables.ts from data/escape-contexts.json, data/smart-punctuation.json and
// data/inline-delimiters.json: for each ASCII code, the escape contexts of C2-W-088 it can start.
//   node v2/scripts/generate-writer-tables.ts
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { wrapJson } from './wrap-literal.ts'

export type DataReader = (file: string) => string

interface Context {
  name: string
  group: string
  triggers: string[]
  positions: string[]
}

interface Contexts {
  contexts: Context[]
}

interface Smart {
  runs: { source: string, replaced: boolean }[]
  quotes: { source: string }[]
  dashes: { source: string }[]
}

interface Delimiters {
  delimiters: { form: string, mark: string }[]
}

const ASCII = 128

/** 1 at the first code of every trigger of the contexts that `wanted` keeps. */
function firstCodes(contexts: readonly Context[], wanted: (context: Context) => boolean): number[] {
  const codes = new Array<number>(ASCII).fill(0)
  for (const context of contexts) {
    if (!wanted(context)) continue
    for (const trigger of context.triggers) codes[trigger.charCodeAt(0)] = 1
  }
  return codes
}

/** The text of src/write-tables.ts for the data files `read` returns. */
export function generateWriterTables(read: DataReader): string {
  const contexts = (JSON.parse(read('escape-contexts.json')) as Contexts).contexts
  const smart = JSON.parse(read('smart-punctuation.json')) as Smart
  const delimiters = (JSON.parse(read('inline-delimiters.json')) as Delimiters).delimiters
  // C2-B-133: a line comment also opens after whitespace inside a line.
  const inline = firstCodes(contexts, (context) => context.group !== 'block' || context.positions.includes('after_whitespace'))
  const line = firstCodes(contexts, (context) => context.group === 'block')
  // C2-W-095: the runs that smart typography replaces where the tree holds text.
  const sources = [...smart.runs.filter((run) => run.replaced).map((run) => run.source),
    ...smart.quotes.map((quote) => quote.source), ...smart.dashes.map((dash) => dash.source)]
  for (const source of sources) inline[source.charCodeAt(0)] = 1
  // C2-W-093: the closer of a braced span is its mark before a closing brace.
  const marks = [...new Set(delimiters.filter((entry) => entry.form === 'braced').map((entry) => entry.mark))].sort()
  for (const mark of marks) inline[mark.charCodeAt(0)] = 1
  inline['}'.charCodeAt(0)] = 1
  return [
    '// Generated from data/escape-contexts.json, data/smart-punctuation.json and data/inline-delimiters.json',
    '// by scripts/generate-writer-tables.ts. Do not edit.',
    '',
    '/** C2-W-093 to C2-W-098: 1 where an ASCII code can start an inline construct, the reader rules of C2-I behind it. */',
    ...wrapJson('export const INLINE_TRIGGERS: readonly number[] = ', inline),
    '',
    '/** C2-W-092: 1 where an ASCII code can start a block opener at the start of a content line. */',
    ...wrapJson('export const LINE_TRIGGERS: readonly number[] = ', line),
    '',
    '/** C2-W-095: the sources of smart punctuation that the reader replaces (C2-I-104 to C2-I-117). */',
    ...wrapJson('export const SMART_SOURCES: readonly string[] = ', [...new Set(sources)].sort()),
    '',
    `export const BRACED_CLOSER_MARKS = ${JSON.stringify(marks.join(''))}`,
    '',
  ].join('\n')
}

if (process.argv[1] === import.meta.filename) {
  const root = join(import.meta.dirname, '..')
  writeFileSync(join(root, 'src/write-tables.ts'), generateWriterTables((file) => readFileSync(join(root, 'data', file), 'utf8')))
}
