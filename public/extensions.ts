/**
 * The provisional standard extensions (`@markup-carve/carve/extensions`, spec/0.2/extensions.md). The core entry never
 * loads them; a host registers each one it wants through the `extensions` and `renderers` options.
 */
export { type ExtensionBundle, withExtensions } from '../src/extensions/standard/bundle.ts'
export {
  abc, chart, d2, type DiagramBuilder, fencedRender, fencedRenderName, type FencedRenderContentMode, type FencedRenderOptions,
  graphviz, mermaid, plantuml, type PresetBuilders, type PresetOptions, presets, vegaLite, wavedrom,
} from '../src/extensions/standard/fenced-render.ts'
export { mathBlock, type MathBlockOptions } from '../src/extensions/standard/math-block.ts'
export { detailsExtension, spoilerExtension, spoilerBlockExtension, spoilerExtensions } from '../src/extensions/standard/details.ts'
export { standardTabsRenderer } from '../src/extensions/tabs.ts'
export { codeGroup, type CodeGroupOptions } from '../src/extensions/standard/code-group.ts'
export { codeCallouts } from '../src/extensions/standard/code-callouts.ts'
export { imgFence, imgFenceExtensions } from '../extensions/blocks/img-fence.ts'
import { imgFence } from '../extensions/blocks/img-fence.ts'
export const imgFenceRenderers = imgFence().renderers
export { sanitizeSvg, type SanitizeSvgOptions, type SanitizeResult } from '../extensions/blocks/svg-sanitize.ts'
export { details } from '../extensions/blocks/details.ts'
export { spoiler } from '../extensions/blocks/spoiler.ts'
export { listTable } from '../extensions/blocks/list-table.ts'
export { colorSwatch, type ColorSwatchOptions, type SwatchPosition, type SwatchShape } from '../extensions/inline/color-swatch.ts'
export { semanticSpan } from '../extensions/inline/semantic-span.ts'
export { wikilinks, type WikilinksOptions } from '../extensions/inline/wikilinks.ts'
export {
  isSmartQuoteLocaleSupported, type QuoteCharacters, SMART_QUOTE_LOCALES, smartQuoteLocales, smartQuotes, type SmartQuotesOptions,
} from '../extensions/inline/smart-quotes.ts'
export { defaultAttributes, type DefaultAttributesMap } from '../extensions/transforms/default-attributes.ts'
export { tabNormalize } from '../extensions/transforms/tab-normalize.ts'
export { inlineFootnotesToParentheses } from '../extensions/transforms/inline-footnotes.ts'
export { glossary, glossaryExtension, glossaryRenderer, termExtension, termRenderer } from '../src/extensions/glossary.ts'
export { index, indexExtension, indexRenderer, type IndexOptions, indexTermExtension, indexTermRenderer } from '../src/extensions/index-terms.ts'
export {
  citations, type CitationsOptions, citeExtension, type CslEntry, type CslName, referencesExtension, referencesRenderer,
} from '../src/extensions/citations.ts'
export { type TableOfContentsOptions, tableOfContents, tocPlacement, tocRenderers } from '../src/extensions/navigation/toc.ts'
export {
  headingNumbers, type HeadingNumbersOptions, headingPermalinks, type HeadingPermalinksOptions, headingReference,
  type HeadingReferenceOptions,
} from '../src/extensions/navigation/headings.ts'
export {
  autolink, type AutolinkOptions, externalLinks, type ExternalLinksOptions, linkPolicy, type LinkPolicyOptions,
} from '../src/extensions/navigation/links.ts'
