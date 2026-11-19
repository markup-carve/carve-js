import type { Attrs, BlockExtensionNode, CodeBlockNode, InlineExtensionNode, Node } from '../../ast.ts'
import type { ExtensionClaim, ExtensionDefinition, ExtensionRenderer, ExtensionRenderHost } from '../types.ts'
import { type ExtensionBundle, withExtensions } from './bundle.ts'

/** How a {@link fencedRender} instance places the fence body. */
export type FencedRenderContentMode = 'text' | 'json'

/** A host build-time renderer: diagram source in, self-contained HTML (an `<svg>` or `<img>`) out. */
export type DiagramBuilder = (source: string) => string

export interface FencedRenderOptions {
  /** Fence language word(s) this instance claims. */
  language: string | readonly string[]
  /** Class on the output element. Default: the first `language` word. */
  cssClass?: string
  /** Wrapper element. Default `div` in json mode, else `pre`. */
  tag?: 'pre' | 'div'
  contentMode?: FencedRenderContentMode
  /** Wraps the output in `<figure class="{figureClass}">`. */
  wrapInFigure?: boolean
  /** Default `{cssClass}-figure`. */
  figureClass?: string
  /** Accessible name written with `role="img"`. Default the css class; `''` writes neither. */
  label?: string
  /** C2-X-052: registers the build-time channel; without it static mode writes the fallback code block. */
  build?: DiagramBuilder
}

/** The qualified name of the fence `word` of a {@link fencedRender} instance. */
export function fencedRenderName(word: string): string {
  return `carve.fencedRender.${word}`
}

function transform(claim: ExtensionClaim): BlockExtensionNode | null {
  if (claim.form !== 'fence') return null
  return { type: 'block_extension', name: fencedRenderName(claim.name), version: '1', children: [],
    props: { language: claim.name }, payload: [{ format: 'text/plain', value: claim.value }],
    fallback: [bareFallback(claim.node)] }
}

/** C2-X-035: the attributes live on the extension node, so the fallback does not repeat them. */
export function bareFallback(node: CodeBlockNode): CodeBlockNode {
  const copy = structuredClone(node)
  delete copy.attrs
  return copy
}

/** The fence body without its final line break, as the client libraries read it. */
export function fenceSource(value: string): string {
  return value.endsWith('\n') ? value.slice(0, -1) : value
}

function sourceOf(node: BlockExtensionNode | InlineExtensionNode): string {
  const value = node.payload?.[0]?.value
  return typeof value === 'string' ? fenceSource(value) : ''
}

// Text mode keeps `>` so arrow syntax (`-->`) reaches the client library as written.
function escapeSource(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;')
}

