import type { Document, InlineNode, Text } from '../../ast.js'
import { renderInlinesInLinkContext } from '../../render-html.js'
import { ownedChildFields } from '../../ast/owned-child-fields.js'
import { markdownBareLinks } from './markdown-gfm-autolinks.js'

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export function linkMarkdownEmailText(document: Document, boundaryKey?: string): boolean {
  const pending: unknown[] = [document, ...Object.values(document.footnoteDefs ?? {})]
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
        if (record(child) && (child['type'] === 'text' || child['type'] === 'escaped_text' || child['type'] === 'smart_punctuation') && typeof child['value'] === 'string') {
          const original = child as unknown as Text
          let last = at
          const values = [original.value]
          if (!original.attrs) {
            while (last + 1 < nodes.length) {
              const next = nodes[last + 1]
              if (!record(next) || (next['type'] !== 'text' && next['type'] !== 'escaped_text' && next['type'] !== 'smart_punctuation') || typeof next['value'] !== 'string' || next['attrs'] !== undefined) break
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
      const attrs = record(value['attrs']) ? value['attrs'] : undefined
      const keys = attrs && record(attrs['keyValues']) ? attrs['keyValues'] : undefined
      if (boundaryKey !== undefined && value['type'] === 'span' && keys?.[boundaryKey] !== undefined) continue
      if (value['type'] === 'link' || value['type'] === 'image' || value['type'] === 'block_image') continue
      for (const field of ownedChildFields(value)) pending.push(value[field])
    }
  }
  if (boundaryKey !== undefined) {
    const cleanup: unknown[] = [document, ...Object.values(document.footnoteDefs ?? {})]
    const cleaned = new Set<object>()
    const arrays: unknown[][] = []
    while (cleanup.length > 0) {
      const value = cleanup.pop()
      if (typeof value !== 'object' || value === null || cleaned.has(value)) continue
      cleaned.add(value)
      if (Array.isArray(value)) {
        arrays.push(value as unknown[])
        const remaining: unknown[] = (value as unknown[]).slice().reverse()
        const rewritten: unknown[] = []
        let rewrite = false
        while (remaining.length > 0) {
          const child = remaining.pop()
          const attrs = record(child) && record(child['attrs']) ? child['attrs'] : undefined
          const keys = attrs && record(attrs['keyValues']) ? attrs['keyValues'] : undefined
          const boundary = keys?.[boundaryKey]
          if (record(child) && child['type'] === 'span' && (boundary === 'label' || boundary === 'empty') && Array.isArray(child['children'])) {
            rewrite = changed = true
            if (keys) delete keys[boundaryKey]
            if (attrs && Array.isArray(attrs['order'])) attrs['order'] = attrs['order'].filter(slot => slot !== boundaryKey)
            const authored = attrs && (attrs['id'] !== undefined
              || Array.isArray(attrs['classes']) && attrs['classes'].length > 0
              || keys && Object.keys(keys).length > 0)
            if (authored) {
              if (boundary === 'empty') child['children'] = []
              rewritten.push(child)
              cleanup.push(child)
            } else if (boundary === 'label') {
              for (let i = child['children'].length - 1; i >= 0; i--) remaining.push(child['children'][i])
            }
          } else if (record(child) && child['type'] === 'raw_inline' && child['format'] === 'html' && child['content'] === `<!--${boundaryKey}-->`) {
            rewrite = changed = true
          } else {
            rewritten.push(child)
            cleanup.push(child)
          }
        }
        if (rewrite) {
          value.length = 0
          for (const child of rewritten) value.push(child)
        }
      } else if (record(value)) {
        const attrs = record(value['attrs']) ? value['attrs'] : undefined
        const keys = attrs && record(attrs['keyValues']) ? attrs['keyValues'] : undefined
        if (keys?.[boundaryKey] !== undefined || value['type'] === 'raw_inline' && value['format'] === 'html' && value['content'] === `<!--${boundaryKey}-->`) {
          throw new Error('Markdown import could not remove its internal empty-destination boundary')
        }
        for (const field of ownedChildFields(value)) cleanup.push(value[field])
      }
    }
    for (let at = arrays.length - 1; at >= 0; at--) {
      const nodes = arrays[at]!
      for (let i = 0; i < nodes.length; i++) {
        const child = nodes[i]
        if (record(child) && ['emphasis', 'strong', 'strike', 'underline', 'highlight', 'superscript', 'subscript', 'insert', 'delete'].includes(String(child['type'])) && Array.isArray(child['children']) && child['children'].length === 0) {
          const node = child as unknown as InlineNode
          const marked = node.type === 'delete'
            ? { ...node, attrs: { ...node.attrs, classes: ['critic-delete', ...(node.attrs?.classes ?? [])] } }
            : node
          const html = renderInlinesInLinkContext([marked], {})
          const content = node.type === 'strike' ? html.replace(/^<s(?=[ >])/, '<del').replace(/<\/s>$/, '</del>') : html
          nodes[i] = { type: 'raw_inline', format: 'html', content }
          changed = true
        }
      }
    }
  }
  return changed
}
