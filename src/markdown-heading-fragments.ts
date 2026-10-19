import { parse } from './parse.js'
import { renderCarve } from './render-carve.js'
import { resolveHeadingIds } from './heading-ids.js'
import { renderHtml } from './render-html.js'
import { parseFragment, type DefaultTreeAdapterTypes as Html } from 'parse5'

/** A case-only Markdown anchor may name a heading, but never an arbitrary HTML id. */
export function headingFragmentAliases(source: string): Map<string, string | null> {
  const aliases = new Map<string, string | null>()
  const document = resolveHeadingIds(parse(source))
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return
    const node = value as Record<string, unknown>
    if (node.type === 'heading') {
      const id = (node.attrs as { id?: string } | undefined)?.id
      if (id) {
        if (/-(?:[2-9]|[1-9]\d+)$/.test(id)) return
        const key = id.toLowerCase()
        aliases.set(key, aliases.has(key) && aliases.get(key) !== id ? null : id)
      }
    }
    for (const [key, child] of Object.entries(node)) {
      if (key === 'attrs' || key === 'position') continue
      if (Array.isArray(child)) child.forEach(visit)
      else if (child && typeof child === 'object') visit(child)
    }
  }
  visit(document)
  return aliases
}

export function matchingHeadingFragment(fragment: string, exact: ReadonlySet<string>, aliases: ReadonlyMap<string, string | null>): string | undefined {
  if (exact.has(fragment)) return fragment
  return aliases.get(fragment.toLowerCase()) ?? undefined
}

export function rewriteSameFileHeadingLinks(source: string, onLoss: (message: string) => void): string {
  if (!source.includes('](#')) return source
  const document = parse(source)
  const resolved = resolveHeadingIds(parse(source))
  const exact = new Set<string>()
  const pending: Html.ParentNode[] = [parseFragment(renderHtml(resolved))]
  for (let node = pending.pop(); node; node = pending.pop()) {
    for (const child of node.childNodes) {
      if (!('tagName' in child)) continue
      for (const attr of child.attrs) if (attr.name === 'id' || (attr.name === 'name' && child.tagName === 'a')) exact.add(attr.value)
      pending.push(child)
    }
  }
  const aliases = headingFragmentAliases(source)
  let changed = false
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return
    const node = value as Record<string, unknown>
    if (node.type === 'link' && !node.ref && typeof node.href === 'string' && node.href.startsWith('#')) {
      let fragment: string
      try { fragment = decodeURIComponent(node.href.slice(1)) } catch { fragment = '' }
      const match = fragment && matchingHeadingFragment(fragment, exact, aliases)
      if (match && match !== fragment) { node.href = `#${encodeURIComponent(match)}`; changed = true }
    }
    for (const [key, child] of Object.entries(node)) {
      if (key === 'attrs' || key === 'position') continue
      if (Array.isArray(child)) child.forEach(visit)
      else if (child && typeof child === 'object') visit(child)
    }
  }
  visit(document)
  if (!changed) return source
  const result = renderCarve(document, { onRenderLoss: loss => onLoss(loss.message) })
  return source.endsWith('\n') ? result : result.replace(/\n$/, '')
}
