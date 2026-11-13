// Writes src/inline-tables.ts from the inline data files in data/.
//   node v2/scripts/generate-inline.ts
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ASCII = 128

interface Shape {
  first?: string[]
  rest?: string[]
  chars?: string[]
  excluded?: string[]
}

interface Named {
  name: string
}

interface Run {
  source: string
  replaced: boolean
  kind?: string
  glyph?: string
}

interface Glyph {
  kind: string
  glyph: string
}

export type DataReader = (file: string) => string

function load<T>(read: DataReader, file: string): T {
  return JSON.parse(read(file)) as T
}

function byName<T extends Named>(rows: T[], name: string): T {
  const row = rows.find((candidate) => candidate.name === name)
  if (row === undefined) throw new Error(`no row ${name}`)
  return row
}

/** The codes an entry stands for: one character or a range such as `a-z`. */
function codesOf(entries: string[]): number[] {
  const codes: number[] = []
  for (const entry of entries) {
    const from = entry.charCodeAt(0)
    const to = entry.length === 3 ? entry.charCodeAt(2) : from
    for (let code = from; code <= to; code++) codes.push(code)
  }
  return codes
}

/** The character classes of the inline scan, as [constant, characters]. A class is one bit of the table. */
function characterClasses(read: DataReader): [string, string[]][] {
  const atoms = load<{ atoms: (Named & {
    url?: { scheme: Shape, body: Shape }
    email?: { local: Shape, domain: Shape, last_label: Shape }
    suffix_name?: Shape
  })[] }>(read, 'inline-atoms.json').atoms
  const sigils = load<{ sigils: (Named & { name_shape: Shape }) [] }>(read, 'inline-sigils.json').sigils
  const attributes = load<{ shapes: (Named & { shape: Shape })[] }>(read, 'attribute-block.json').shapes
  const braces = load<{ order: (Named & { marks?: string[] })[] }>(read, 'inline-braces.json').order
  const smart = load<{
    quote_opens_after: Shape
    quote_closes_after_hyphen_dash_or_slash_before: Shape
  }>(read, 'smart-punctuation.json')
  const autolink = byName(atoms, 'autolink')
  const raw = byName(atoms, 'raw_inline').suffix_name!
  const extension = byName(sigils, 'inline_extension').name_shape
  const symbol = byName(sigils, 'symbol').name_shape
  const key = byName(attributes, 'key').shape
  return [
    ['SCHEME_FIRST', autolink.url!.scheme.first!],
    ['SCHEME_REST', autolink.url!.scheme.rest!],
    ['URL_BODY', autolink.url!.body.chars!],
    ['EMAIL_LOCAL', autolink.email!.local.chars!],
    ['EMAIL_DOMAIN', autolink.email!.domain.chars!],
    ['EMAIL_LAST', autolink.email!.last_label.chars!],
    ['RAW_FIRST', raw.first!],
    ['RAW_REST', raw.rest!],
    ['EXTENSION_FIRST', extension.first!],
    ['EXTENSION_REST', extension.rest!],
    ['SYMBOL_FIRST', symbol.first!],
    ['SYMBOL_REST', symbol.rest!],
    ['MENTION', byName(sigils, 'mention').name_shape.chars!],
    ['NAME', byName(attributes, 'name').shape.chars!],
    ['KEY_FIRST', key.first!],
    ['KEY_REST', key.rest!],
    ['BARE_KEY_FIRST', byName(attributes, 'bare_key').shape.first!],
    ['LANGUAGE', byName(attributes, 'language_tag').shape.chars!],
    ['VALUE_END', byName(attributes, 'unquoted_value').shape.excluded!],
    ['BRACED_MARK', byName(braces, 'braced_opener').marks!],
    ['QUOTE_OPENS_AFTER', smart.quote_opens_after.chars!],
    ['QUOTE_CLOSES_BEFORE', smart.quote_closes_after_hyphen_dash_or_slash_before.chars!],
  ]
}

