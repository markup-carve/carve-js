import type { Attrs, CodeBlock } from './ast.js'
import type { CarveExtension } from './extension.js'

/** How a {@link fencedRender} instance places the block body. */
export type FencedRenderContentMode = 'text' | 'json'

/** Options for the {@link fencedRender} factory. */
export interface FencedRenderOptions {
  /** Fence info word(s) this instance claims. */
  language: string | string[]
  /** Class on the output element. Default: the first `language` word. */
  cssClass?: string
  /** Wrapper element. Default: `'div'` for json mode, else `'pre'`. */
  tag?: 'pre' | 'div'
  /** How the body is placed. Default `'text'`. */
  contentMode?: FencedRenderContentMode
  /** Wrap output in `<figure class="{cssClass}-figure">`. Default `false`. */
  wrapInFigure?: boolean
  /** Figure class. Default `"{cssClass}-figure"`. */
  figureClass?: string
  /**
   * Which build-time renderer in the static `renderers` map produces this
   * instance's image (`'mermaid'`, `'chart'` or `'graphviz'`). When set and a
   * `mode: "static"` render supplies that renderer, `renderStatic` emits the
   * renderer's output (an `<svg>` / `<img>`); otherwise it falls back to the
   * source as a `<pre><code>` block. Unset means no build renderer applies and
   * static always degrades to source.
   */
  staticRenderer?: 'mermaid' | 'chart' | 'graphviz' | 'plantuml'
}

// Text mode: escape `&` and `<` (blocking tag injection), but keep `>` so
// arrow syntax (`-->`) survives, matching the Mermaid behavior.
function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
}

