import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export function declaredPairCount(source: string): number {
  let marker: string | null = null
  let fence: string | null = null
  let carve = 0
  let html = 0
  let total = 0
  for (const line of source.split('\n')) {
    if (fence !== null) {
      if (line.startsWith(fence) && line.slice(fence.length).trim() === '') fence = null
      continue
    }
    const opening = line.match(/^(`{3,})([\s\S]*)$/)
    if (opening) {
      fence = opening[1]
      if (marker !== null) {
        if (opening[2].trim() === 'carve') carve++
        if (opening[2].trim() === 'html') html++
      }
      continue
    }
    const trimmed = line.trim()
    if (marker !== null) {
      if (trimmed === marker) {
        if (carve === 0 || carve !== html) throw new Error('unpaired or empty compare block')
        total += carve
        marker = null
      }
      continue
    }
    if (/^:{3,}\s+compare(?:\s+\S.*)?$/.test(trimmed)) {
      marker = trimmed.match(/^:{3,}/)![0]
      carve = html = 0
    }
  }
  if (marker !== null || fence !== null) throw new Error('unclosed compare block or fence')
  return total
}

export function expectedCorpusSize(specRoot: string): number {
  const examples = resolve(specRoot, 'resources/examples')
  let count = 0
  for (const name of ['core.md', 'extensions.md', 'edge-cases.md']) {
    count += declaredPairCount(readFileSync(resolve(examples, name), 'utf8'))
  }
  if (count === 0) throw new Error('no comparison pairs found in spec examples')
  return count
}
