import type { Attrs, Extension, InlineNode } from './ast.js'
import type { CarveExtension, ExtensionRenderContext } from './extension.js'

/**
 * Inline color swatch. Tier-3, the standard `color` extension from the spec's
 * Extension Registry.
 *
 * `:color[value]` renders a small color chip followed by the color value when
 * the value is in the injection-proof safe subset. Unknown / invalid values
 * defer to the generic extension fallback (`<span class="ext-color">...`).
 */
export function colorSwatch(): CarveExtension {
  return {
    name: 'color',
    renderers: {
      color: (node: Extension, ctx: ExtensionRenderContext): string | undefined => {
        const value = safeColor(inlineText(node.content))
        if (value === null) return undefined
        const attrs: Attrs = withBaseClass(node.attrs, 'swatch')
        return (
          `<span${ctx.renderAttrs(attrs)}>` +
          `<span class="swatch-chip" style="background-color:${ctx.escapeAttr(value)}"></span> ` +
          `${ctx.escapeHtml(value)}</span>`
        )
      },
    },
  }
}

function safeColor(s: string): string | null {
  const value = s.trim()
  if (/^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value)) {
    return value
  }
  // rgb()/hsl(): only safe chars inside, and at least one digit (rejects
  // `rgb(/)` / empty args). Author never escapes; the value cannot break out.
  if (/^(rgb|rgba|hsl|hsla)\([0-9.,%\s/]*[0-9][0-9.,%\s/]*\)$/.test(value)) {
    return value
  }
  // A bare CSS keyword is passed through: the browser renders known names and
  // harmlessly ignores an unknown one (no `; { } : " '` -> cannot inject). We
  // deliberately do not ship a 148-name allowlist in three languages.
  if (/^[a-zA-Z]+$/.test(value)) {
    return value
  }
  return null
}

/** Merge a base class ahead of the author classes (a fresh Attrs copy). */
function withBaseClass(attrs: Attrs | undefined, base: string): Attrs {
  const a: Attrs = attrs ? { ...attrs } : {}
  a.classes = [base, ...(a.classes ?? [])]
  return a
}

/** Flatten an inline tree to its text content. */
function inlineText(nodes: InlineNode[]): string {
  let s = ''
  for (const node of nodes) {
    const n = node as unknown as Record<string, unknown>
    if (typeof n.value === 'string') s += n.value
    if (typeof n.name === 'string' && n.type === 'tag') s += `#${n.name}`
    const kids = n.children ?? n.content
    if (Array.isArray(kids)) s += inlineText(kids as InlineNode[])
  }
  return s
}
