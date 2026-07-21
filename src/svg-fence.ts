import type { Attrs, CodeBlock } from './ast.js'
import type { CarveExtension } from './extension.js'
import { sanitizeSvg, type SanitizeSvgOptions } from './svg-sanitize.js'

/** Options for the {@link imgFence} factory. Extends the sanitizer options, so
 *  `allowStyle` / `allowLinks` / `allowAnimation` / `allowExternalImages` flow
 *  straight through. */
export interface ImgFenceOptions extends SanitizeSvgOptions {
  /** Fence info word(s) this instance claims. Default `['img', 'image']`. */
  language?: string | string[]
}

// Fence attributes the extension consumes rather than emitting: the mode flag
// and the sandbox `alt` text.
const CONSUMED_KEYS = new Set(['sandbox', 'alt'])

// Case-insensitive lookup of a consumed key in a keyValues map, matching how
// authorAttrs() strips them — so `{Sandbox}` / `{ALT=…}` are honored, not
// silently dropped.
function consumedValue(attrs: Attrs | undefined, key: string): string | undefined {
  const kv = attrs?.keyValues
  if (!kv) return undefined
  for (const [k, v] of Object.entries(kv)) {
    if (k.toLowerCase() === key) return v
  }
  return undefined
}

// A copy of the fence attrs with the consumed keys removed, so `{sandbox}` and
// `{alt=…}` never render as literal attributes on the output element.
function authorAttrs(attrs: Attrs | undefined): Attrs | undefined {
  if (!attrs?.keyValues) return attrs
  const keyValues: Record<string, string> = {}
  for (const [k, v] of Object.entries(attrs.keyValues)) {
    if (!CONSUMED_KEYS.has(k.toLowerCase())) keyValues[k] = v
  }
  const cleaned: Attrs = { ...attrs, keyValues }
  if (attrs.order) cleaned.order = attrs.order.filter((o) => !CONSUMED_KEYS.has(o.toLowerCase()))
  return cleaned
}

// Drop the named keys (case-insensitive) from an Attrs' keyValues + order.
function stripKeys(attrs: Attrs | undefined, keys: string[]): Attrs | undefined {
  if (!attrs?.keyValues) return attrs
  const drop = new Set(keys.map((k) => k.toLowerCase()))
  const keyValues: Record<string, string> = {}
  for (const [k, v] of Object.entries(attrs.keyValues)) {
    if (!drop.has(k.toLowerCase())) keyValues[k] = v
  }
  const cleaned: Attrs = { ...attrs, keyValues }
  if (attrs.order) cleaned.order = attrs.order.filter((o) => !drop.has(o.toLowerCase()))
  return cleaned
}

// Splice a rendered attr string (` id="…" class="…"`) into the root <svg> tag.
// The fence attributes win: any attribute the fence sets is first removed from
// the sanitized root so the merge never emits a duplicate attribute (invalid
// HTML/SVG). Attributes only the root has are preserved.
function mergeIntoRoot(svg: string, attrStr: string): string {
  if (attrStr === '') return svg
  const fenceNames = [...attrStr.matchAll(/\s([A-Za-z_:][\w:.-]*)\s*=/g)].map((mm) => mm[1].toLowerCase())
  // Match the root tag quote-aware so a `>` inside a quoted attribute value
  // (e.g. aria-label="1>2") is not mistaken for the tag's end.
  return svg.replace(/^<svg((?:"[^"]*"|'[^']*'|[^>])*?)(\/?)>/i, (_full, rootAttrs: string, slash: string) => {
    let cleaned = rootAttrs
    for (const name of fenceNames) {
      const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      cleaned = cleaned.replace(new RegExp(`\\s${esc}\\s*=\\s*("[^"]*"|'[^']*'|[^\\s>]+)`, 'i'), '')
    }
    return `<svg${attrStr}${cleaned}${slash}>`
  })
}