// `</` is the only sequence that closes the script early; `<\/` is the same JSON.
function guardScriptClose(value: string): string {
  return value.replace(/<\//g, '<\\/')
}

function authored(attrs: Attrs | undefined, name: string): boolean {
  return attrs?.keyValues?.some(([key]) => key.toLowerCase() === name) === true
}

/** The css class ahead of the author's classes; `role="img"` never without a name, the author's own winning. */
function namedAttrs(attrs: Attrs | undefined, cssClass: string, label: string): Attrs {
  const authoredName = authored(attrs, 'aria-label') || authored(attrs, 'aria-labelledby')
  const writeName = label !== '' && !authoredName
  const writeRole = !authored(attrs, 'role') && (authoredName || label !== '')
  const keyValues: [string, string][] = [...(attrs?.keyValues ?? [])]
  if (writeRole) keyValues.push(['role', 'img'])
  if (writeName) keyValues.push(['aria-label', label])
  return { ...(attrs?.id === undefined ? {} : { id: attrs.id }), classes: [cssClass, ...(attrs?.classes ?? [])],
    ...(keyValues.length === 0 ? {} : { keyValues }) }
}

export function fencedRender(options: FencedRenderOptions): ExtensionBundle {
  const words = (typeof options.language === 'string' ? [options.language] : [...options.language])
    .filter((word) => word !== '')
  if (words.length === 0) throw new Error('fencedRender requires at least one non-empty language word')
  const mode = options.contentMode ?? 'text'
  const cssClass = options.cssClass ?? words[0] ?? ''
  const tag = options.tag ?? (mode === 'json' ? 'div' : 'pre')
  const figureClass = options.figureClass ?? `${cssClass}-figure`
  const label = options.label ?? cssClass
  const build = options.build

  const figure = (html: string, host: ExtensionRenderHost): string => options.wrapInFigure === true
    ? `<figure class="${host.escapeAttribute(figureClass)}">${html}</figure>` : html
  const attributes = (node: Node, host: ExtensionRenderHost): string =>
    host.attributes({ ...node, attrs: namedAttrs(node.attrs, cssClass, label) } as Node, { block: true })

  const renderer: ExtensionRenderer = {
    version: '1',
    render(node, host) {
      const source = sourceOf(node)
      const body = mode === 'json' ? `<script type="application/json">${guardScriptClose(source)}</script>`
        : escapeSource(source)
      return figure(`<${tag}${attributes(node, host)}>${body}</${tag}>`, host)
    },
    ...(build === undefined ? {} : {
      // A `<div>`, not the interactive tag: the output is a rendered image, not source text.
      buildTime: (node: BlockExtensionNode | InlineExtensionNode, host: ExtensionRenderHost) =>
        figure(`<div${attributes(node, host)}>${build(sourceOf(node))}</div>`, host),
    }),
  }
  const extensions: ExtensionDefinition[] = words.map((word) => ({
    name: fencedRenderName(word), version: '1', matcher: { form: 'fence', name: word },
    props: { language: 'string' }, slots: {}, children: 'none', transform,
  }))
  return { extensions, renderers: Object.fromEntries(words.map((word) => [fencedRenderName(word), renderer])) }
}

/** Options a preset passes through: everything but the claimed words and the content mode. */
export type PresetOptions = Omit<FencedRenderOptions, 'language' | 'contentMode'>

export const mermaid = (options: PresetOptions = {}): ExtensionBundle => fencedRender({ ...options, language: 'mermaid' })
export const d2 = (options: PresetOptions = {}): ExtensionBundle => fencedRender({ ...options, language: 'd2' })
export const graphviz = (options: PresetOptions = {}): ExtensionBundle =>
  fencedRender({ cssClass: 'graphviz', ...options, language: ['dot', 'graphviz'] })
export const wavedrom = (options: PresetOptions = {}): ExtensionBundle => fencedRender({ ...options, language: 'wavedrom' })
export const abc = (options: PresetOptions = {}): ExtensionBundle => fencedRender({ ...options, language: 'abc' })
export const plantuml = (options: PresetOptions = {}): ExtensionBundle =>
  fencedRender({ cssClass: 'plantuml', ...options, language: ['plantuml', 'puml'] })
export const vegaLite = (options: PresetOptions = {}): ExtensionBundle =>
  fencedRender({ ...options, language: 'vega-lite', contentMode: 'json' })
export const chart = (options: PresetOptions = {}): ExtensionBundle =>
  fencedRender({ ...options, language: 'chart', contentMode: 'json' })

/** Build-time renderers for {@link presets}, keyed by the preset's css class as in 0.1. */
export type PresetBuilders = Partial<Record<'mermaid' | 'd2' | 'graphviz' | 'wavedrom' | 'abc' | 'plantuml' | 'vega-lite' |
  'chart', DiagramBuilder>>

function withBuild(build: DiagramBuilder | undefined): PresetOptions {
  return build === undefined ? {} : { build }
}

/** Every diagram preset; claims `mermaid`, `d2`, `dot`, `graphviz`, `wavedrom`, `abc`, `plantuml`, `puml`, `vega-lite`, `chart`. */
export function presets(builders: PresetBuilders = {}): ExtensionBundle {
  return withExtensions(mermaid(withBuild(builders.mermaid)), d2(withBuild(builders.d2)),
    graphviz(withBuild(builders.graphviz)), wavedrom(withBuild(builders.wavedrom)), abc(withBuild(builders.abc)),
    plantuml(withBuild(builders.plantuml)), vegaLite(withBuild(builders['vega-lite'])), chart(withBuild(builders.chart)))
}
