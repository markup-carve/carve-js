import { readAttributes } from './djot-attributes.js'

export function isDjotEscaped(source: string, at: number): boolean {
  let start = at
  while (source[start - 1] === '\\') start--
  return (at - start) % 2 !== 0
}

export function djotContentStart(line: string): number {
    let at = 0
    while (at < line.length) {
      while (line[at] === ' ' || line[at] === '\t') at++
      if (line[at] === '>') { at++; continue }
      const marker = /^(?:\[\^[^\]\n]+\]:[ \t]*|(?:[-*+]|[0-9A-Za-z]+[.)]|\([0-9A-Za-z]+\)|:)[ \t]+)/.exec(line.slice(at))
      if (!marker) break
      at += marker[0].length
    }
    return at
  }

export function djotTableRows(source: string, mask: string): boolean[] {
  let offset = 0, previousRow = false, previousBlock = true, footnoteColumn = -1
  return source.split('\n').map(line => {
    const at = djotContentStart(line), end = line.trimEnd().length - 1, content = line.slice(at)
    const opensItem = /(?:[-*+]|[0-9A-Za-z]+[.)]|\([0-9A-Za-z]+\)|:)[ \t]+/.test(line.slice(0, at))
    const closesNote = footnoteColumn >= 0 && at < footnoteColumn
    if (closesNote) footnoteColumn = -1
    const allowed = previousBlock || previousRow || opensItem || closesNote
    const note = /^[ \t]*(?:>[ \t]*)*(?:(?:[-*+]|[0-9A-Za-z]+[.)]|\([0-9A-Za-z]+\))[ \t]+)*\[\^[^\]\n]+\]:/.exec(line)
    if (note && allowed) footnoteColumn = note[0].indexOf('[^') + 2
    const row: boolean = allowed && line[at] === '|' && mask[offset + at] === '|' && line[end] === '|' && mask[offset + end] === '|' && line[end - 1] !== '\\'
    previousBlock = content.trim() === '' || /^(?:#{1,6} |`{3,}|~{3,}|:{3,}|\{|\[[^\]]+\]:)/.test(content)
    previousRow = row
    offset += line.length + 1
    return row
  })
}


export function djotInlineBoundaries(source: string, mask: string): number[] {
  const boundaries: number[] = []
  const rows = djotTableRows(source, mask)
  const items: Array<{ column: number; depth: number }> = []
  let offset = 0, previousBlank = true, row = 0
  for (const line of source.split('\n')) {
    const prefix = /^(?:[ \t]*>(?:[ \t]|$))*/.exec(line)![0]
    const depth = (prefix.match(/>/g) ?? []).length
    const content = line.slice(prefix.length), trimmed = content.replace(/^[ \t]*/, ''), indent = content.length - trimmed.length
    const marker = /^(?:\[\^[^\]\n]+\]:[ \t]*|(?:[-*+]|(?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)[.)]|\((?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)\)|:)[ \t]+)/.exec(trimmed)
    const active = items.at(-1)
    const startsItem = marker && (previousBlank || (active && depth <= active.depth && indent < active.column))
    const blank = trimmed === '' || trimmed === '\r'
    if (previousBlank || startsItem) {
      boundaries.push(offset)
      if (!blank) {
        while (items.length) { const item = items.at(-1)!; if (depth > item.depth || (depth === item.depth && indent >= item.column)) break; items.pop() }
        if (startsItem) items.push({ column: indent + (marker[0].startsWith('[^') ? 2 : marker[0].length), depth })
      }
    }
    if (rows[row]) for (let at = 0; at < line.length; at++) if (line[at] === '|' && mask[offset + at] === '|' && line[at - 1] !== '\\') boundaries.push(offset + at)
    previousBlank = blank
    row++; offset += line.length + 1
  }
  return boundaries
}

export function djotSimpleDestinationRanges(source: string): Map<number, number> | undefined {
  const ranges = new Map<number, number>()
  if (!source.includes('](')) return ranges
  if (source.includes('\\') || source.includes('`') || source.includes('][')) return undefined
  let found = 0
  for (const match of source.matchAll(/\[[^\[\]\n]*\]\([^()\n]*\)/g)) {
    const target = match[0].indexOf('](') + 1
    if (match[0][1] === '^' || match[0].includes('|') || /[{<"]/.test(match[0].slice(target + 1, -1))) return undefined
    ranges.set(match.index! + target, match.index! + match[0].length)
    found++
  }
  let expected = 0
  for (let at = source.indexOf(']('); at !== -1; at = source.indexOf('](', at + 2)) expected++
  return found === expected ? ranges : undefined
}

export function djotDestinationRanges(source: string, mask: string): Map<number, number> {
  const ranges = new Map<number, number>()
  if (!source.includes('](')) return ranges
  const boundaries = djotInlineBoundaries(source, mask)
  const nextBracket = new Map<number, number>()
  let close = -1
  for (let at = source.length - 1; at >= 0; at--) {
    if (source[at] === '\n') close = -1
    else if (source[at] === ']' && !isDjotEscaped(source, at)) close = at
    if (at >= 2 && source[at - 1] === '[' && source[at - 2] === ']') nextBracket.set(at, close)
  }
  const angles = new Map(Array.from(source.matchAll(/<[^<>\s]+>/g), match => [match.index!, /[^:]@|[A-Za-z]:/.test(match[0]) ? match.index! + match[0].length : -1]))
  const tableCode = new Set<number>()
  let lineOffset = 0
  for (const line of source.split('\n')) {
    if (/^[ \t]*(?:>[ \t]*)*(?:(?:[-*+]|[0-9A-Za-z]+[.)])[ \t]+)?\|/.test(line)) for (const run of line.matchAll(/`+/g)) tableCode.add(lineOffset + run.index!)
    lineOffset += line.length + 1
  }
  const labels: Array<{ at: number; slot: number; target?: number; parens: number }> = []
  let owner: typeof labels[number] | undefined, boundary = 0
  for (let at = 0; at < source.length; at++) {
    while ((boundaries[boundary] ?? source.length) <= at) { labels.length = 0; owner = undefined; boundary++ }
    if (owner && tableCode.has(at)) owner = undefined
    if (mask[at] !== source[at]) continue
    if (source[at] === '\\' && /[!-\/:-@\[-`{-~]/.test(source[at + 1] ?? '')) { at++; continue }
    const angle = angles.get(at)
    if (angle !== undefined && angle > at) { at = angle - 1; continue }
    if (source[at] === '{') { const attrs = readAttributes(source, at); if (attrs) { at = attrs.end - 1; continue } }
    if (source[at] === '[') { labels.push({ at, slot: labels.length, parens: 0 }); continue }
    const tip = labels.at(-1)
    if (!tip) continue
    if (source[at] === ']') {
      if (source[tip.at + 1] === '^') { labels.pop(); if (tip === owner) owner = undefined; continue }
      if (source[at + 1] === '[') {
        const end = nextBracket.get(at + 2) ?? -1
        if (end >= 0) { labels.pop(); if (tip === owner) owner = undefined; at = end }
        continue
      }
      if (source[at + 1] === '{' && readAttributes(source, at + 1)) { labels.pop(); if (tip === owner) owner = undefined; continue }
      if (source[at + 1] === '(') { tip.target = at + 1; tip.parens = 0; owner = tip; at++; continue }
    }
    if (!owner) continue
    if (source[at] === '(') owner.parens++
    else if (source[at] === ')') {
      if (owner.parens) { owner.parens--; continue }
      ranges.set(owner.target!, at + 1)
      labels.length = owner.slot
      owner = undefined
    }
  }
  return ranges
}
