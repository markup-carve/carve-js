import type { CarveExtension, ExtensionRenderer } from './extension.js'
import { EXTENDED_SEMANTIC_SPAN_ORDER } from './render-html.js'

/**
 * The four semantic span names core does not reserve, plus the deprecated
 * `:name[…]` spelling for all seven (spec PART 9 §10, docs/extensions.md §11).
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
