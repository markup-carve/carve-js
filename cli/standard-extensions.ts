// C2-T-010: `--extensions` and `--extension-options` name the standard extensions of data/extensions.json.
import catalog from '../data/extensions.json' with { type: 'json' }
import { type DocumentTransform, type ExtensionDefinition, type ExtensionRenderer } from '../src/index.ts'
import { type ExtensionBundle } from '../src/extensions/standard/bundle.ts'
import { citations, citeExtension } from '../src/extensions/citations.ts'
import { codeGroup } from '../src/extensions/standard/code-group.ts'
import { detailsExtension, spoilerExtensions } from '../src/extensions/standard/details.ts'
import { mermaid } from '../src/extensions/standard/fenced-render.ts'
import { mathBlock } from '../src/extensions/standard/math-block.ts'
import { standardTabsRenderer, tabsExtensions } from '../src/extensions/tabs.ts'
import { wikiExtension } from '../src/extensions/wiki-cite.ts'
import { details } from '../extensions/blocks/details.ts'
import { createImgFence } from '../extensions/blocks/img-fence.ts'
import { spoiler } from '../extensions/blocks/spoiler.ts'
import { wikilinks } from '../extensions/inline/wikilinks.ts'
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

function imgFence(name: string): Standard {
  const pick = (bundle: ExtensionBundle): ExtensionBundle => ({
    extensions: bundle.extensions.filter((entry) => entry.name === name),
    renderers: Object.fromEntries(Object.entries(bundle.renderers).filter(([key]) => key === name)),
  })
  return { definitions: pick(createImgFence()).extensions, render: () => pick(createImgFence({}, true)) }
}

const STANDARD: ReadonlyMap<string, Standard> = new Map<string, Standard>([
  ['carve.cite', { definitions: [citeExtension], render: () => citations() }],
  ['carve.codeGroup', { definitions: codeGroup().extensions, render: () => codeGroup() }],
  ['carve.details', rendered([detailsExtension], details)],
  ['carve.fencedRender.mermaid', { definitions: mermaid().extensions, render: () => mermaid() }],
  ['carve.imgFence.image', imgFence('carve.imgFence.image')],
  ['carve.imgFence.img', imgFence('carve.imgFence.img')],
  ['carve.mathBlock', { definitions: mathBlock().extensions, render: () => mathBlock() }],
  ['carve.spoiler', rendered(spoilerExtensions, spoiler)],
  ['carve.spoilerBlock', rendered(spoilerExtensions, spoiler)],
  ['carve.tab', definitionsOnly(tabsExtensions)],
  ['carve.tabs', {
    definitions: tabsExtensions,
    render: (options) => ({ extensions: tabsExtensions, renderers: { 'carve.tabs': standardTabsRenderer(options) } }),
  }],
  ['carve.wiki', rendered([wikiExtension], wikilinks)],
])

/** The renderer options each standard extension takes: the `rendererOptions` of its row, each with its values. */
const RENDERER_OPTIONS: ReadonlyMap<string, Readonly<Record<string, { values: readonly string[] }>>> = new Map(
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

/** The renderer options of one listed extension, each one its row names with a value the row allows. */
function checkedOptions(name: string, options: unknown, names: readonly string[]): Options {
  const known = RENDERER_OPTIONS.get(name)
  if (known === undefined) throw new UsageError(`${name} is no standard extension`)
  if (!names.includes(name)) throw new UsageError(`--extension-options names ${name}, which --extensions does not list`)
  if (!isRecord(options)) throw new UsageError(`the options of ${name} are not a JSON object`)
  for (const [key, option] of Object.entries(options)) {
    const row = Object.hasOwn(known, key) ? known[key] : undefined
    if (row === undefined) throw new UsageError(`${name} has no option ${key}`)
    if (typeof option !== 'string' || !row.values.includes(option)) throw new UsageError(`bad value for the option ${key} of ${name}`)
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
