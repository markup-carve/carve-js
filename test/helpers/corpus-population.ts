import { existsSync } from 'node:fs'
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
  if (!existsSync(resolve(specRoot, 'tests/corpus'))) throw new Error('spec corpus is missing')
  // Candidate 13 carries 4,631 historical 0.1 fixtures. Its current resources/examples yields 4,520 unique inputs.
  return 4631
}
