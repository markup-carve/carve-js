import type { Attrs, CodeBlock } from './ast.js'
import type { CarveExtension } from './extension.js'

/** Options for the {@link mermaid} extension. */
export interface MermaidOptions {
  /** CSS class Mermaid.js detects. Default `'mermaid'`. */
  cssClass?: string
  /** Language tag that marks a diagram block. Default `'mermaid'`. */
  language?: string
}

// Escape for Mermaid content: encode `&` and `<` but keep `>` so arrow syntax
// (`A-->B`) survives, matching carve-php's MermaidExtension.
function escapeMermaid(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
}

/**
 * Render fenced code blocks tagged `mermaid` as `<pre class="mermaid">…</pre>`
 * for client-side Mermaid.js, instead of the default `<pre><code>`. Ported
 * from carve-php's MermaidExtension.
 *
 *     ``` mermaid
 *     graph TD; A-->B
 *     ```
 *
 * renders as `<pre class="mermaid">graph TD; A-->B</pre>` (`>` kept for arrows).
 * A non-mermaid code block defers to the core renderer.
 */
export function mermaid(opts: MermaidOptions = {}): CarveExtension {
  const cssClass = opts.cssClass ?? 'mermaid'
  const language = opts.language ?? 'mermaid'
  return {
    name: 'mermaid',
    blockRenderers: {
      'code-block': (node, ctx) => {
        const code = node as CodeBlock
        if (code.lang !== language) return undefined
        // Preserve the block's own attributes (and their source order) and
        // merge the mermaid class into the class group.
        const attrs: Attrs = {
          ...code.attrs,
          classes: [cssClass, ...(code.attrs?.classes ?? [])],
        }
        return `${ctx.indent(ctx.level)}<pre${ctx.renderAttrs(attrs)}>${escapeMermaid(code.content)}</pre>`
      },
    },
  }
}
