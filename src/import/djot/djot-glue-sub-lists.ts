const QUOTE_PREFIX = /^(?:[ \t]*>[ \t]?)*/
const MARKER = /^( *)([-*+]|\d+[.)]) /
const FENCE_LINE = /^[ \t]*(`{3,}|~{3,})(.*)$/
// A list marker, including one with its attributes glued on (`-{.a} x`).
const ANY_MARKER = /^ *(?:[-*+]|\d+[.)])(?: |\{)/
// A block that ends a nested item without a blank line before it.
const INTERRUPTS = /^ *(?:>|#{1,6}(?: |$)|`{3,}|~{3,}|:::|\|.*\| *$|\{.*\} *$|%%|(?:\* *){3,}$|(?:- *){3,}$)/

const indent = (body: string): number => body.length - body.replace(/^ +/, '').length
const blank = (body: string): boolean => body.trim() === ''

/**
 * Djot reads a blank line between an item's first block and its sub-list as no
 * separation, and Carve reads it as a loose item (carve#5015), so the blank goes.
 * A blank between sibling items, or below a later block, stays.
 */
export function glueSubListsToTheirItems(carve: string): string {
  return glueBlocksAfterSubLists(glueSubListsToTheirLeads(carve))
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

/**
 * djot.js charges a blank line read while a nested list is open to that list,
 * so a later block of the outer item keeps the item tight; Carve reads the
 * blank as loosening it (carve#5197). The blank goes, and a paragraph that
 * would then fold into the nested item is attached with a `+` instead.
 */
function glueBlocksAfterSubLists(carve: string): string {
  const { lines, parts, inFence } = layout(carve)
  const replace = new Map<number, string | null>()
  for (let index = 1; index < parts.length - 1; index++) {
    const [depth, body] = parts[index]!
    if (inFence[index] || !blank(body) || replace.has(index)) continue
    const [aboveDepth, above] = parts[index - 1]!
    if (aboveDepth !== depth || blank(above) || inFence[index - 1]) continue
    let last = index
    while (last + 1 < parts.length && parts[last + 1]![0] === depth && blank(parts[last + 1]![1])) last++
    if (last + 1 >= parts.length) continue
    const belowDepth = parts[last + 1]![0]
    // An indented quote marker reads as a deeper prefix here; it is the block that follows.
    const below = belowDepth > depth ? bodyAtDepth(lines[last + 1]!, depth) : parts[last + 1]![1]
    const column = indent(below)
    if (belowDepth < depth || inFence[last + 1] || column === 0 || ANY_MARKER.test(below)) continue
    if (belowDepth > depth && !below.trimStart().startsWith('>')) continue
    const owner = outerItemOf(parts, inFence, index, column)
    if (owner === null) continue
    const ownerIndent = indent(parts[owner]![1])
    if (looseBefore(parts, owner, ownerIndent) || separatedFromASibling(parts, inFence, last, ownerIndent) ||
        looseAfter(parts, inFence, last + 1, column)) continue
    for (let at = index; at <= last; at++) replace.set(at, null)
    if (INTERRUPTS.test(below)) continue
    const prefix = lines[last + 1]!.slice(0, lines[last + 1]!.length - below.length)
    replace.set(last, prefix + ' '.repeat(ownerIndent) + '+')
    replace.set(last + 1, prefix + ' '.repeat(ownerIndent) + below.slice(column))
  }
  if (replace.size === 0) return carve
  return lines.flatMap((line, at) => {
    if (!replace.has(at)) return [line]
    const value = replace.get(at)!
    return value === null ? [] : [value]
  }).join('\n')
}

function bodyAtDepth(line: string, depth: number): string {
  for (let level = 0; level < depth; level++) line = line.replace(/^[ \t]*>[ \t]?/, '')
  return line
}

// The item whose content column is `column`, when the blank at `blankLine` falls inside its
// nested list: the last line at or left of that column is a nested marker, and nothing but
// the nested list and the item's unbroken lead stands between the item and the blank.
function outerItemOf(parts: [number, string][], inFence: boolean[], blankLine: number, column: number): number | null {
  const depth = parts[blankLine]![0]
  let nested = false
  let blankSeen = false
  for (let at = blankLine - 1; at >= 0; at--) {
    const [lineDepth, line] = parts[at]!
    if (lineDepth < depth) return null
    if (lineDepth > depth || inFence[at]) continue
    if (blank(line)) {
      blankSeen = true
      continue
    }
    const lineIndent = indent(line)
    if (lineIndent > column) continue
    if (lineIndent === column) {
      if (MARKER.test(line)) {
        nested = true
        blankSeen = false
        continue
      }
      // A block of the item itself: the blank below it would belong to the item.
      if (!nested || blankSeen) return null
      continue
    }
    const content = MARKER.exec(line)?.[0].length
    return nested && !blankSeen && content === column ? at : null
  }
  return null
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

// A later blank inside the item is left alone, and so is the item.
function looseAfter(parts: [number, string][], inFence: boolean[], from: number, column: number): boolean {
  const depth = parts[from]![0]
  for (let at = from; at < parts.length; at++) {
    const [lineDepth, line] = parts[at]!
    if (lineDepth < depth) return false
    if (lineDepth > depth || inFence[at]) continue
    if (!blank(line)) {
      if (indent(line) < column) return false
      continue
    }
    let next = at + 1
    while (next < parts.length && (parts[next]![0] !== depth || blank(parts[next]![1]))) next++
    if (next < parts.length && indent(parts[next]![1]) >= column) return true
  }
  return false
}
