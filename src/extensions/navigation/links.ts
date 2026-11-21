import { type AutolinkNode, type DocumentNode, type Inline, type LinkNode, type Node } from '../../ast.ts'
import { type ExtensionDefinition } from '../types.ts'
import { pairOf, removePair, rewriteTree, setPair } from './common.ts'

/** The renderer writes no attributes on an autolink, so a transform that sets one turns it into the link it renders as. */
function asLink(node: AutolinkNode): LinkNode {
  const link: LinkNode = { type: 'link', href: node.href, children: [{ type: 'text', value: node.text ?? node.href }] }
  if (node.attrs !== undefined) link.attrs = node.attrs
  if (node.pos !== undefined) link.pos = node.pos
  return link
}

function addRel(node: Node, values: readonly string[]): void {
  const parts = (pairOf(node, 'rel') ?? '').split(/\s+/u).filter((part) => part !== '')
  for (const value of values) if (!parts.includes(value)) parts.push(value)
  setPair(node, 'rel', parts.join(' '))
}

/** Options of {@link externalLinks}. */
export interface ExternalLinksOptions {
  /** `target` of an external link; `''` removes it. Default `'_blank'`. */
  target?: string
  /** `rel` of an external link. Default `'noopener noreferrer'`. */
  rel?: string
  /** Adds `nofollow` to `rel`. Default false. */
  nofollow?: boolean
}

const EXTERNAL = /^https?:\/\//iu

/** Sets `target` and `rel` on each link and autolink to an `http` or `https` URL. */
export function externalLinks(options: ExternalLinksOptions = {}): ExtensionDefinition {
  const target = options.target ?? '_blank'
  const rel = (options.rel ?? 'noopener noreferrer').split(/\s+/u).filter((part) => part !== '')
  if (options.nofollow === true && !rel.includes('nofollow')) rel.push('nofollow')
  return {
    name: 'carve.externalLinks', version: '1', props: {}, slots: {},
    documentTransform(view: DocumentNode): DocumentNode {
      rewriteTree(view, (node) => {
        if ((node.type !== 'link' && node.type !== 'autolink') || node.href === undefined || !EXTERNAL.test(node.href)) return undefined
        const link = node.type === 'autolink' ? asLink(node) : node
        if (target === '') removePair(link, 'target')
        else setPair(link, 'target', target)
        setPair(link, 'rel', rel.join(' '))
        return node === link ? undefined : [link]
      }, true)
      return view
    },
  }
}

/** Options of {@link linkPolicy}. */
export interface LinkPolicyOptions {
  /** Schemes a link may use; `null` allows every scheme that is not denied. Default `null`. */
  allowedSchemes?: string[] | null
  /** Schemes a link may not use. Default `javascript`, `vbscript`, `data` and `file`. */
  deniedSchemes?: string[]
  /** Hosts an `http` or `https` link may point to, with their subdomains; `null` allows all. Default `null`. */
  allowedDomains?: string[] | null
  /** Hosts, with their subdomains, a link may not point to. Default none. */
  deniedDomains?: string[]
  /** Allows links to other hosts than `baseHost`. Default true. */
  allowExternal?: boolean
  /** Allows fragments and relative URLs. Default true. */
  allowInternal?: boolean
  /** Values added to the `rel` of each link that stays, for example `['nofollow', 'ugc']`. Default none. */
  rel?: string[]
  /** The host of the document, which decides what is internal. Default none: every host is external. */
  baseHost?: string
}

const PROBE_STRIP = /[\u0000-\u0008\u000e-\u001f\u007f-\u009f\s]+/gu

function normalizeHost(host: string): string {
  return host.replace(/[\u3002\uFF0E\uFF61]/gu, '.').toLowerCase().replace(/\.+$/u, '')
}

function percentDecode(text: string): string {
  if (!text.includes('%')) return text
  const encoder = new TextEncoder()
  const bytes: number[] = []
  for (let at = 0; at < text.length;) {
    if (text[at] === '%' && /^[0-9a-fA-F]{2}$/u.test(text.slice(at + 1, at + 3))) {
      bytes.push(Number.parseInt(text.slice(at + 1, at + 3), 16))
      at += 3
      continue
    }
    const char = String.fromCodePoint(text.codePointAt(at)!)
    bytes.push(...encoder.encode(char))
    at += char.length
  }
  return new TextDecoder().decode(new Uint8Array(bytes))
}

