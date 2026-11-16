// Copies the conformance corpus, the tree fixtures and every data file this engine keeps a copy of from a
// checkout of the specification, and records the commit they come from in data/spec-pin.json.
//   node v2/scripts/pin-spec.ts <path to a checkout of markup-carve/carve>
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const NEW_DATA = [
  'ast-results.json', 'ast-schema.json', 'extensions.json', 'includes.json', 'layout-schema.json', 'node-slots.json',
  'unicode-categories.json',
]
const SCHEMAS = ['carve-source.schema.json', 'carve-style.schema.json', 'carve-annotation.schema.json']
/** The directories of `spec/0.2` that are copied whole, each to the directory of the same name under `data/`. */
export const CORPUS_DIRECTORIES = ['conformance', 'trees']

function copyJson(from: string, to: string): number {
  mkdirSync(to, { recursive: true })
  const names = readdirSync(from).filter((name) => name.endsWith('.json'))
  for (const name of names) copyFileSync(join(from, name), join(to, name))
  return names.length
}

if (process.argv[1] === import.meta.filename) {
  const checkout = process.argv[2]
  if (checkout === undefined) throw new Error('usage: pin-spec.ts <path to a checkout of markup-carve/carve>')
  const spec = join(checkout, 'spec/0.2')
  const data = join(import.meta.dirname, '../data')
  let count = 0
  for (const directory of CORPUS_DIRECTORIES) count += copyJson(join(spec, directory), join(data, directory))
  // The generated tables in src/ are written from these copies; run the generate scripts after a copy changes.
  const copies = [...new Set([...readdirSync(data), ...NEW_DATA])]
    .filter((name) => name.endsWith('.json') && existsSync(join(spec, 'data', name)))
  for (const name of copies) copyFileSync(join(spec, 'data', name), join(data, name))
  mkdirSync(join(data, 'schemas'), { recursive: true })
  for (const name of SCHEMAS) copyFileSync(join(spec, 'data/schemas', name), join(data, 'schemas', name))
  const commit = execFileSync('git', ['-C', checkout, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  writeFileSync(join(data, 'spec-pin.json'), `${JSON.stringify({ repository: 'markup-carve/carve', commit }, null, 1)}\n`)
  console.log(`spec ${commit.slice(0, 8)}: ${count} corpus and tree files, ${copies.length + SCHEMAS.length} data files`)
}