// JSON mode: the body is verbatim JSON inside a <script>. The only sequence
// that can close the script element early (or inject markup) is `</`; rewrite
// it to `<\/`, which is byte-equivalent JSON (`\/` decodes to `/`).
function guardScriptClose(s: string): string {
  return s.replace(/<\//g, '<\\/')
}

/**
 * Generic client-rendered fenced-block factory (Tier-3). Claims fenced code
 * blocks by language word and emits one hydration element; the block body is
 * passed through verbatim (no Carve parsing). This is the same client-hydration
 * shape {@link mermaid} uses - Mermaid is one preset of it - generalized so D2,
 * Graphviz, WaveDrom, ABC, Vega-Lite, Chart.js, etc. need no new code.
 *
 * - `text` mode (Mermaid, D2, Graphviz, WaveDrom, ABC): body is HTML-escaped
 *   text inside the wrapper (`&` and `<` escaped, `>` preserved).
 *
 *       ``` d2
 *       a -> b
 *       ```
 *   → `<pre class="d2">a -> b</pre>`
 *
 * - `json` mode (Vega-Lite, Chart.js): body is emitted verbatim inside a
 *   `<script type="application/json">` (default wrapper `<div>`), with `</`
 *   guarded so the JSON cannot close the script element early.
 *
 *       ``` vega-lite
 *       {"mark": "bar"}
 *       ```
 *   → `<div class="vega-lite"><script type="application/json">{"mark": "bar"}</script></div>`
 *
 *   Note: json mode emits a `<script type="application/json">`, so consumers
 *   that sanitize the HTML after conversion should whitelist that tag or use
 *   text mode (the config then rides in a `<pre>` as escaped text).
 *
 * Author attributes on the fence are copied through `ctx.renderAttrs`, which
 * applies the always-on attribute hardening (strips `on*` / `srcdoc` /
 * `formaction`, neutralizes dangerous URL / `expression()` values), so a
 * `{onclick=…}` fence cannot inject. Ported alongside carve-php's
 * `FencedRenderExtension`.
 */
export function fencedRender(opts: FencedRenderOptions): CarveExtension {
  const languages = (Array.isArray(opts.language) ? opts.language : [opts.language]).filter(
    (word) => word !== '',
  )
  if (languages.length === 0) {
    throw new Error('fencedRender requires at least one non-empty language word')
  }
  const mode: FencedRenderContentMode = opts.contentMode ?? 'text'
  const cssClass = opts.cssClass ?? languages[0]
  const tag = opts.tag ?? (mode === 'json' ? 'div' : 'pre')
  const figureClass = opts.figureClass ?? `${cssClass}-figure`

  const staticRendererKey = opts.staticRenderer

  return {
    name: 'fenced-render',
    blockRenderers: {
      'code-block': (node, ctx) => {
        const code = node as CodeBlock
        if (!languages.includes(code.lang ?? '')) return undefined
        // Merge the cssClass ahead of author classes; renderAttrs hardens the
        // copied author attributes (names + values).
        const attrs: Attrs = { ...code.attrs, classes: [cssClass, ...(code.attrs?.classes ?? [])] }
        const open = `<${tag}${ctx.renderAttrs(attrs)}>`
        const body =
          mode === 'json'
            ? `<script type="application/json">${guardScriptClose(code.content)}</script>`
            : escapeText(code.content)
        const element = `${open}${body}</${tag}>`
        if (opts.wrapInFigure) {
          const pad = ctx.indent(ctx.level)
          return `${pad}<figure class="${ctx.escapeAttr(figureClass)}">\n${pad}${element}\n${pad}</figure>`
        }
        return `${ctx.indent(ctx.level)}${element}`
      },
    },
    staticBlockRenderers: {
      // Static render: the diagram is a client-script visual, so the engine
      // cannot draw it. If a build-time renderer is supplied for this instance
      // (`renderers.mermaid` / `renderers.chart` / `renderers.graphviz`), emit its output wrapped in
      // the attributed element so author attrs survive; otherwise degrade to
      // the source as a `<pre><code class="language-…">`
      // block - never blank, and re-renderable by a host that loads the client
      // library.
      'code-block': (node, ctx) => {
        const code = node as CodeBlock
        if (!languages.includes(code.lang ?? '')) return undefined
        const pad = ctx.indent(ctx.level)
        // Merge the cssClass ahead of author classes and copy the author
        // attributes through ctx.renderAttrs (same hardening as the interactive
        // path), so an `{#id .class data-x=y}` on the fence survives both the
        // renderer-output and the source-fallback degradation paths.
        const attrs: Attrs = { ...code.attrs, classes: [cssClass, ...(code.attrs?.classes ?? [])] }
        const build = staticRendererKey ? ctx.renderers[staticRendererKey] : undefined
        if (build) {
          // Wrap the renderer's output (an `<svg>` / `<img>`) in the same
          // element + author attributes the interactive path emits, so the
          // fence's id / classes / other attrs land on the wrapping element
          // instead of being dropped.
          const element = `<${tag}${ctx.renderAttrs(attrs)}>${build(code.content)}</${tag}>`
          if (opts.wrapInFigure) {
            return `${pad}<figure class="${ctx.escapeAttr(figureClass)}">\n${pad}${element}\n${pad}</figure>`
          }
          return `${pad}${element}`
        }
        // Source fallback: a self-contained, escaped code block reusing the
        // same merged attrs (cssClass ahead of author classes, hardened by
        // ctx.renderAttrs).
        const langAttr = code.lang ? ` class="language-${ctx.escapeAttr(code.lang)}"` : ''
        return `${pad}<pre${ctx.renderAttrs(attrs)}><code${langAttr}>${ctx.escapeHtml(code.content)}\n</code></pre>`
      },
    },
  }
}

/** D2 preset (text mode, `<pre class="d2">`). */
export const d2 = (): CarveExtension => fencedRender({ language: 'd2' })
/** Graphviz preset (text mode); claims both `dot` and `graphviz`. In a static
 *  render a supplied `renderers.graphviz` pre-renders the source to an image. */
export const graphviz = (): CarveExtension =>
  fencedRender({ language: ['dot', 'graphviz'], cssClass: 'graphviz', staticRenderer: 'graphviz' })
/** WaveDrom preset (text mode, `<pre class="wavedrom">`). */
export const wavedrom = (): CarveExtension => fencedRender({ language: 'wavedrom' })
/** ABC music notation preset (text mode, `<pre class="abc">`). */
export const abc = (): CarveExtension => fencedRender({ language: 'abc' })
/** PlantUML preset (text mode); claims both `plantuml` and `puml`. Covers the
 *  UML shapes Mermaid does not (use case, component, deployment, timing). Load
 *  a client-side PlantUML build (`@plantuml/core`) to render the diagrams. */
export const plantuml = (): CarveExtension =>
  fencedRender({ language: ['plantuml', 'puml'], cssClass: 'plantuml', staticRenderer: 'plantuml' })
/** Vega-Lite preset (json mode, `<div class="vega-lite"><script ...>`). */
export const vegaLite = (): CarveExtension =>
  fencedRender({ language: 'vega-lite', contentMode: 'json' })
/** Chart.js preset (json mode, `<div class="chart"><script ...>`). In a static
 *  render a supplied `renderers.chart` pre-renders the config to an image. */
export const chart = (): CarveExtension =>
  fencedRender({ language: 'chart', contentMode: 'json', staticRenderer: 'chart' })

/**
 * Mermaid preset (text mode, `<pre class="mermaid">`). Mermaid is one preset of
 * {@link fencedRender}; load Mermaid.js on the page to render the diagrams.
 */
export const mermaid = (
  opts: Omit<FencedRenderOptions, 'language' | 'contentMode'> = {},
): CarveExtension => fencedRender({ language: 'mermaid', staticRenderer: 'mermaid', ...opts })

/**
 * Every bundled diagram preset as ready-to-register extensions, for spreading
 * into the `extensions` option:
 *
 *     carveToHtml(src, { extensions: [...presets(), mathBlock()] })
 *
 * This claims every preset fence word (`mermaid`, `d2`, `dot`, `graphviz`,
 * `wavedrom`, `abc`, `plantuml`, `puml`, `vega-lite`, `chart`), so a literal code
 * sample in one of
 * those languages becomes a hydration element; include only the presets whose
 * client library you actually load if that matters.
 */
export const presets = (): CarveExtension[] => [
  mermaid(),
  d2(),
  graphviz(),
  wavedrom(),
  abc(),
  plantuml(),
  vegaLite(),
  chart(),
]
