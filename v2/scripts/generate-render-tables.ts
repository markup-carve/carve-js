// Writes src/render-tables.ts from data/heading-slug.json, data/url-policy.json and data/include-options.json.
//   node v2/scripts/generate-render-tables.ts
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

interface HeadingSlug {
  removed: { code_point: string }[]
  reversed: { glyph: string, ascii: string }[]
}

interface ProfileRow {
  name: string
  denied_block?: string[]
  denied_inline?: string[]
  allowed_block?: string[]
  allowed_inline?: string[]
  link_rel?: string[]
  max_nesting?: number
  max_length?: number
}

interface UrlPolicy {
  probe_removes: { from: string, to: string }[]
  dropped_attributes: { name: string, match: string }[]
  url_list_attributes: { name: string, separators: string[] }[]
  style_patterns: { text: string }[]
  profiles: ProfileRow[]
}

interface IncludeOptions {
  options: { rank: number, name: string, value: string, without_value: string, outside_shape: string, repeated: string }[]
}

function codePoint(text: string): number {
  return Number.parseInt(text.slice(2), 16)
}

function list(value: string[] | undefined): string {
  return value === undefined ? 'null' : JSON.stringify(value)
}

function profileLine(row: ProfileRow): string {
  const fields = [
    `deniedBlock: ${list(row.denied_block)}`, `deniedInline: ${list(row.denied_inline)}`,
    `allowedBlock: ${list(row.allowed_block)}`, `allowedInline: ${list(row.allowed_inline)}`,
    `linkRel: ${JSON.stringify((row.link_rel ?? []).join(' '))}`,
    `maxNesting: ${row.max_nesting ?? -1}`, `maxLength: ${row.max_length ?? -1}`,
  ]
  return `  [${JSON.stringify(row.name)}, { ${fields.join(', ')} }],`
}

/** The text of src/render-tables.ts for the three data files. */
export function generateRenderTables(slugJson: string, policyJson: string, includeJson: string): string {
  const slug = JSON.parse(slugJson) as HeadingSlug
  const policy = JSON.parse(policyJson) as UrlPolicy
  const include = JSON.parse(includeJson) as IncludeOptions
  const names = (match: string): string[] => policy.dropped_attributes.filter((row) => row.match === match).map((row) => row.name)
  const options = include.options.slice().sort((a, b) => a.rank - b.rank)
  const lines = [
    '// Generated from data/heading-slug.json, data/url-policy.json and data/include-options.json by',
    '// scripts/generate-render-tables.ts. Do not edit.',
    '',
    '/** C2-H-144: the code points that never reach a slug. */',
    `export const SLUG_REMOVED: readonly number[] = ${JSON.stringify(slug.removed.map((row) => codePoint(row.code_point)))}`,
    '',
    '/** C2-H-145: the glyphs a slug writes as their ASCII source. */',
    'export const SLUG_REVERSED: ReadonlyMap<string, string> = new Map([',
    ...slug.reversed.map((row) => `  [${JSON.stringify(row.glyph)}, ${JSON.stringify(row.ascii)}],`),
    '])',
    '',
    '/** C2-H-159: the ranges of code points that are removed from a destination before its scheme is read. */',
    `export const PROBE_REMOVED: readonly (readonly [number, number])[] = ${JSON.stringify(policy.probe_removes.map((row) => [codePoint(row.from), codePoint(row.to)]).sort((a, b) => a[0]! - b[0]!))}`,
    '',
    '/** C2-H-161: the attribute names that are never written, and the prefixes of such names. */',
    `export const DROPPED_NAMES: readonly string[] = ${JSON.stringify(names('name'))}`,
    `export const DROPPED_PREFIXES: readonly string[] = ${JSON.stringify(names('prefix'))}`,
    '',
    '/** C2-H-161: the attributes that hold a list of URLs, and whether a comma separates its entries besides whitespace. */',
    'export const URL_LIST_ATTRIBUTES: ReadonlyMap<string, boolean> = new Map([',
    ...policy.url_list_attributes.map((row) => `  [${JSON.stringify(row.name)}, ${JSON.stringify(row.separators.includes('comma'))}],`),
    '])',
    '',
    '/** C2-H-162: the texts that blank a `style` value. */',
    `export const STYLE_PATTERNS: readonly string[] = ${JSON.stringify(policy.style_patterns.map((row) => row.text))}`,
    '',
    '/** C2-H-163: what a profile accepts. A list that is null does not restrict, and -1 is no bound. */',
    'export interface ProfileRule {',
    '  deniedBlock: readonly string[] | null',
    '  deniedInline: readonly string[] | null',
    '  allowedBlock: readonly string[] | null',
    '  allowedInline: readonly string[] | null',
    '  linkRel: string',
    '  maxNesting: number',
    '  maxLength: number',
    '}',
    '',
    'export const PROFILES: ReadonlyMap<string, ProfileRule> = new Map([',
    ...policy.profiles.map(profileLine),
    '])',
    '',
    '/** C2-B-205, C2-B-206: the shape of the value of each include option, and what a line is when the option has no value, a value outside the shape, or stands twice. */',
    'export interface IncludeOptionRule {',
    '  value: string',
    '  withoutValue: string',
    '  outsideShape: string',
    '  repeated: string',
    '}',
    '',
    '/** In the order of C2-A-181. */',
    'export const INCLUDE_OPTIONS: ReadonlyMap<string, IncludeOptionRule> = new Map([',
    ...options.map((row) => `  [${JSON.stringify(row.name)}, { value: ${JSON.stringify(row.value)}, withoutValue: ${JSON.stringify(row.without_value)}, outsideShape: ${JSON.stringify(row.outside_shape)}, repeated: ${JSON.stringify(row.repeated)} }],`),
    '])',
    '',
  ]
  return lines.join('\n')
}

if (process.argv[1] === import.meta.filename) {
  const root = join(import.meta.dirname, '..')
  const read = (name: string): string => readFileSync(join(root, 'data', name), 'utf8')
  writeFileSync(join(root, 'src/render-tables.ts'), generateRenderTables(read('heading-slug.json'), read('url-policy.json'), read('include-options.json')))
}
