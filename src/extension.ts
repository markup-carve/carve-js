import type { Attrs, BlockNode, Document, Extension, InlineNode } from './ast.js'
// Type-only, and deliberately circular: `render-html.ts` imports this module's
// `CarveExtension`. `import type` is erased, so nothing of the cycle survives
// into the emitted JavaScript.
import type { RenderOptions } from './render-html.js'

/**
 * Build-time renderers for client-script extensions, supplied for a
 * `mode: "static"` HTML render. Each maps the construct's source to a
 * self-contained string the engine emits directly (an `<svg>`/`<img>` for a
 * diagram, MathML/HTML for math). When the renderer a node needs is absent,
 * the extension's `renderStatic` falls back to source - never blank.
 */
/** A diagram renderer: fence source -> SVG/HTML string. */
export type DiagramRenderer = (source: string) => string
/** The math renderer: (tex, display) -> MathML/HTML string. */
export type MathRenderer = (tex: string, display: boolean) => string

/**
 * Build-time renderers for a static HTML render. The map is **open**: a diagram
 * renderer is keyed by the fence's css class (`mermaid`, `chart`, `graphviz`,
 * `plantuml`, or any custom fence word), so a custom `fencedRender` instance is
 * static-capable with no change to this type. `math` is the one distinct entry
 * (its closure also takes a display flag). A missing key degrades to source.
 */
export interface StaticRenderers {
  /** Math TeX source -> MathML/HTML string. `display` flags block math. */
  math?: MathRenderer
  /** Diagram renderer for any fence css class (mermaid, chart, …, or custom). */
  [cssClass: string]: DiagramRenderer | MathRenderer | undefined
}

/** Render helpers passed to an extension renderer. */
export interface ExtensionRenderContext {
  renderInlines(nodes: InlineNode[]): string
  escapeHtml(s: string): string
  escapeAttr(s: string): string
  renderAttrs(attrs: Attrs | undefined): string
  /**
   * Reserve a DOM id in the shared document id namespace (extensions
   * contract §2.6): returns `baseId` when free, else the next free numeric
   * suffix (`baseId-2`, `-3`, ...), never colliding with explicit `{#id}`
   * attributes, generated heading ids, or previously generated ids.
   */
  uniqueId(baseId: string): string
  /** The active render mode: `"interactive"` (default) or `"static"`. */
  mode: 'interactive' | 'static'
  /** Build-time renderers supplied for a static render (else empty). */
  renderers: StaticRenderers
}

/** Renderer for a `:name[…]` extension node, keyed by extension name. */
export type ExtensionRenderer = (
  node: Extension,
  ctx: ExtensionRenderContext,
) => string | undefined

/**
 * Render helpers passed to a block-node renderer. `renderChildren` and
 * `indent` route back through the core renderer, so an extension emits its
 * own wrapper while the inner blocks keep rendering with the correct nesting
 * and context (no section-wrapping or tight-list elision leaks).
 */
export interface BlockExtensionRenderContext extends ExtensionRenderContext {
  /** Indentation level of the node being rendered. */
  level: number
  /** The indent string for a given level. */
  indent(level: number): string
  /** Render a list of block nodes at `level` via the core renderer. */
  renderChildren(nodes: BlockNode[], level: number): string
  /**
   * Whether the core renderer is wrapping top-level headings in `<section>`
   * (the `sections` render option; `true` by default).
   *
   * This matters to a `heading` block renderer and to nothing else. When it is
   * `true` the enclosing `<section>` owns the heading's id, so the renderer
   * must strip the id from the `<h*>` it emits or the document gets two
   * elements with the same id. When it is `false` there is no wrapper, and the
   * `<h*>` is the only thing that can carry the id - dropping it there leaves
   * every fragment link and cross-reference pointing at nothing.
   */
  sections: boolean
}

/**
 * Renderer for a core block node, keyed by node `type` (e.g. `admonition`).
 * Return a string to take over rendering, or `undefined` to fall through to
 * the core renderer (lets one extension claim only some nodes of a type).
 */
export type BlockExtensionRenderer = (
  node: BlockNode,
  ctx: BlockExtensionRenderContext,
) => string | undefined

/**
 * Renderer for an extension-produced INLINE node, keyed by node `type`
 * (e.g. `citation-group`). The inline twin of {@link BlockExtensionRenderer}.
 * Return a string to render, or `undefined` to defer to the next renderer.
 */
export type InlineExtensionRenderer = (
  node: InlineNode,
  ctx: ExtensionRenderContext,
) => string | undefined

/** Result of an inline matcher: the produced node and the offset just past it. */
export interface InlineMatch {
  node: InlineNode
  /** Offset in `text` immediately after the matched construct (must be > pos). */
  end: number
}

/** Result of a block matcher: the produced node and how many lines it consumed. */
export interface BlockMatch {
  node: BlockNode
  /** Number of input lines the block spans (must be > 0). */
  linesConsumed: number
}

/**
 * Parse-stage context handed to extension matchers. Mirrors the carve-rs and
 * carve-php `MatcherContext`: recursive parsing plus the document-wide
 * definition tables, so a matcher can parse its own inner content and resolve
 * references the same way core does.
 */