/** The host of a special URL as a WHATWG URL parser reads it; `afterScheme` follows the colon. */
function specialUrlHost(afterScheme: string): string | null {
  const rest = afterScheme.replace(/^[/\\]+/u, '')
  const end = rest.search(/[/\\?#]/u)
  let authority = end === -1 ? rest : rest.slice(0, end)
  const at = authority.lastIndexOf('@')
  if (at !== -1) authority = authority.slice(at + 1)
  let host: string
  if (authority.startsWith('[')) {
    const close = authority.indexOf(']')
    host = close === -1 ? authority : authority.slice(0, close + 1)
  } else {
    const colon = authority.indexOf(':')
    host = colon === -1 ? authority : authority.slice(0, colon)
  }
  host = normalizeHost(percentDecode(host))
  if (host === '') return null
  try {
    // The WHATWG parser decides which host a browser opens: `2130706433` and `0x7f.1` are `127.0.0.1`.
    return normalizeHost(new URL(`http://${afterScheme.replace(/^[/\\]+/u, '')}`).hostname) || host
  } catch {
    return host
  }
}

/** A configured domain, read as the host a URL with it would have. */
function canonicalHost(domain: string): string {
  try {
    return normalizeHost(new URL(`http://${domain}`).hostname) || normalizeHost(domain)
  } catch {
    return normalizeHost(domain)
  }
}

function trimControls(url: string): string {
  let start = 0
  let end = url.length
  while (start < end && url.charCodeAt(start) <= 32) start++
  while (end > start && url.charCodeAt(end - 1) <= 32) end--
  return url.slice(start, end)
}

interface Policy {
  allowExternal: boolean
  allowInternal: boolean
  denied: readonly string[]
  allowed: readonly string[] | null
  allowedDomains: readonly string[] | null
  deniedDomains: readonly string[]
  baseHost: string | null
}

function compilePolicy(options: LinkPolicyOptions): Policy {
  const lower = (list: readonly string[]): string[] => list.map((entry) => entry.toLowerCase())
  return {
    allowExternal: options.allowExternal ?? true,
    allowInternal: options.allowInternal ?? true,
    denied: lower(options.deniedSchemes ?? ['javascript', 'vbscript', 'data', 'file']),
    allowed: options.allowedSchemes === undefined || options.allowedSchemes === null ? null : lower(options.allowedSchemes),
    allowedDomains: options.allowedDomains === undefined || options.allowedDomains === null
      ? null : options.allowedDomains.map(canonicalHost),
    deniedDomains: (options.deniedDomains ?? []).map(canonicalHost),
    baseHost: options.baseHost === undefined ? null : canonicalHost(options.baseHost),
  }
}

function inDomains(host: string, domains: readonly string[]): boolean {
  return domains.some((domain) => host === domain || host.endsWith(`.${domain}`))
}

function hostAllowed(policy: Policy, host: string): boolean {
  if (inDomains(host, policy.deniedDomains)) return false
  if (policy.allowedDomains !== null && !inDomains(host, policy.allowedDomains)) return false
  return policy.allowExternal || host === policy.baseHost
}

function schemeAllowed(policy: Policy, url: string, colon: number): boolean {
  const raw = url.slice(0, colon).toLowerCase()
  const scheme = raw.replace(PROBE_STRIP, '')
  if (policy.denied.includes(scheme)) return false
  if (policy.allowed !== null && !policy.allowed.includes(raw)) return false
  if (scheme !== 'http' && scheme !== 'https') return true
  const host = specialUrlHost(url.slice(colon + 1))
  if (host !== null) return hostAllowed(policy, host)
  return policy.deniedDomains.length === 0 && policy.allowedDomains === null && policy.allowExternal
}

/** The 0.1 `LinkPolicy` decision; a host is read as a browser reads it, and a bare relative path is internal. */
function policyAllows(policy: Policy, input: string): boolean {
  const url = trimControls(input).replace(/[\t\n\r]/gu, '')
  if (url === '') return true
  const prefix = url.replace(/\\/gu, '/')
  if (url.startsWith('#')) return policy.allowInternal
  if (prefix.startsWith('//')) {
    if (policy.allowed !== null && !policy.allowed.includes('http') && !policy.allowed.includes('https')) return false
    const host = specialUrlHost(prefix)
    return host !== null && hostAllowed(policy, host)
  }
  if (prefix.startsWith('/') || prefix.startsWith('./') || prefix.startsWith('../')) return policy.allowInternal
  const colon = url.indexOf(':')
  // A path without a scheme, such as `doc/page` or `a/b:c`, is relative and so internal.
  if (colon === -1 || /[/?#]/u.test(url.slice(0, colon))) return policy.allowInternal
  return schemeAllowed(policy, url, colon)
}

/**
 * Applies a link policy to the render view: a link, autolink or image whose URL the policy refuses is written as its
 * text, and each link that stays gets the `rel` values. It narrows the core URL policy (C2-H-159), never widens it.
 */
export function linkPolicy(options: LinkPolicyOptions = {}): ExtensionDefinition {
  const rel = options.rel ?? []
  const policy = compilePolicy(options)
  return {
    name: 'carve.linkPolicy', version: '1', props: {}, slots: {},
    documentTransform(view: DocumentNode): DocumentNode {
      rewriteTree(view, (node) => {
        if (node.type === 'image') {
          if (node.src === undefined || policyAllows(policy, node.src)) return undefined
          return node.alt === undefined || node.alt === '' ? [] : [{ type: 'text', value: node.alt }]
        }
        if (node.type === 'autolink') {
          if (!policyAllows(policy, node.href)) return [{ type: 'text', value: node.text ?? node.href }]
          if (rel.length === 0) return undefined
          const link = asLink(node)
          addRel(link, rel)
          return [link]
        }
        if (node.type !== 'link' || node.href === undefined) return undefined
        if (!policyAllows(policy, node.href)) return node.children
        if (rel.length > 0) addRel(node, rel)
        return undefined
      }, true)
      return view
    },
  }
}

/** Options of {@link autolink}. */
export interface AutolinkOptions {
  /** Schemes linked in bare text; `mailto` also links bare email addresses. Default `['https', 'http', 'mailto']`. */
  allowedSchemes?: string[]
}

const NOT_LINKED = new Set(['link', 'autolink', 'image', 'xref', 'code', 'raw_inline', 'math', 'literal_inline'])
const EMAIL = '[a-zA-Z0-9._%+-]{1,64}@(?:[a-zA-Z0-9-]{1,63}\\.)+[a-zA-Z]{2,63}'

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

/**
 * Links bare URLs and email addresses in the text of the render view. Angle autolinks `<url>` are core; this extension
 * adds no delimiter (C2-X-013). Trailing sentence punctuation stays outside the link.
 */
export function autolink(options: AutolinkOptions = {}): ExtensionDefinition {
  const schemes = options.allowedSchemes ?? ['https', 'http', 'mailto']
  const urlSchemes = schemes.filter((scheme) => scheme !== 'mailto').map(escapeRegExp)
  const parts: string[] = []
  if (urlSchemes.length > 0) {
    parts.push(`(?<![\\p{L}\\p{N}])(?:${urlSchemes.join('|')}):\\/\\/[^\\s<>\\[\\](){}]*[^\\s<>\\[\\](){}.,;:!?'"]`)
  }
  if (schemes.includes('mailto')) parts.push(`(?<![\\p{L}\\p{N}._%+-])(?:mailto:)?${EMAIL}`)
  const pattern = parts.length === 0 ? null : new RegExp(parts.join('|'), 'giu')
  return {
    name: 'carve.autolink', version: '1', props: {}, slots: {},
    documentTransform(view: DocumentNode): DocumentNode {
      if (pattern === null) return view
      rewriteTree(view, (node, ancestors) => {
        if (node.type !== 'text' || ancestors.some((above) => NOT_LINKED.has(above.type))) return undefined
        return linked(node.value, pattern)
      }, true)
      return view
    },
  }
}

function linked(text: string, pattern: RegExp): Inline[] | undefined {
  const out: Inline[] = []
  let last = 0
  pattern.lastIndex = 0
  for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
    const found = match[0]
    if (match.index > last) out.push({ type: 'text', value: text.slice(last, match.index) })
    const bare = !found.includes('://') && !found.startsWith('mailto:')
    out.push(bare ? { type: 'autolink', href: `mailto:${found}`, text: found } : { type: 'autolink', href: found })
    last = match.index + found.length
  }
  if (out.length === 0) return undefined
  if (last < text.length) out.push({ type: 'text', value: text.slice(last) })
  return out
}
