import type { Document, InlineNode } from './ast.js'
import { visitDocumentIds } from './document-ids.js'
import { resolveHeadingIds } from './heading-ids.js'
import { forEachCrossrefRun, parse } from './parse.js'

export function convertedIds(source: string): Set<string> {
  const ids = new Set<string>()
  visitDocumentIds(resolveHeadingIds(parse(source)), id => { ids.add(id) })
  return ids
}

export function protectUnresolvedCrossrefs(text: string, ids: ReadonlySet<string>, protect: (run: string) => string): string {
  const pieces: string[] = []
  let cursor = 0
  forEachCrossrefRun(text, (start, end, id) => {
    if (ids.has(id) || (start > 0 && text[start - 1] === '\\')) return
    pieces.push(text.slice(cursor, start), protect(text.slice(start, end)))
    cursor = end
  })
  if (cursor === 0) return text
  pieces.push(text.slice(cursor))
  return pieces.join('')
}

export function preserveHtmlTextCrossrefs(doc: Document, ids: ReadonlySet<string>): void {
  const seen = new WeakSet<object>()
  const walk = (value: unknown): void => {
    if (!value || typeof value !== 'object' || seen.has(value)) return
    seen.add(value)
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index++) {
        const node = value[index] as InlineNode
        if (node?.type !== 'text') { walk(node); continue }
        const parts: InlineNode[] = []
        let cursor = 0
        forEachCrossrefRun(node.value, (start, end, id) => {
          if (ids.has(id) || (start > 0 && node.value[start - 1] === '\\')) return
          if (start > cursor) parts.push({ type: 'text', value: node.value.slice(cursor, start) })
          parts.push({ type: 'heading_ref', target: id })
          cursor = end
        })
        if (cursor === 0) continue
        if (cursor < node.value.length) parts.push({ type: 'text', value: node.value.slice(cursor) })
        value.splice(index, 1, ...parts)
        index += parts.length - 1
      }
      return
    }
    for (const child of Object.values(value)) walk(child)
  }
  walk(doc)
}
