import type { Attrs, CodeBlock } from './ast.js'
import type { CarveExtension, DiagramRenderer } from './extension.js'

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
   * Accessible name for the rendered diagram. Default: the `cssClass` word, so
   * a `mermaid` fence is named `mermaid` out of the box. That is deliberately
   * the fence's OWN word rather than invented English: no preset overrides it,
   * which is what keeps `mermaid()` byte-identical to the factory it is a
   * preset of. A host that wants a reader to hear something better sets this,
   * or the author writes `{aria-label=…}` on the fence itself.
   *
   * The hydration element carries `role="img"` with this name (carve#1468).
   * Before the client library runs - and if it never runs - the body is DIAGRAM
   * SOURCE, and a reader announced it as prose; afterwards the injected `<svg>`
   * had no name either. `role="img"` plus a name fixes both halves, and the two
   * travel together: an `img` with no accessible name is skipped entirely,
   * which is worse than the source being read out.
   *
   * Set to `''` to write neither attribute and keep the previous output.
   */
  label?: string
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
  const label = opts.label ?? cssClass
  // The author's own `role` / `aria-label` on the fence wins - a second one
  // beside theirs leaves the value undefined. HTML attribute names are
  // ASCII-case-insensitive, so the comparison is too.
  const authored = (attrs: Attrs | undefined, name: string): boolean =>
    Object.keys(attrs?.keyValues ?? {}).some((k) => k.toLowerCase() === name)
  // `role="img"` and the name are written TOGETHER or not at all.
  const named = (attrs: Attrs): Attrs => {
    // The ROLE and the NAME are decided INDEPENDENTLY. An author who writes only
    // `{aria-label="Deploy flow"}` has supplied the name and still needs the
    // role - suppressing it there would leave exactly the defect this fixes, on
    // the one fence whose author cared enough to name it.
    //
    // The invariant that survives is narrower: the role is never written WITHOUT
    // a name, from either source, because an `img` with no accessible name is
    // skipped entirely. So `label: ''` on a fence the author did not name
    // removes both, which is the documented opt-out.
    const authoredName = authored(attrs, 'aria-label') || authored(attrs, 'aria-labelledby')
    const writeName = label !== '' && !authoredName
    const writeRole = !authored(attrs, 'role') && (authoredName || label !== '')
    if (!writeName && !writeRole) return attrs
    // APPENDED, never reordered: the author's own order is left exactly as it
    // was, so naming a fence cannot move an `{#id}` the author put before the
    // class. Same rule the core math span follows for `role`.
    return {
      ...attrs,
      keyValues: {
        ...(attrs.keyValues ?? {}),
        ...(writeRole ? { role: 'img' } : {}),
        ...(writeName ? { 'aria-label': label } : {}),
      },
      // `.class` is pinned into the order before the appended names, because
      // renderAttrs emits an omitted class LAST - so appending role/aria-label
      // to an author order that never mentioned the class would slip them in
      // ahead of it. Everything the author DID spell keeps its place.
      order: [
        ...(attrs.order ?? []),
        ...((attrs.order ?? []).includes('.class') ? [] : ['.class']),
        ...(writeRole ? ['role'] : []),
        ...(writeName ? ['aria-label'] : []),
      ],
    }
  }

  return {
    name: 'fenced-render',
    blockRenderers: {
      'code_block': (node, ctx) => {
        const code = node as CodeBlock
        if (!languages.includes(code.lang ?? '')) return undefined
        // Merge the cssClass ahead of author classes; renderAttrs hardens the
        // copied author attributes (names + values).
        const attrs: Attrs = { ...code.attrs, classes: [cssClass, ...(code.attrs?.classes ?? [])] }
        const open = `<${tag}${ctx.renderAttrs(named(attrs), tag)}>`
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
      // cannot draw it. The renderers map is open and keyed by css class, so if
      // a build-time renderer is supplied for this fence's class (`mermaid`,
      // `chart`, a custom word, …) emit its output wrapped in the attributed
      // element so author attrs survive; otherwise degrade to the source as a
      // `<pre><code class="language-…">` block - never blank, and re-renderable
      // by a host that loads the client library.
      'code_block': (node, ctx) => {
        const code = node as CodeBlock
        if (!languages.includes(code.lang ?? '')) return undefined
        const pad = ctx.indent(ctx.level)
        // Merge the cssClass ahead of author classes and copy the author
        // attributes through ctx.renderAttrs (same hardening as the interactive
        // path), so an `{#id .class data-x=y}` on the fence survives both the
        // renderer-output and the source-fallback degradation paths.
        const attrs: Attrs = { ...code.attrs, classes: [cssClass, ...(code.attrs?.classes ?? [])] }
        // Keyed by css class against the open renderers map. The 'math' key is a
        // MathRenderer (2-arg); a diagram fence never keys it, so narrow here.
        const build = ctx.renderers[cssClass] as DiagramRenderer | undefined
        if (build) {
          // Wrap the renderer's output (an `<svg>` / `<img>`) in a `<div>` with
          // the fence's merged attributes (cssClass + author `{#id .class}`), so
          // the class/attrs survive and the wrapper is identical across engines
          // (carve#302). A `<div>` - not the interactive `<pre>`/`<div>` tag -
          // because the output is a rendered image, not source text.
          const element = `<div${ctx.renderAttrs(named(attrs), 'div')}>${build(code.content)}</div>`
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
  fencedRender({ language: ['dot', 'graphviz'], cssClass: 'graphviz' })
/** WaveDrom preset (text mode, `<pre class="wavedrom">`). */
export const wavedrom = (): CarveExtension => fencedRender({ language: 'wavedrom' })
/** ABC music notation preset (text mode, `<pre class="abc">`). */
export const abc = (): CarveExtension => fencedRender({ language: 'abc' })
/** PlantUML preset (text mode); claims both `plantuml` and `puml`. Covers the
 *  UML shapes Mermaid does not (use case, component, deployment, timing). Load
 *  a client-side PlantUML build (`@plantuml/core`) to render the diagrams. */
export const plantuml = (): CarveExtension =>
  fencedRender({ language: ['plantuml', 'puml'], cssClass: 'plantuml' })
/** Vega-Lite preset (json mode, `<div class="vega-lite"><script ...>`). */
export const vegaLite = (): CarveExtension =>
  fencedRender({ language: 'vega-lite', contentMode: 'json' })
/** Chart.js preset (json mode, `<div class="chart"><script ...>`). In a static
 *  render a supplied `renderers.chart` pre-renders the config to an image. */
export const chart = (): CarveExtension =>
  fencedRender({ language: 'chart', contentMode: 'json' })

/**
 * Mermaid preset (text mode, `<pre class="mermaid">`). Mermaid is one preset of
 * {@link fencedRender}; load Mermaid.js on the page to render the diagrams.
 */
export const mermaid = (
  opts: Omit<FencedRenderOptions, 'language' | 'contentMode'> = {},
): CarveExtension => fencedRender({ language: 'mermaid', ...opts })

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
