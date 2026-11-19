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
export { codeGroup, type CodeGroupOptions } from '../src/extensions/standard/code-group.ts'
export { codeCallouts } from '../src/extensions/standard/code-callouts.ts'
