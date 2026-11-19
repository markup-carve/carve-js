import type { ExtensionBundle } from '../../src/extensions/standard/bundle.ts'
import { isUrlAllowed } from '../../src/html-attributes.ts'
import { wikiExtension } from '../../src/extensions/wiki-cite.ts'
import type { ExtensionRenderer } from '../../src/index.ts'
import { authorAttrs } from '../common/attrs.ts'

export interface WikilinksOptions {
  /** Maps a page name to a URL; the anchor is appended afterwards. Default: a lowercase hyphen slug. */
  urlGenerator?: (page: string) => string
  /** Classes of the link. Default `wikilink`. */
  cssClass?: string
  /** Open links in a new tab (`target="_blank" rel="noopener"`). */
  newWindow?: boolean
}

function slug(page: string): string {
  return page.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\-_/]/g, '').replace(/-+/g, '-')
}

interface Target { page: string, anchor: string, display: string }

/** `Page#anchor|Display`: the page, the anchor with its `#`, and the display text, each possibly empty. */
function target(text: string): Target {
  const bar = text.indexOf('|')
  const path = (bar < 0 ? text : text.slice(0, bar)).trim()
  const hash = path.indexOf('#')
  return { page: hash < 0 ? path : path.slice(0, hash).trim(), anchor: hash < 0 ? '' : `#${path.slice(hash + 1)}`,
    display: bar < 0 ? '' : text.slice(bar + 1).trim() }
}

type Render = NonNullable<ExtensionRenderer['render']>

function targetSource(node: Parameters<Render>[0], host: Parameters<Render>[1]): string {
  return typeof node.props?.['target'] === 'string' ? node.props['target'] : host.plainText(node.fallback ?? [])
}

/** The standard `:wiki[Page#anchor|Display]` matcher (C2-X-057) with a link renderer. */
export function wikilinks(options: WikilinksOptions = {}): ExtensionBundle {
  const generate = options.urlGenerator ?? slug
  const classes = (options.cssClass ?? 'wikilink').split(' ').filter((name) => name !== '')
  const link: Render = (node, host) => {
    const source = targetSource(node, host)
    const { page, anchor } = target(source)
    const display = host.plainText(node.fallback ?? [])
    const href = generate(page) + anchor
    // C2-X-057: the target becomes a link only through the URL policy (C2-H-159).
    if ((page === '' && anchor === '') || !isUrlAllowed(href, host.urlPolicy)) return host.inlines(node.fallback ?? [])
    // The generated href and pairs replace authored ones, so `{rel=opener}` cannot undo `noopener`.
    const generated: [string, string][] = [['data-wikilink', page], ...(options.newWindow === true ? [['target', '_blank'], ['rel', 'noopener']] as [string, string][] : [])]
    const names = new Set(['href', ...generated.map(([name]) => name)])
    const authored = (node.attrs?.keyValues ?? []).filter(([name]) => !names.has(name.toLowerCase()))
    const keyValues: [string, string][] = [generated[0]!, ...authored, ...generated.slice(1)]
    const attrs = authorAttrs({ ...node.attrs, classes: [...classes, ...(node.attrs?.classes ?? [])], keyValues }, host)
    const text = display !== '' ? display : page === '' ? anchor : page
    return `<a href="${host.escapeAttribute(href)}"${attrs}>${host.escapeText(text)}</a>`
  }
  return { extensions: [wikiExtension], renderers: { 'carve.wiki': { version: '1', render: link, buildTime: link } } }
}
