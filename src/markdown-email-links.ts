import type { Document, InlineNode, Text } from './ast.js'
import { ownedChildFields } from './owned-child-fields.js'
import { markdownBareLinks } from './markdown-gfm-autolinks.js'

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export function linkMarkdownEmailText(document: Document): boolean {
  const pending: unknown[] = [document]
  const seen = new Set<object>()
  let changed = false
  while (pending.length > 0) {
    const value = pending.pop()
    if (typeof value !== 'object' || value === null || seen.has(value)) continue
    seen.add(value)
    if (Array.isArray(value)) {
      const nodes: unknown[] = value
      const rewritten: unknown[] = []
      let rewrite = false
      for (let at = 0; at < nodes.length; at++) {
        const child = nodes[at]
        if (record(child) && (child['type'] === 'text' || child['type'] === 'escaped_text') && typeof child['value'] === 'string') {
          const original = child as unknown as Text
          let last = at
          const values = [original.value]
          if (!original.attrs) {
            while (last + 1 < nodes.length) {
              const next = nodes[last + 1]
              if (!record(next) || (next['type'] !== 'text' && next['type'] !== 'escaped_text') || typeof next['value'] !== 'string' || next['attrs'] !== undefined) break
              values.push(next['value'])
              last++
            }
          }
          const text: Text = { type: 'text', value: values.join(''), ...(original.attrs ? { attrs: original.attrs } : {}) }
          const links = markdownBareLinks(text.value, undefined, 'email')
          if (links.length > 0) {
            const parts: InlineNode[] = []
            let cursor = 0
            for (const link of links) {
              if (link.start > cursor) parts.push({ type: 'text', value: text.value.slice(cursor, link.start) })
              const label = text.value.slice(link.start, link.end)
              parts.push({ type: 'link', href: link.prefix + label, children: [{ type: 'text', value: label }] })
              cursor = link.end
            }
            if (cursor < text.value.length) parts.push({ type: 'text', value: text.value.slice(cursor) })
            if (text.attrs) rewritten.push({ type: 'span', attrs: text.attrs, children: parts })
            else for (const part of parts) rewritten.push(part)
            rewrite = changed = true
            at = last
            continue
          }
          for (; at <= last; at++) rewritten.push(nodes[at])
          at--
          continue
        }
        rewritten.push(child)
        pending.push(child)
      }
      if (rewrite) {
        nodes.length = 0
        for (const node of rewritten) nodes.push(node)
      }
    } else if (record(value)) {
      if (value['type'] === 'link' || value['type'] === 'image' || value['type'] === 'block_image') continue
      for (const field of ownedChildFields(value)) pending.push(value[field])
    }
  }
  return changed
}
