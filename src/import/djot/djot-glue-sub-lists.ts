const QUOTE_PREFIX = /^(?:[ \t]*>[ \t]?)*/
const MARKER = /^( *)([-*+]|\(?(?:\d+|[a-zA-Z]|[ivxlcdmIVXLCDM]+)[.)]) /
const FENCE_LINE = /^[ \t]*(`{3,}|~{3,})(.*)$/

const indent = (body: string): number => body.length - body.replace(/^ +/, '').length
const blank = (body: string): boolean => body.trim() === ''

/**
 * Djot reads a blank line between an item's first block and its sub-list as no
 * separation, and Carve reads it as a loose item (carve#5015), so the blank goes.
 * A blank between sibling items, or below a later block, stays.
 */
export function glueSubListsToTheirItems(carve: string): string {
  return glueSubListsToTheirLeads(carve)
}

function layout(carve: string): { lines: string[], parts: [number, string][], inFence: boolean[] } {
  const lines = carve.split('\n')
  const parts = lines.map((line): [number, string] => {
    const prefix = QUOTE_PREFIX.exec(line)![0]
    return [prefix.split('>').length - 1, line.slice(prefix.length)]
  })
  const inFence = new Array<boolean>(lines.length).fill(false)
  let fence: [string, number, number] | null = null
  parts.forEach(([depth, body], index) => {
    const run = FENCE_LINE.exec(body)
    // A fence ends with the quote that holds it.
    if (fence && depth < fence[2]) fence = null
    if (fence) {
      inFence[index] = true
      if (run && run[1]![0] === fence[0] && run[1]!.length >= fence[1] && blank(run[2]!)) fence = null
      return
    }
    fence = run ? [run[1]![0]!, run[1]!.length, depth] : null
  })
  return { lines, parts, inFence }
}

function glueSubListsToTheirLeads(carve: string): string {
  const { lines, parts, inFence } = layout(carve)
  const drop = new Array<boolean>(lines.length).fill(false)
  for (let index = 1; index < lines.length - 1; index++) {
    const [depth, body] = parts[index]!
    if (inFence[index] || !blank(body)) continue
    const [aboveDepth, above] = parts[index - 1]!
    if (aboveDepth !== depth || blank(above) || inFence[index - 1]) continue
    let last = index
    while (last + 1 < parts.length && parts[last + 1]![0] === depth && blank(parts[last + 1]![1])) last++
    if (last + 1 >= parts.length) continue
    let [belowDepth, below] = parts[last + 1]!
    if (belowDepth !== depth || inFence[last + 1]) continue
    // An attribute line travels with the list it heads.
    if (below.trimStart().startsWith('{') && below.trimEnd().endsWith('}')) {
      const next = parts[last + 2]
      if (!next || next[0] !== depth || indent(next[1]) !== indent(below)) continue
      below = next[1]
    }
    const column = indent(below)
    if (column === 0 || !MARKER.test(below)) continue
    let owner: string | null = null
    for (let at = index - 1; at >= 0; at--) {
      const [lineDepth, line] = parts[at]!
      // Only the item's first block, unbroken, is glued to the sub-list.
      if (lineDepth < depth || lineDepth === depth && blank(line)) break
      if (lineDepth !== depth || inFence[at]) continue
      const lineIndent = indent(line)
      if (lineIndent > column) continue
      if (lineIndent === column) {
        if (MARKER.test(line)) break
        continue
      }
      owner = line
      break
    }
    if (owner === null) continue
    const content = MARKER.exec(owner)?.[0].length
    if (content !== undefined && content <= column && !separatedFromASibling(parts, inFence, last, indent(owner))) {
      drop.fill(true, index, last + 1)
    }
  }
  if (!drop.includes(true)) return carve
  return lines.filter((_, index) => !drop[index]).join('\n')
}

// A list a blank already loosens between two items needs no glue.
function separatedFromASibling(parts: [number, string][], inFence: boolean[], blankLine: number, column: number): boolean {
  const depth = parts[blankLine]![0]
  let afterBlank = false
  for (let at = blankLine + 1; at < parts.length; at++) {
    const [lineDepth, line] = parts[at]!
    if (lineDepth < depth) return false
    if (lineDepth > depth || inFence[at]) {
      afterBlank = false
      continue
    }
    if (blank(line)) {
      afterBlank = true
      continue
    }
    const lineIndent = indent(line)
    if (lineIndent < column) return false
    if (lineIndent === column) {
      if (!MARKER.test(line)) return false
      if (afterBlank) return true
    }
    afterBlank = false
  }
  return false
}

// A blank line just above the item that a sibling item stands above loosens the list anyway.
function looseBefore(parts: [number, string][], owner: number, ownerIndent: number): boolean {
  const depth = parts[owner]![0]
  if (owner === 0 || !blank(parts[owner - 1]![1])) return false
  for (let at = owner - 2; at >= 0; at--) {
    const [lineDepth, line] = parts[at]!
    if (lineDepth < depth) return false
    if (lineDepth > depth || blank(line)) continue
    return indent(line) >= ownerIndent
  }
  return false
}

const QUOTE_LEVEL = /^[ \t]*>[ \t]?/

function stripQuotes(line: string, depth: number): [string, string] | null {
  let rest = line
  for (let level = 0; level < depth; level++) {
    const quote = QUOTE_LEVEL.exec(rest)
    if (!quote) return null
    rest = rest.slice(quote[0].length)
  }
  return [line.slice(0, line.length - rest.length), rest]
}

const markerKind = (marker: string): string => marker.replace(/\d+/, '1').replace(/[a-z]+/, 'a').replace(/[A-Z]+/, 'A')
const DIV_FENCE = /^ *(:{3,})[ \t]*(\S?)/

interface SubListBlank { first: number; last: number; below: number; end: number }

/**
 * djot.js charges a blank read while an item's sub-list is open to the sub-list,
 * so a block after it keeps the outer item tight (carve#5197). Carve would read
 * the blank as loosening the item, so it goes; a block that would then fold into
 * the sub-list's paragraph comes back behind a `+` at the marker column.
 */
export function dropBlanksAfterSubLists(carve: string, probe: (source: string) => number | null): string {
  const { lines, parts, inFence } = layout(carve)
  const depths = parts.map(([depth]) => depth)
  const replaced = new Map<number, string | null>()
  const probes = new Map<string, number | null>()
  const cached = (source: string): number | null => {
    if (!probes.has(source)) probes.set(source, probe(source))
    return probes.get(source)!
  }
  for (let owner = 0; owner < lines.length; owner++) {
    if (inFence[owner]) continue
    const depth = depths[owner]!
    const ownerBody = stripQuotes(lines[owner]!, depth)![1]
    const ownerMarker = MARKER.exec(ownerBody)
    if (!ownerMarker) continue
    const blanks = subListBlanks(lines, inFence, owner, depth, ownerMarker[0].length)
    if (!blanks?.length || looseBefore(parts, owner, ownerMarker[1]!.length) ||
      separatedFromASibling(parts, inFence, blanks.at(-1)!.last, ownerMarker[1]!.length)) continue
    for (const run of blanks) {
      if ([...Array(run.end - run.first).keys()].some(offset => replaced.has(run.first + offset))) continue
      edit(lines, run, depth, ownerMarker[1]!.length, ownerMarker[0].length, cached, replaced)
    }
  }
  if (replaced.size === 0) return carve
  return lines.flatMap((line, index) => {
    const value = replaced.has(index) ? replaced.get(index)! : line
    return value === null ? [] : [value]
  }).join('\n')
}

// The item's blank runs that djot.js charges to an open sub-list, or null when
// another blank at the item's level loosens it anyway.
function subListBlanks(lines: string[], inFence: boolean[], owner: number, depth: number, column: number): SubListBlank[] | null {
  const runs: SubListBlank[] = []
  let nested: { content: number; kind: string } | null = null
  let pending: number | null = null
  let previousBlank = false
  // djot.js emits a blank line for a div's closing fence, so a line directly after one can loosen the list.
  let openDivs = 0
  let divClosed = false
  for (let at = owner + 1; at < lines.length; at++) {
    const split = stripQuotes(lines[at]!, depth)
    if (split === null) break
    const body = split[1]
    if (inFence[at]) {
      pending = null
      previousBlank = false
      continue
    }
    if (blank(body)) {
      pending ??= at
      previousBlank = true
      divClosed = false
      continue
    }
    const wasBlank = previousBlank
    previousBlank = false
    const lineIndent = indent(body)
    const marker = MARKER.exec(body)
    if (lineIndent < column) {
      if (divClosed || !marker && !wasBlank) return null
      break
    }
    // A new list takes the div's blank line; any other line is loosened by it.
    if (divClosed && !marker) return null
    divClosed = false
    const div = DIV_FENCE.exec(body)
    if (div && lineIndent === column) {
      if (div[2] === '' && openDivs > 0) divClosed = --openDivs === 0
      else openDivs++
    }
    if (body.trim() === '+') return null
    if (nested && lineIndent >= nested.content) {
      pending = null
      continue
    }
    if (marker) {
      const kind = markerKind(marker[2]!)
      if (pending !== null) {
        if (!nested) return null
        if (kind !== nested.kind) runs.push({ first: pending, last: at - 1, below: at, end: at })
      }
      nested = { content: marker[0].length, kind }
      pending = null
      continue
    }
    if (lineIndent !== column) return null
    if (pending !== null) {
      if (!nested) return null
      // A comment stands where the importer hoisted a definition and its blanks; keep the blank.
      if (!body.trimStart().startsWith('%%')) runs.push({ first: pending, last: at - 1, below: at, end: at })
    }
    nested = null
    pending = null
  }
  for (const run of runs) {
    let end = run.below + 1
    for (; end < lines.length; end++) {
      if (inFence[end]) continue
      const split = stripQuotes(lines[end]!, depth)
      if (split === null || blank(split[1]) || indent(split[1]) < column) break
    }
    run.end = end
  }
  return runs
}

// The probe returns the child count of the single item `- x` holds, or null when
// the source is not that one item, so Carve's own rules decide the fold.
function edit(lines: string[], run: SubListBlank, depth: number, markerColumn: number, column: number,
  probe: (source: string) => number | null, replaced: Map<number, string | null>): void {
  const block = lines.slice(run.below, run.end).map(line => stripQuotes(line, depth)!)
  const shifted = block.map(([, body]) => '  ' + body.slice(Math.min(column, indent(body)))).join('\n')
  const blocks = probe(`- x\n\n${shifted}\n`)
  if (blocks === null) return
  const children = 1 + blocks
  if (probe(`- x\n  - y\n${shifted}\n`) === children) {
    for (let at = run.first; at <= run.last; at++) replaced.set(at, null)
    return
  }
  // Only the first line moves to the marker column; the rest stay where they are.
  const [first, ...rest] = shifted.split('\n')
  if (probe(`- x\n  - y\n+\n${[first!.slice(2), ...rest].join('\n')}\n`) !== children) return
  const [quote, body] = block[0]!
  replaced.set(run.first, `${quote}${' '.repeat(markerColumn)}+`)
  for (let at = run.first + 1; at <= run.last; at++) replaced.set(at, null)
  replaced.set(run.below, quote + ' '.repeat(markerColumn) + body.slice(Math.min(column, indent(body))))
}
