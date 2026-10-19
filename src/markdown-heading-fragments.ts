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

export interface FragmentFixup { destination: string; from: string; to: string }

export function fragmentFixupDiagnostic(fixup: FragmentFixup): { code: string; message: string; severity: 'info'; fidelity: 'normalized'; confidence: 'inferred'; path: string } {
  return {
    code: 'link-fragment-case-rewritten',
    message: `Rewrote link fragment #${fixup.from} to #${fixup.to}, the one heading id it matches without regard to case.`,
    severity: 'info',
    fidelity: 'normalized',
    confidence: 'inferred',
    path: `link:${fixup.destination}`,
  }
}

/** `unfixed` is the same rendering with the original fragments, so assessment sees only the conversion. */
/** `authored` maps a converted destination back to the one the Markdown link wrote (CARVE-P2-031). */
export function rewriteSameFileHeadingLinks(
  source: string,
  onLoss: (message: string) => void,
  authored: ReadonlyMap<string, string> = new Map(),
): { value: string; unfixed: string; fixups: FragmentFixup[] } {
  const fixups: FragmentFixup[] = []
  if (!source.includes('](#')) return { value: source, unfixed: source, fixups }
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
  const rewritten: Array<[Record<string, unknown>, string]> = []
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return
    const node = value as Record<string, unknown>
    if (node.type === 'link' && !node.ref && typeof node.href === 'string' && node.href.startsWith('#')) {
      let fragment: string
      try { fragment = decodeURIComponent(node.href.slice(1)) } catch { fragment = '' }
      const match = fragment && matchingHeadingFragment(fragment, exact, aliases)
      if (match && match !== fragment) {
        const destination = node.href
        const written = authored.get(destination) ?? destination
        const to = encodeURIComponent(match)
        node.href = `#${to}`
        rewritten.push([node, destination])
        fixups.push({ destination: written, from: written.slice(1), to })
      }
    }
    for (const [key, child] of Object.entries(node)) {
      if (key === 'attrs' || key === 'position') continue
      if (Array.isArray(child)) child.forEach(visit)
      else if (child && typeof child === 'object') visit(child)
    }
  }
  visit(document)
  if (rewritten.length === 0) return { value: source, unfixed: source, fixups }
  const trim = (result: string): string => source.endsWith('\n') ? result : result.replace(/\n$/, '')
  const value = trim(renderCarve(document, { onRenderLoss: loss => onLoss(loss.message) }))
  for (const [node, destination] of rewritten) node.href = destination
  return { value, unfixed: trim(renderCarve(document)), fixups }
}
