import type { Attrs, CodeBlock } from './ast.js'
import type { CarveExtension } from './extension.js'
import { sanitizeSvg, type SanitizeSvgOptions } from './svg-sanitize.js'

/** Options for the {@link imgFence} factory. Extends the sanitizer options, so
 *  `allowStyle` / `allowLinks` / `allowAnimation` / `allowExternalImages` flow
 *  straight through. */
export interface ImgFenceOptions extends SanitizeSvgOptions {
  /** Fence info word(s) this instance claims. Default `['img', 'image']`. */
  language?: string | string[]
  /**
   * Permit **inline** rendering (a live `<svg>` in the page DOM) for fences that
   * carry an `{inline}` attribute. Default `false`: every fence is rendered in
   * the browser-sandboxed `data:image/svg+xml` `<img>` mode, and `{inline}` is
   * ignored.
   *
   * ⚠️ SECURITY: inline mode injects live SVG into the DOM, where the only thing
   * standing between a hostile SVG and script execution is this extension's
   * hand-rolled sanitizer — NOT a browser-grade parser. It is suitable for
   * TRUSTED author content, but is not a hardened XSS boundary for
   * attacker-controlled input (parser-differential / mutation-XSS cannot be
   * ruled out for a string sanitizer). For untrusted input, leave this `false`
   * so everything stays sandboxed, or post-process inline output with a
   * browser-based sanitizer (e.g. DOMPurify's SVG profile).
   *
   * This is a HOST decision on purpose: the fence body and its attributes come
   * from the same author, so a per-fence `{inline}` alone must never be able to
   * self-elevate out of the sandbox — only the host, by setting this, opts in.
   */
  allowInline?: boolean
}

// Fence attributes the extension consumes rather than emitting: the inline mode
// flag, the `alt` text, and the now-redundant `sandbox` marker (sandbox is the
// default; kept consumed so an explicit `{sandbox}` doesn't leak as an attribute).
const CONSUMED_KEYS = new Set(['inline', 'alt', 'sandbox'])

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
 * Two emit modes, **sandbox by default**:
 *
 * - **sandbox (default):** the sanitized SVG is encoded into a
 *   `data:image/svg+xml` URI on an `<img>`, which the browser sandboxes — no
 *   script, no fetch, no DOM leakage — regardless of the sanitizer. This is the
 *   safe path for untrusted input. `{alt=…}` sets the alt text.
 *
 *       ```img
 *       <svg viewBox="0 0 24 24"><path d="…"/></svg>
 *       ```
 *
 * - **inline (opt-in):** with `imgFence({ allowInline: true })`, a fence marked
 *   `{inline}` renders a live `<svg>` in the DOM, so `currentColor`, CSS classes
 *   and dark-mode apply. See the ⚠️ security note on {@link ImgFenceOptions.allowInline}
 *   — this is for TRUSTED content. Without `allowInline`, `{inline}` is ignored
 *   and the fence stays sandboxed.
 *
 *       // host: imgFence({ allowInline: true })
 *       {inline}
 *       ```img
 *       <svg viewBox="0 0 24 24"><path d="…" fill="currentColor"/></svg>
 *       ```
 *
 * The sanitizer ({@link sanitizeSvg}) drops `<script>`, `<foreignObject>`,
 * event handlers, `javascript:`/external URLs and active CSS. A body that is
 * not a single `<svg>` root degrades to an escaped code block.
 *
 * Author `{#id .class}` on the fence merge onto the `<img>` (sandbox) or the
 * root `<svg>` (inline), hardened by the core `ctx.renderAttrs` and — for inline
 * — re-run through the SVG sanitizer.
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
      const cleanAttrs = authorAttrs(code.attrs)
      // Inline is a HOST capability: the `{inline}` fence flag only takes effect
      // when the host opted in with `allowInline`. Otherwise (the default, and
      // the safe posture for untrusted input) the fence is sandboxed and
      // `{inline}` is ignored — an author cannot self-elevate out of the sandbox.
      const inline = opts.allowInline === true && consumedValue(code.attrs, 'inline') !== undefined

      if (!inline) {
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
