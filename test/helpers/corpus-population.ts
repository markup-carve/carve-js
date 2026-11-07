import { readFileSync, readdirSync } from 'node:fs'
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
  const inputs = new Set<string>()
  const edgeCases = readdirSync(resolve(examples, 'edge-cases')).map(name => `edge-cases/${name}`)
  for (const name of ['core.md', 'extensions.md', ...edgeCases]) {
    const source = readFileSync(resolve(examples, name), 'utf8')
    count += declaredPairCount(source)
    let compare: string | null = null
    let fence: string | null = null
    let modifiers = new Set<string>()
    let lines: string[] = []
    for (const line of source.split('\n')) {
      if (fence !== null) {
        if (line.startsWith(fence) && line.slice(fence.length).trim() === '') {
          let input = `${lines.join('\n')}\n`
          if (modifiers.has('no-final-newline')) input = input.slice(0, -1)
          if (modifiers.has('crlf')) input = input.replace(/\n/g, '\r\n')
          if (modifiers.has('cr')) input = input.replace(/\n/g, '\r')
          if (modifiers.has('bom')) input = `\ufeff${input}`
          if (modifiers.has('nul')) input = input.replace(/\u2400/g, '\u0000')
          inputs.add(input)
          fence = null
        } else {
          lines.push(line)
        }
        continue
      }
      const trimmed = line.trim()
      if (compare !== null && trimmed === compare) {
        compare = null
        continue
      }
      if (compare === null) {
        const opener: RegExpMatchArray | null = trimmed.match(/^(:{3,})\s+compare(?:\s+(.+))?$/)
        if (opener) {
          compare = opener[1]
          modifiers = new Set(opener[2]?.split(/\s+/) ?? [])
        }
        continue
      }
      const carveFence = line.match(/^(`{3,})carve\s*$/)
      if (carveFence) {
        fence = carveFence[1]
        lines = []
      }
    }
  }
  if (count === 0) throw new Error('no comparison pairs found in spec examples')
  // The spec emits one fixture per unique input, including byte modifiers.
  return inputs.size
}
