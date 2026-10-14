import { parse } from './parse.js'
import { inlineText, resolveHeadingIds } from './heading-ids.js'
import { forEachChildBlockList } from './block-children.js'
import type { BlockNode, Heading } from './ast.js'

export function importedDjotHeadingTargets(carve: string): ReadonlyMap<string, string> {
  const headings = (children: BlockNode[]): Heading[] => {
    const found: Heading[] = [], pending = [...children].reverse()
    while (pending.length) {
      const node = pending.pop()!
      if (node.type === 'heading') found.push(node)
      const lists: BlockNode[][] = []
      forEachChildBlockList(node, children => lists.push(children))
      for (let i = lists.length - 1; i >= 0; i--)
        for (let j = lists[i]!.length - 1; j >= 0; j--) pending.push(lists[i]![j]!)
    }
    return found
  }
  const decoded = carve.replaceAll('\0U\0', '\0')
  const actual = headings(resolveHeadingIds(parse(decoded)).children)
  const occupied = new Set(carve)
  for (const node of actual) for (const char of inlineText(node.children)) occupied.add(char)
  let marker: string | undefined
  for (const [first, last] of [[0xE000, 0xF8FF], [0xF0000, 0xFFFFD], [0x100000, 0x10FFFD]] as const) {
    for (let point = first; point <= last; point++) {
      const candidate = String.fromCodePoint(point)
      if (!occupied.has(candidate)) { marker = candidate; break }
    }
    if (marker !== undefined) break
  }
  if (marker === undefined) return new Map()
  const marked = headings(parse(carve.replaceAll('\0U\0', marker).replaceAll('\0', marker)).children)
  const result = new Map<string, string>()
  if (marked.length !== actual.length) return result
  for (let i = 0; i < marked.length; i++) {
    const key = inlineText(marked[i]!.children).replaceAll(marker, '\0').trim().replace(/[ \t\r\n]+/g, ' ')
    const id = actual[i]!.attrs?.id
    if (id !== undefined && !result.has(key)) result.set(key, '#' + id)
  }
  return result
}
