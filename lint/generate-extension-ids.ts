import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** C2-X-079: the catalog rows of data/extensions.json, split by whether the row is marked `ids`. */
export function generateExtensionIds(json: string): string {
  const rows = (JSON.parse(json) as { extensions: { name: string, ids?: true }[] }).extensions
  const names = (ids: boolean): string => ['[', ...rows.filter((row) => (row.ids === true) === ids).map((row) => row.name).sort()
    .map((name) => `  ${JSON.stringify(name)},`), ']'].join('\n')
  return ['// C2-X-079: generated from data/extensions.json by lint/generate-extension-ids.ts. Do not edit.',
    '',
    '/** The catalog extensions whose row is marked `ids`. */',
    `export const ID_CATALOG_EXTENSIONS: ReadonlySet<string> = new Set(${names(true)})`,
    '',
    '/** The catalog extensions that generate no ids. */',
    `export const PLAIN_CATALOG_EXTENSIONS: ReadonlySet<string> = new Set(${names(false)})`,
    '',
    '/**',
    ' * C2-X-079, C2-W-150: the registered extensions that generate ids, the run fact `id_extensions`. A definition outside the',
    ' * catalog is a host extension; one named below a catalog row (`carve.codeCallouts.code`) belongs to that row.',
    ' */',
    'export function idExtensions(definitions: readonly { readonly name: string }[] | undefined): string[] {',
    '  return (definitions ?? []).map((definition) => definition.name).filter((name) => ID_CATALOG_EXTENSIONS.has(name)',
    '    || (!PLAIN_CATALOG_EXTENSIONS.has(name) && !PLAIN_CATALOG_EXTENSIONS.has(name.slice(0, Math.max(0, name.lastIndexOf(\'.\'))))))',
    '}',
    ''].join('\n')
}

if (process.argv[1] === import.meta.filename) {
  const root = join(import.meta.dirname, '..')
  writeFileSync(join(import.meta.dirname, 'extension-ids.ts'), generateExtensionIds(readFileSync(join(root, 'data/extensions.json'), 'utf8')))
}