export interface MatcherContext {
  /** Parse inline markup (core + extensions) into nodes. */
  parseInlines(text: string): InlineNode[]
  /** Parse block markup (core + extensions) into nodes. */
  parseBlocks(source: string): BlockNode[]
  /** Reference-link definitions collected from the document. */
  linkDefs: ReadonlyMap<string, { href: string; title?: string }>
  /** Abbreviation definitions collected from the document. */
  abbrDefs: ReadonlyMap<string, string>
}

/**
 * Inline matcher: try to match a construct at `pos` in `text`. Return a match
 * (`end > pos`) or `null` to decline. Tried only at positions core did not
 * consume — extensions add syntax, they never hijack core.
 */
export type InlineMatcher = (
  text: string,
  pos: number,
  ctx: MatcherContext,
) => InlineMatch | null

/**
 * Block matcher: try to match a block starting at line `start`. Return a match
 * (`linesConsumed > 0`) or `null` to decline. Tried after every core block
 * construct and before the paragraph fallback.
 */
export type BlockMatcher = (
  lines: readonly string[],
  start: number,
  ctx: MatcherContext,
) => BlockMatch | null

/**
 * The context handed to {@link CarveExtension.beforeRender}, carrying what a
 * hook cannot otherwise know: there is no active render at `beforeRender` time,
 * so a hook that produces output of its own has nothing to inherit from and
 * would render with defaults (spec §2.2, markup-carve/carve#1007).
 *
 * READ-ONLY, and that is contract rather than convention. The guards run AFTER
 * the hooks, so a hook handed the live options could clear the very field a
 * guard measures - carve-rs met the same shape from the other side, where its
 * `max_length` cap sat behind these hooks and a hook could empty the field the
 * cap measured. {@link options} is therefore a frozen SHALLOW copy and is not
 * the object the renderer is handed a few lines later. Shallow is the honest
 * bound: the nested `symbols`, `renderers` and `extensions` values are the
 * caller's own objects and are shared by reference, because deep-freezing them
 * would freeze objects this package does not own. Read them, do not write them.
 */
export interface BeforeRenderContext {
  /**
   * The render options the conversion was called with (`carveToHtml`,
   * `carveToMarkdown`, `carveToPlainText`, `carveToAnsi`, `carveToAstJson`),
   * frozen and disconnected from the object the renderer will read.
   */
  readonly options: Readonly<RenderOptions>
  /**
   * The EFFECTIVE render mode for the target format. Always `"interactive"` for
   * the Markdown, plain-text and ANSI targets whatever the caller passed, since
   * static rendering is an HTML-only concern (spec §2.5) and those renderers
   * reach the same end by flattening - so a caller reusing one options object
   * across formats gets unchanged non-HTML output.
   */
  readonly mode: 'interactive' | 'static'
  /** True when {@link mode} is `"static"`, i.e. the static HTML path. */
  readonly isStatic: boolean
  /**
   * True when the final render target is HTML. An extension that emits HTML in
   * this hook reads it to SKIP its transform on the Markdown, plain-text and
   * ANSI targets and leave the source node for that renderer to emit as source.
   * This is the accessor a bare options parameter had no answer for, and the
   * reason the contract carries a context.
   */
  readonly targetIsHtml: boolean
}

/** A named extension unit contributing any subset of the lifecycle hooks. */
export interface CarveExtension {
  name: string
  /** Parse-stage inline matcher (adds inline syntax; never hijacks core). */
  matchInline?: InlineMatcher
  /** Parse-stage block matcher (tried before the paragraph fallback). */
  matchBlock?: BlockMatcher
  afterParse?(doc: Document): Document
  /**
   * Transform the resolved document just before it is rendered.
   *
   * `ctx` is the READ-ONLY context described by the spec's extension contract
   * (§2.2). A hook runs before the render starts, so it has nothing to inherit
   * from: with the document alone in hand a hook that renders something of its
   * own renders it with DEFAULTS, and a `symbols` map or `allowRawHtml: false`
   * reached the heading but not the table-of-contents entry built from the very
   * same nodes (markup-carve/carve#1007, markup-carve/carve-js#871).
   *
   * A hook that ignores it may still declare `beforeRender(doc)` - a function
   * of fewer parameters is assignable - and nothing in this package requires a
   * hook to read the context.
   */
  beforeRender?(doc: Document, ctx: BeforeRenderContext): Document
  /** Renderers keyed by the extension type name (the `name` in `:name[…]`). */
  renderers?: Record<string, ExtensionRenderer>
  /** Renderers keyed by core block node `type` (e.g. `admonition`). */
  blockRenderers?: Record<string, BlockExtensionRenderer>
  /** Renderers keyed by an extension inline node `type` (e.g. `citation-group`). */
  inlineRenderers?: Record<string, InlineExtensionRenderer>
  /**
   * Static-mode block renderers, keyed by core block node `type`. Consulted
   * only when an HTML render runs with `mode: "static"`, taking precedence over
   * {@link blockRenderers} for that node. An extension that is already static
   * (its interactive output needs no client script) may omit these and let the
   * normal renderer run. Return `undefined` to defer (to the next extension,
   * then the normal renderer, then the core caption floor). The
   * {@link BlockExtensionRenderContext} carries `mode` and `renderers` so a
   * static renderer can fall back to source when its build renderer is absent.
   */
  staticBlockRenderers?: Record<string, BlockExtensionRenderer>
  /** Static-mode inline renderers, keyed by inline node `type`. The inline
   *  twin of {@link staticBlockRenderers}. */
  staticInlineRenderers?: Record<string, InlineExtensionRenderer>
}
