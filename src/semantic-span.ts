import type { CarveExtension, ExtensionRenderer } from './extension.js'
import { EXTENDED_SEMANTIC_SPAN_ORDER } from './render-html.js'

/**
 * The four semantic span names core does not reserve, plus the deprecated
 * `:name[…]` spelling for all seven (spec PART 9 §10, docs/extensions.md §11).
 *
 * Core reserves `abbr`, `time` and `kbd` as span attributes: the first two
 * carry data the author would otherwise lose, and the third is the one name
 * every comparable system ships. `samp`, `var`, `cite` and `dfn` carry no data
 * and collide with no core clause, so they are opt-in - a core processor leaves
 * them as ordinary attributes (`<span samp="">x</span>`).
 *
 *     [x]{samp}                      ->  <samp>x</samp>
 *     [CSS]{dfn="Cascading Style…"}  ->  <dfn title="Cascading Style…">CSS</dfn>
 *
 * THE `:name[…]` SPELLING IS SOFT-DEPRECATED HERE, not revived. It was released
 * behavior in this package and in carve-rs, so removing it outright would break
 * documents that shipped; it is scheduled for removal in 0.2. Write the span
 * attribute instead - it is the only spelling that can express a combination,
 * since `:dfn[:abbr[CSS]]` does not nest while `[CSS]{dfn abbr="…"}` does.
 *
 * @example
 * carveToHtml(src, { extensions: [semanticSpan()] })
 */
export function semanticSpan(): CarveExtension {
  const deprecatedSpelling = (name: string): ExtensionRenderer =>
    (node, ctx) => `<${name}${ctx.renderAttrs(node.attrs)}>${ctx.renderInlines(node.content)}</${name}>`

  const renderers: Record<string, ExtensionRenderer> = {}
  for (const name of EXTENDED_SEMANTIC_SPAN_ORDER) renderers[name] = deprecatedSpelling(name)

  return {
    name: 'semantic-span',
    // The span half is declarative: core owns the nesting order, the value
    // mapping and the riding rule, and this names the four it adds.
    semanticSpanNames: ['samp', 'var', 'cite', 'dfn'],
    renderers,
  }
}