// A self-contained escaped code-block fallback, mirroring FencedRender's
// degradation: never blank, never raw.
function sourceFallback(code: CodeBlock, ctx: { indent(l: number): string; escapeHtml(s: string): string; level: number }): string {
  const pad = ctx.indent(ctx.level)
  const langAttr = code.lang ? ` class="language-${code.lang}"` : ''
  return `${pad}<pre><code${langAttr}>${ctx.escapeHtml(code.content)}\n</code></pre>`
}

/**
 * SVG `img` fence (Tier-3, ships off). Claims fenced blocks whose info word is
 * `img` (alias `image`) and renders the SVG **body** — sanitized — rather than
 * showing it as verbatim source. `svg` / `xml` are deliberately NOT claimed, so
 * an author can still syntax-highlight SVG source with those words.
 *
 * Two emit modes:
 *
 * - **inline (default):** the sanitized `<svg>` goes straight into the DOM, so
 *   `currentColor`, CSS classes and dark-mode all apply.
 *
 *       ```img
 *       <svg viewBox="0 0 24 24"><path d="…" fill="currentColor"/></svg>
 *       ```
 *
 * - **sandbox:** a `{sandbox}` boolean fence attribute encodes the sanitized
 *   SVG into a `data:image/svg+xml` URI on an `<img>`, which the browser
 *   sandboxes (no script, no fetch, no DOM leakage). `{alt=…}` sets the alt.
 *
 *       ```img {sandbox alt="a logo"}
 *       <svg …>…</svg>
 *       ```
 *
 * The sanitizer ({@link sanitizeSvg}) drops `<script>`, `<foreignObject>`,
 * event handlers, `javascript:`/external URLs and active CSS. A body that is
 * not a single `<svg>` root degrades to an escaped code block.
 *
 * Author `{#id .class}` on the fence merge onto the root `<svg>` (inline) or the
 * `<img>` (sandbox), hardened by the core `ctx.renderAttrs`.
 */
export function imgFence(opts: ImgFenceOptions = {}): CarveExtension {
  const languages = (Array.isArray(opts.language) ? opts.language : opts.language ? [opts.language] : ['img', 'image']).filter(
    (w) => w !== '',
  )
  if (languages.length === 0) {
    throw new Error('imgFence requires at least one non-empty language word')
  }

  const render: CarveExtension['blockRenderers'] = {
    'code-block': (node, ctx) => {
      const code = node as CodeBlock
      if (!languages.includes(code.lang ?? '')) return undefined

      const { svg, ok } = sanitizeSvg(code.content, opts)
      if (!ok) return sourceFallback(code, ctx)

      const pad = ctx.indent(ctx.level)
      const sandbox = consumedValue(code.attrs, 'sandbox') !== undefined
      const cleanAttrs = authorAttrs(code.attrs)

      if (sandbox) {
        const alt = consumedValue(code.attrs, 'alt') ?? ''
        const src = `data:image/svg+xml,${encodeURIComponent(svg)}`
        // Sandbox mode promises no fetches: drop any author source-selection
        // attribute (`src`, `srcset`) so it cannot override the sanitized data
        // URI with an external resource.
        const imgAttrs = stripKeys(cleanAttrs, ['src', 'srcset'])
        return `${pad}<img src="${ctx.escapeAttr(src)}" alt="${ctx.escapeAttr(alt)}"${ctx.renderAttrs(imgAttrs)}>`
      }
      const fenceAttrs = ctx.renderAttrs(cleanAttrs)
      if (fenceAttrs === '') return `${pad}${svg}`
      // Fence attributes land on the root <svg>, so they must clear the SAME
      // SVG-specific scrub as the body — otherwise a `{fill="url(https://…)"}`
      // would reintroduce a remote fetch the sanitizer just removed. Splice them
      // onto the root, then re-sanitize (idempotent for the already-clean body).
      const merged = sanitizeSvg(mergeIntoRoot(svg, fenceAttrs), opts)
      return merged.ok ? `${pad}${merged.svg}` : sourceFallback(code, ctx)
    },
  }

  return {
    name: 'img-fence',
    blockRenderers: render,
    // Inline SVG needs no client script — the interactive output is already
    // static, so the static render is byte-identical.
    staticBlockRenderers: render,
  }
}
