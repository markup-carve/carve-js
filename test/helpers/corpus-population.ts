import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export function expectedCorpusSize(specRoot: string): number {
  const examplesDir = resolve(specRoot, 'docs/examples')
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
