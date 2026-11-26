// C2-T-010: `--extensions` and `--extension-options` name the standard extensions of data/extensions.json.
import catalog from '../data/extensions.json' with { type: 'json' }
import { type DocumentTransform, type ExtensionDefinition, type ExtensionRenderer } from '../src/index.ts'
import { type ExtensionBundle } from '../src/extensions/standard/bundle.ts'
import { type CitationsOptions, citations, citeExtension } from '../src/extensions/citations.ts'
import { glossary, termExtension, termRenderer } from '../src/extensions/glossary.ts'
import { index, indexTermExtension, indexTermRenderer } from '../src/extensions/index-terms.ts'
import { headingNumbers, headingPermalinks, headingReference } from '../src/extensions/navigation/headings.ts'
import { autolink, externalLinks } from '../src/extensions/navigation/links.ts'
import { tableOfContents, tocPlacement, tocRenderers } from '../src/extensions/navigation/toc.ts'
import { codeCallouts } from '../src/extensions/standard/code-callouts.ts'
import { codeGroup } from '../src/extensions/standard/code-group.ts'
import { detailsExtension, spoilerExtensions } from '../src/extensions/standard/details.ts'
import { abc, chart, d2, graphviz, mermaid, plantuml, vegaLite, wavedrom } from '../src/extensions/standard/fenced-render.ts'
import { mathBlock } from '../src/extensions/standard/math-block.ts'
import { standardTabsRenderer, tabsExtensions } from '../src/extensions/tabs.ts'
import { wikiExtension } from '../src/extensions/wiki-cite.ts'
import { details } from '../extensions/blocks/details.ts'
import { createImgFence } from '../extensions/blocks/img-fence.ts'
import { listTable } from '../extensions/blocks/list-table.ts'
import { spoiler } from '../extensions/blocks/spoiler.ts'
import { colorSwatch } from '../extensions/inline/color-swatch.ts'
import { semanticSpan } from '../extensions/inline/semantic-span.ts'
import { smartQuotes } from '../extensions/inline/smart-quotes.ts'
import { wikilinks } from '../extensions/inline/wikilinks.ts'
import { tabNormalize } from '../extensions/transforms/tab-normalize.ts'
import { UsageError } from './flags.ts'

type Options = Record<string, unknown>

interface Standard {
  /** The definitions registered on every command; a name brings the names it cannot stand without (C2-X-039, C2-X-064). */
  definitions: readonly ExtensionDefinition[]
  /** The registration of `render`, with the standard renderer and its options. */
  render: (options: Options) => ExtensionBundle
}

function definitionsOnly(definitions: readonly ExtensionDefinition[]): Standard {
  return { definitions, render: () => ({ extensions: definitions, renderers: {} }) }
}

/** The catalog's definitions on every command, so `ast` and `render --from-ast` read one tree; the bundle gives the renderers. */
function rendered(definitions: readonly ExtensionDefinition[], bundle: () => ExtensionBundle): Standard {
  return { definitions, render: () => ({ extensions: definitions, renderers: bundle().renderers }) }
}

/** A bundle built with the command's options on `render`, its definitions on every command. */
function bundled(make: (options: Options) => ExtensionBundle): Standard {
  return { definitions: make({}).extensions, render: make }
}

/** A definition with its renderer, if any; a document transform in the definition runs on `render` (C2-X-072). */
function single(definition: ExtensionDefinition, renderer?: ExtensionRenderer): Standard {
  const renderers = renderer === undefined ? {} : { [definition.name]: renderer }
  return { definitions: [definition], render: () => ({ extensions: [definition], renderers }) }
}

/** The one extension `name` of a bundle that claims several. */
function pick(bundle: ExtensionBundle, name: string): ExtensionBundle {
  return {
    extensions: bundle.extensions.filter((entry) => entry.name === name),
    renderers: Object.fromEntries(Object.entries(bundle.renderers).filter(([key]) => key === name)),
  }
}

/** One fence word of a diagram preset (C2-X-071). */
function fence(preset: () => ExtensionBundle, word: string): Standard {
  const name = `carve.fencedRender.${word}`
  return { definitions: pick(preset(), name).extensions, render: () => pick(preset(), name) }
}

function imgFence(name: string): Standard {
  return { definitions: pick(createImgFence(), name).extensions, render: () => pick(createImgFence({}, true), name) }
}

