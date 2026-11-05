const QUOTE_PREFIX = /^(?:[ \t]*>[ \t]?)*/
const MARKER = /^( *)([-*+]|\d+[.)]) /
const FENCE_LINE = /^[ \t]*(`{3,}|~{3,})(.*)$/

const indent = (body: string): number => body.length - body.replace(/^ +/, '').length
const blank = (body: string): boolean => body.trim() === ''

/**
 * Djot reads a blank line between an item's first block and its sub-list as no
 * separation, and Carve reads it as a loose item (carve#5015), so the blank goes.
 * A blank between sibling items, or below a later block, stays.
 */
export function glueSubListsToTheirItems(carve: string): string {
  const lines = carve.split('\n')
  const parts = lines.map((line): [number, string] => {
    const prefix = QUOTE_PREFIX.exec(line)![0]
    return [prefix.split('>').length - 1, line.slice(prefix.length)]
  })
  const inFence = new Array<boolean>(lines.length).fill(false)
  let fence: [string, number] | null = null
  parts.forEach(([, body], index) => {
    const run = FENCE_LINE.exec(body)
    if (fence) {
      inFence[index] = true
      if (run && run[1]![0] === fence[0] && run[1]!.length >= fence[1] && blank(run[2]!)) fence = null
      return
    }
    fence = run ? [run[1]![0]!, run[1]!.length] : null
  })
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
