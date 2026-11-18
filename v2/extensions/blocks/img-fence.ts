import { isUrlAllowed, type ExtensionClaim, type ExtensionDefinition, type ExtensionRenderer } from '../../src/index.ts'
import { attrValue, authorAttrs } from '../common/attrs.ts'
import { sanitizeSvg, type SanitizeSvgOptions } from './svg-sanitize.ts'

export interface ImgFenceOptions extends SanitizeSvgOptions {
  allowInline?: boolean
}

function transform(claim: ExtensionClaim) {
  if (claim.form !== 'fence') return null
  return { type: 'block_extension' as const, name: `carve.imgFence.${claim.name}`, version: '1', children: [],
    props: { language: claim.name }, payload: [{ format: 'image/svg+xml', value: claim.value }],
    fallback: [structuredClone(claim.node)] }
}

function definition(name: 'img' | 'image'): ExtensionDefinition {
  return { name: `carve.imgFence.${name}`, version: '1', matcher: { form: 'fence', name }, props: { language: 'string' },
    slots: {}, children: 'none', transform }
}

export const imgFenceExtensions: readonly ExtensionDefinition[] = [definition('img'), definition('image')]

function svgTitle(svg: string): string | undefined {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(svg)?.[1]
  if (title === undefined) return undefined
  const text = title.replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#3[49];/g, "'").replace(/&amp;/g, '&').trim()
  return text === '' ? undefined : text
}

function mergeRoot(svg: string, attrs: string): string {
  if (attrs === '') return svg
  const names = [...attrs.matchAll(/\s([a-z_:][\w:.-]*)\s*=/gi)].map((match) => match[1]?.toLowerCase() ?? '')
  return svg.replace(/^<svg((?:"[^"]*"|'[^']*'|[^>])*?)(\/?)>/i, (_whole, root: string, slash: string) => {
    let cleaned = root
    for (const name of names) {
      const safeName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      cleaned = cleaned.replace(new RegExp(`\\s${safeName}\\s*=\\s*("[^"]*"|'[^']*'|[^\\s>]+)`, 'i'), '')
    }
    return `<svg${attrs}${cleaned}${slash}>`
  })
}

export function createImgFence(options: ImgFenceOptions = {}): {
  extensions: readonly ExtensionDefinition[], renderers: Record<string, ExtensionRenderer>
} {
  const renderer: ExtensionRenderer = { version: '1', render(node, host) {
    const value = node.payload?.[0]?.value
    const source = typeof value === 'string' ? value : ''
    const sanitized = sanitizeSvg(source, { ...options, urlPolicy: host.urlPolicy })
    if (!sanitized.ok) return host.blocks(node.fallback ?? [])
    const inline = options.allowInline === true && attrValue(node.attrs, 'inline') !== undefined
    const attrs = authorAttrs(node.attrs, host, ['inline', 'alt', 'sandbox', 'src', 'srcset'])
    if (inline) {
      const merged = sanitizeSvg(mergeRoot(sanitized.svg, attrs), { ...options, urlPolicy: host.urlPolicy })
      return merged.ok ? merged.svg : host.blocks(node.fallback ?? [])
    }
    const src = `data:image/svg+xml,${encodeURIComponent(sanitized.svg)}`
    if (!isUrlAllowed(src, host.urlPolicy)) return host.blocks(node.fallback ?? [])
    const alt = attrValue(node.attrs, 'alt') ?? svgTitle(sanitized.svg) ?? ''
    return `<img src="${host.escapeAttribute(src)}" alt="${host.escapeAttribute(alt)}"${attrs}>`
  } }
  return { extensions: imgFenceExtensions,
    renderers: { 'carve.imgFence.img': renderer, 'carve.imgFence.image': renderer } }
}

export const imgFenceRenderers = createImgFence().renderers