function classLines(classes: [string, string[]][], triggers: number[]): string[] {
  const table = new Array<number>(ASCII).fill(0)
  const lines: string[] = []
  classes.forEach(([name, entries], bit) => {
    lines.push(`export const CLASS_${name} = ${1 << bit}`)
    for (const code of codesOf(entries)) table[code]! |= 1 << bit
  })
  lines.push(`export const CLASS_SMART_TRIGGER = ${1 << classes.length}`)
  for (const code of triggers) table[code]! |= 1 << classes.length
  lines.push('', '/** The classes of each ASCII character. */', 'export const CHARACTER_CLASSES: readonly number[] = [')
  for (let row = 0; row < ASCII; row += 16) lines.push(`  ${table.slice(row, row + 16).join(', ')},`)
  lines.push(']')
  return lines
}

function smartLines(read: DataReader): { lines: string[], triggers: number[] } {
  const smart = load<{
    runs: Run[]
    quotes: Glyph[]
    dashes: Glyph[]
    apostrophe_words: { words: string[] }
  }>(read, 'smart-punctuation.json')
  const replaced = smart.runs.filter((run) => run.replaced)
  const kinds = new Map<string, string>()
  for (const row of [...replaced, ...smart.quotes, ...smart.dashes]) kinds.set(row.kind!, row.glyph!)
  const names = [...kinds.keys()].sort()
  const lines = names.map((name, index) => `export const SMART_${name.toUpperCase()} = ${index}`)
  lines.push('', `export const SMART_KIND_NAMES: readonly string[] = ${JSON.stringify(names)}`)
  lines.push(`export const SMART_GLYPHS: readonly string[] = ${JSON.stringify(names.map((name) => kinds.get(name)))}`)
  // The runs matched in text, the longest first (C2-I-115). The braced en dash is an atom of the scan.
  const runs = replaced.filter((run) => !run.source.startsWith('{')).sort((a, b) => b.source.length - a.source.length || (a.source < b.source ? -1 : 1))
  lines.push('', '/** The replaced runs, the longest first, as [source, kind]. */')
  lines.push(`export const SMART_RUNS: readonly (readonly [string, number])[] = [`)
  for (const run of runs) lines.push(`  [${JSON.stringify(run.source)}, ${names.indexOf(run.kind!)}],`)
  lines.push(']', '', `export const APOSTROPHE_WORDS: readonly string[] = ${JSON.stringify(smart.apostrophe_words.words)}`)
  const triggers = [...new Set([...runs.map((run) => run.source.charCodeAt(0)), ...smart.quotes.map((quote) => (quote as Glyph & { source: string }).source.charCodeAt(0)), ...smart.dashes.map((dash) => (dash as Glyph & { source: string }).source.charCodeAt(0))])]
  return { lines, triggers }
}

function markLines(read: DataReader): string[] {
  const delimiters = load<{ delimiters: { node: string, form: string, mark: string }[] }>(read, 'inline-delimiters.json').delimiters
  const braces = load<{ order: (Named & { marks?: string[] })[] }>(read, 'inline-braces.json').order
  const marks = byName(braces, 'braced_opener').marks!
  const nodes = marks.map((mark) => delimiters.find((row) => row.form === 'braced' && row.mark === mark)!.node)
  const bare = delimiters.filter((row) => row.form === 'bare').map((row) => row.mark)
  return [
    '/** The marks of the braced forms, the node each makes, and the marks that are bare delimiters. */',
    `export const BRACED_MARKS = ${JSON.stringify(marks.join(''))}`,
    `export const BRACED_NODES: readonly string[] = ${JSON.stringify(nodes)}`,
    `export const BARE_MARKS = ${JSON.stringify(bare.join(''))}`,
  ]
}

/** The text of src/inline-tables.ts for the data files `read` returns. */
export function generateInlineTables(read: DataReader): string {
  const smart = smartLines(read)
  const cap = load<{ limits: (Named & { value: number })[] }>(read, 'limits.json').limits
  return [
    '// Generated from the inline data files in data/ by scripts/generate-inline.ts. Do not edit.',
    '',
    ...classLines(characterClasses(read), smart.triggers),
    '',
    ...smart.lines,
    '',
    ...markLines(read),
    '',
    `export const DEPTH_CAP = ${byName(cap, 'depth_cap').value}`,
    '',
  ].join('\n')
}

if (process.argv[1] === import.meta.filename) {
  const root = join(import.meta.dirname, '..')
  writeFileSync(join(root, 'src/inline-tables.ts'), generateInlineTables((file) => readFileSync(join(root, 'data', file), 'utf8')))
}
