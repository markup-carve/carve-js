// Source to HTML with the bundled extensions: core alone, each extension alone and all of them together,
// on one generated document that every extension finds work in, at several sizes. One process, a warm-up,
// then the median of the runs, in CPU time of the main thread, which a loaded machine distorts less than wall time.
// The last column of each row is the growth from the second-largest to the largest size.
//   node scripts/bench-extensions.ts [--sizes 2,8,32,128] [--runs 30] [--only core,all,glossary]
import { cpus, loadavg } from 'node:os'
import { fileURLToPath } from 'node:url'
import { render, renderWithDocumentTransforms, type RenderOptions } from '../src/index.ts'
import { type DocumentTransform } from '../src/api.ts'
import { type ExtensionDefinition, type ExtensionRenderer } from '../src/extensions/types.ts'
import {
  autolink, citations, codeCallouts, codeGroup, colorSwatch, defaultAttributes, details, externalLinks, glossary,
  headingNumbers, headingPermalinks, headingReference, index, inlineFootnotesToParentheses,
  linkPolicy, listTable, mathBlock, mermaid, semanticSpan, smartQuotes, spoiler, tabNormalize, tableOfContents,
  tocPlacement, tocRenderers, wikilinks,
} from '../public/extensions.ts'

function option(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`)
  return at >= 0 && at + 1 < process.argv.length ? process.argv[at + 1]! : fallback
}

const sizes = option('sizes', '2,8,32,128').split(',').map(Number)
const runs = Number(option('runs', '30'))
const only = option('only', '').split(',').filter((name) => name !== '')

interface Registration {
  extensions: readonly ExtensionDefinition[]
  renderers: Readonly<Record<string, ExtensionRenderer>>
  transforms: readonly DocumentTransform[]
}

type Built = ExtensionDefinition | { extensions: readonly ExtensionDefinition[], renderers: Readonly<Record<string, ExtensionRenderer>>,
  transforms?: readonly DocumentTransform[] }

function registration(built: Built, renderers: Readonly<Record<string, ExtensionRenderer>> = {}): Registration {
  if ('name' in built) return { extensions: [built], renderers, transforms: [] }
  return { extensions: built.extensions, renderers: { ...built.renderers, ...renderers }, transforms: built.transforms ?? [] }
}

const CONFIGS: readonly (readonly [string, () => Registration])[] = [
  ['mermaid', () => registration(mermaid())],
  ['mathBlock', () => registration(mathBlock())],
  ['codeGroup', () => registration(codeGroup())],
  ['codeCallouts', () => registration(codeCallouts())],
  ['details', () => registration(details())],
  ['spoiler', () => registration(spoiler())],
  ['listTable', () => registration(listTable())],
  ['colorSwatch', () => registration(colorSwatch())],
  ['semanticSpan', () => registration(semanticSpan())],
  ['wikilinks', () => registration(wikilinks())],
  ['smartQuotes', () => registration(smartQuotes())],
  ['defaultAttributes', () => registration(defaultAttributes({ table: { class: 'table' } }))],
  ['tabNormalize', () => registration(tabNormalize())],
  ['inlineFootnotes', () => registration(inlineFootnotesToParentheses())],
  ['glossary', () => registration(glossary())],
  ['index', () => registration(index())],
  ['citations', () => registration(citations())],
  ['tableOfContents', () => registration(tableOfContents(), tocRenderers)],
  ['tocPlacement', () => registration(tocPlacement(), tocRenderers)],
  ['headingNumbers', () => registration(headingNumbers())],
  ['headingPermalinks', () => registration(headingPermalinks())],
  ['headingReference', () => registration(headingReference())],
  ['autolink', () => registration(autolink())],
  ['externalLinks', () => registration(externalLinks())],
  ['linkPolicy', () => registration(linkPolicy())],
]

/** Every registration at once; a later registration of a name that is taken already is left out. */
export function allRegistration(): Registration {
  const extensions: ExtensionDefinition[] = []
  const renderers: Record<string, ExtensionRenderer> = {}
  const transforms: DocumentTransform[] = []
  const names = new Set<string>()
  const claims = new Set<string>()
  for (const [, build] of CONFIGS) {
    const entry = build()
    const fresh = entry.extensions.filter((definition) => !names.has(definition.name) &&
      (definition.matcher === undefined || !claims.has(`${definition.matcher.form}:${definition.matcher.name}`)))
    if (fresh.length < entry.extensions.length) continue
    for (const definition of fresh) {
      names.add(definition.name)
      if (definition.matcher !== undefined) claims.add(`${definition.matcher.form}:${definition.matcher.name}`)
    }
    extensions.push(...fresh)
    Object.assign(renderers, entry.renderers)
    transforms.push(...entry.transforms)
  }
  return { extensions, renderers, transforms }
}

function section(n: number): string {
  return `= Section ${n} {#s${n}}

Paragraph ${n} with "quotes", a :term[HTTP] use, an :index[widget ${n % 7}] entry and :cite[doe; roe]{locator="p. ${n}"}.
A link to <https://example.com/${n}>, one to [the start](#s0), a [reference][r${n}], a :wiki[Page ${n}#part|page], a :color[#ff${n % 10}0aa] swatch,
a :spoiler[secret] and see </#s${Math.max(0, n - 1)}>.[^n${n}] Plain https://example.org/${n} text and \`code\`.

[^n${n}]: Note ${n} with :index[note].

[r${n}]: https://example.net/${n}

== Detail ${n}

- item one with /emphasis/ and *strong*
- item two
  - nested :term[HTML]

\`\`\`mermaid
graph TD; A${n}-->B${n}
\`\`\`

\`\`\`math
x^${n} + y^2
\`\`\`

::: code-group
\`\`\`js [NPM]
npm i pkg${n}
\`\`\`

\`\`\`sh
yarn add pkg${n} # <1>
\`\`\`
:::

::: details "More ${n}"
Hidden text ${n}.
:::

::: list-table
- - a
  - b
- - c
  - d
:::

|= A |= B |
| ${n} | x |

`
}

const TAIL = `::: glossary
:: HTTP
: HyperText Transfer Protocol.

:: HTML
: HyperText Markup Language.
:::

::: references "References"
:: doe
: Doe, J. (2020). /A book/.

:: roe
: Roe, R. (2019). Paper.
:::

::: index "Index"
:::
`

export function documentOf(kilobytes: number): string {
  const parts: string[] = []
  let length = TAIL.length
  for (let n = 0; length < kilobytes * 1024; n++) {
    const part = section(n)
    parts.push(part)
    length += part.length
  }
  return parts.join('') + TAIL
}

function run(source: string, entry: Registration | null): string {
  if (entry === null) return render(source)
  const options: RenderOptions = { extensions: entry.extensions, renderers: entry.renderers }
  if (entry.transforms.length === 0) return render(source, options)
  return renderWithDocumentTransforms(source, entry.transforms, options).html
}

/** The CPU time of the main thread where Node.js reports it (22.18 and later), else of the process. */
function cpuMicros(): number {
  const usage = typeof process.threadCpuUsage === 'function' ? process.threadCpuUsage() : process.cpuUsage()
  return usage.user + usage.system
}

function median(source: string, entry: Registration | null): number {
  const warm = Math.max(3, Math.ceil(runs / 5))
  for (let at = 0; at < warm; at++) run(source, entry)
  const times: number[] = []
  for (let at = 0; at < runs; at++) {
    const start = cpuMicros()
    run(source, entry)
    times.push((cpuMicros() - start) / 1000)
  }
  times.sort((a, b) => a - b)
  return times[Math.floor(times.length / 2)]!
}

export function main(): void {
  const rows: [string, Registration | null][] = [['core', null],
    ...CONFIGS.map(([name, build]): [string, Registration] => [name, build()]), ['all', allRegistration()]]
  const documents = sizes.map((size) => documentOf(size))

  const load = loadavg().map((value) => value.toFixed(1)).join(' ')
  console.log(`node ${process.version}, ${cpus().length} CPUs, load ${load}, median of ${runs}`)
  const growth = sizes.length > 1 ? `growth ${sizes.at(-2)}k->${sizes.at(-1)}k` : 'growth'
  console.log(`| configuration | ${sizes.map((size) => `${size}k ms`).join(' | ')} | x core at ${sizes.at(-1)}k | ${growth} |`)
  console.log(`|---|${sizes.map(() => '---:').join('|')}|---:|---:|`)
  let core: number[] = []
  for (const [name, entry] of rows) {
    if (only.length > 0 && !only.includes(name) && name !== 'core') continue
    const times = documents.map((source) => median(source, entry))
    if (name === 'core') core = times
    const last = times.at(-1)!
    const growth = times.length > 1 ? (last / times.at(-2)!).toFixed(2) : '-'
    console.log(`| ${name} | ${times.map((time) => time.toFixed(2)).join(' | ')} | ${(last / core.at(-1)!).toFixed(2)} | ${growth} |`)
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
