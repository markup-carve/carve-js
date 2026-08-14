import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/*
 * `docs/examples/` is generated output as of markup-carve/carve#1194; the
 * authored examples the corpus is derived from live in `resources/examples/`
 * and the generated pages are no longer committed. Counting the generated
 * copies would have made this guard depend on whether a docs build had run.
 */
export function expectedCorpusSize(specRoot: string): number {
  const examplesDir = resolve(specRoot, 'resources/examples')
  const files = readdirSync(examplesDir).filter((name) => name.endsWith('.md'))
  if (files.length === 0) throw new Error(`no spec examples found at ${examplesDir}`)
  let count = 0
  for (const name of files) {
    for (const line of readFileSync(resolve(examplesDir, name), 'utf8').split('\n')) {
      if (/^:{3,}\s+compare(?:\s+\S.*)?$/.test(line.trim())) count++
    }
  }
  if (count === 0) throw new Error('no ::: compare blocks found in spec examples')
  return count
}