const STANDARD: ReadonlyMap<string, Standard> = new Map<string, Standard>([
  ['carve.autolink', single(autolink())],
  ['carve.cite', { definitions: [citeExtension], render: (options) => citations(options as CitationsOptions) }],
  ['carve.codeCallouts', bundled(codeCallouts)],
  ['carve.codeGroup', { definitions: codeGroup().extensions, render: () => codeGroup() }],
  ['carve.colorSwatch', bundled(() => colorSwatch())],
  ['carve.details', rendered([detailsExtension], details)],
  ['carve.externalLinks', single(externalLinks())],
  ['carve.fencedRender.abc', fence(abc, 'abc')],
  ['carve.fencedRender.chart', fence(chart, 'chart')],
  ['carve.fencedRender.d2', fence(d2, 'd2')],
  ['carve.fencedRender.dot', fence(graphviz, 'dot')],
  ['carve.fencedRender.graphviz', fence(graphviz, 'graphviz')],
  ['carve.fencedRender.mermaid', { definitions: mermaid().extensions, render: () => mermaid() }],
  ['carve.fencedRender.plantuml', fence(plantuml, 'plantuml')],
  ['carve.fencedRender.puml', fence(plantuml, 'puml')],
  ['carve.fencedRender.vega-lite', fence(vegaLite, 'vega-lite')],
  ['carve.fencedRender.wavedrom', fence(wavedrom, 'wavedrom')],
  // C2-X-072: a glossary brings its terms, an index its markers.
  ['carve.glossary', bundled(glossary)],
  ['carve.headingNumbers', single(headingNumbers())],
  ['carve.headingPermalinks', single(headingPermalinks())],
  ['carve.headingReference', single(headingReference())],
  ['carve.imgFence.image', imgFence('carve.imgFence.image')],
  ['carve.imgFence.img', imgFence('carve.imgFence.img')],
  ['carve.index', bundled(() => index())],
  ['carve.indexTerm', single(indexTermExtension, indexTermRenderer)],
  ['carve.listTable', bundled(listTable)],
  ['carve.mathBlock', { definitions: mathBlock().extensions, render: () => mathBlock() }],
  ['carve.semanticSpan', bundled(semanticSpan)],
  ['carve.smartQuotes', bundled((options) => smartQuotes(options))],
  ['carve.spoiler', rendered(spoilerExtensions, spoiler)],
  ['carve.spoilerBlock', rendered(spoilerExtensions, spoiler)],
  ['carve.tab', definitionsOnly(tabsExtensions)],
  ['carve.tabNormalize', bundled(() => tabNormalize())],
  ['carve.tabs', {
    definitions: tabsExtensions,
    render: (options) => ({ extensions: tabsExtensions, renderers: { 'carve.tabs': standardTabsRenderer(options) } }),
  }],
  ['carve.term', single(termExtension, termRenderer)],
  ['carve.toc', single(tableOfContents(), tocRenderers['carve.toc'])],
  ['carve.tocPlacement', single(tocPlacement(), tocRenderers['carve.tocPlacement'])],
  ['carve.wiki', rendered([wikiExtension], wikilinks)],
])

/** The renderer options each standard extension takes: the `rendererOptions` of its row, each with its values. */
const RENDERER_OPTIONS: ReadonlyMap<string, Readonly<Record<string, { values: readonly string[], open?: boolean }>>> = new Map(
  catalog.extensions.map((entry) => [entry.name, 'rendererOptions' in entry ? entry.rendererOptions : {}]))

// The catalog and the table above name the same extensions; a pin that adds one fails here, not at a user's command.
for (const name of new Set([...STANDARD.keys(), ...RENDERER_OPTIONS.keys()])) {
  if (!STANDARD.has(name) || !RENDERER_OPTIONS.has(name)) throw new Error(`${name} is not in both the catalog and the CLI table`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The names of `--extensions`, refused with `usage` where one is no standard extension (C2-T-010). */
export function extensionNames(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((name) => typeof name === 'string')) {
    throw new UsageError('--extensions takes a JSON list of standard extension names')
  }
  for (const name of value) if (!STANDARD.has(name)) throw new UsageError(`${name} is no standard extension`)
  return [...new Set(value)]
}

/** The renderer options of one listed extension: each one its row names, with a value the row allows or, where it is open, any string. */
function checkedOptions(name: string, options: unknown, names: readonly string[]): Options {
  const known = RENDERER_OPTIONS.get(name)
  if (known === undefined) throw new UsageError(`${name} is no standard extension`)
  if (!names.includes(name)) throw new UsageError(`--extension-options names ${name}, which --extensions does not list`)
  if (!isRecord(options)) throw new UsageError(`the options of ${name} are not a JSON object`)
  for (const [key, option] of Object.entries(options)) {
    const row = Object.hasOwn(known, key) ? known[key] : undefined
    if (row === undefined) throw new UsageError(`${name} has no option ${key}`)
    if (typeof option !== 'string' || (row.open !== true && !row.values.includes(option))) {
      throw new UsageError(`bad value for the option ${key} of ${name}`)
    }
  }
  return options
}

/** The options of `--extension-options`, keyed by a standard extension that `--extensions` lists. */
export function extensionOptions(value: unknown, names: readonly string[]): ReadonlyMap<string, Options> {
  if (value === undefined) return new Map()
  if (!isRecord(value)) throw new UsageError('--extension-options takes a JSON object keyed by extension name')
  return new Map(Object.entries(value).map(([name, options]) => [name, checkedOptions(name, options, names)]))
}

export interface Registration {
  extensions: ExtensionDefinition[]
  renderers: Record<string, ExtensionRenderer>
  transforms: DocumentTransform[]
}

/** Each listed extension once, in the order of the list; `render` adds the standard renderers and their transforms. */
export function registration(names: readonly string[], options: ReadonlyMap<string, Options>, render: boolean): Registration {
  const result: Registration = { extensions: [], renderers: {}, transforms: [] }
  const seen = new Set<string>()
  for (const name of names) {
    const standard = STANDARD.get(name)
    if (standard === undefined) continue
    const bundle = render ? standard.render(options.get(name) ?? {}) : { extensions: standard.definitions, renderers: {} }
    for (const definition of bundle.extensions) {
      if (seen.has(definition.name)) continue
      seen.add(definition.name)
      result.extensions.push(definition)
    }
    Object.assign(result.renderers, bundle.renderers)
    result.transforms.push(...(bundle.transforms ?? []))
  }
  return result
}
