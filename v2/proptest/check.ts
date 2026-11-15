import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { parseFragment } from 'parse5'
import {
  CarveInputError, CarveLayoutError, CarveOptionError, CarveRenderError, CarveTreeError,
  decodeTree, encodeTree, formatWithDiagnostics, isUrlAllowed, lint, migrateTree, parse,
  parseWithDiagnostics, parseWithLayout, render, renderWithDiagnostics, tabExtension, tabsExtension,
  tabsRenderer, treesEqual, validateLayout, validateTree,
  validateTreeWithAnnotations,
} from '../src/index.ts'
import { forEachSlot, isRecord, type DocumentNode, type Node } from '../src/ast.ts'
import { type Diagnostic } from '../src/diagnostics.ts'
import { type Random } from './generate.ts'
import { type Target } from './targets.ts'

export interface Finding {
  kind: string
  detail: string
  losses?: number
  refusals?: number
}

function description(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ''}` : String(error)
}

function finding(kind: string, detail: string): Finding { return { kind, detail } }

function timed<T>(work: () => T): { value: T, ms: number } {
  const start = cpuMicros()
  return { value: work(), ms: (cpuMicros() - start) / 1000 }
}

function cpuMicros(): number {
  const usage = process.cpuUsage()
  return usage.user + usage.system
}

function averageParse(source: string): number {
  const start = cpuMicros()
  let runs = 0
  do { parse(source); runs++ } while (runs < 50 && cpuMicros() - start < 10_000)
  return (cpuMicros() - start) / (runs * 1000)
}

function median(values: number[]): number { return values.sort((left, right) => left - right)[1] ?? 0 }

function growth(source: string, average: (input: string) => number): string | null {
  const one: number[] = []
  const two: number[] = []
  const four: number[] = []
  for (let at = 0; at < 3; at++) {
    one.push(average(source))
    two.push(average(source.repeat(2)))
    four.push(average(source.repeat(4)))
  }
  const measured = [median(one), median(two), median(four)]
  const [first, second, third] = measured
  if (first === undefined || second === undefined || third === undefined) return null
  if (first <= 0.5 || second <= 0.5 || (second / first <= 3 && third / second <= 3)) return null
  return measured.map((ms) => ms.toFixed(2)).join(', ') + ' ms'
}

function checkParse(source: string, rng: Random): Finding | null {
  let document: DocumentNode
  let ms: number
  try {
    ({ value: document, ms } = timed(() => parse(source)))
  } catch (error) {
    return error instanceof CarveInputError ? null : finding('parse-exception', description(error))
  }
  const threshold = Math.max(50, Buffer.byteLength(source) * 50 / 10240)
  try {
    validateTree(document, undefined, source)
    if (!treesEqual(document, decodeTree(encodeTree(document), source))) return finding('parse-json-roundtrip', 'encoded tree changed')
    if (!treesEqual(document, parse(source))) return finding('parse-nondeterministic', 'second parse changed tree')
  } catch (error) { return finding('parse-invalid-tree', description(error)) }
  if ((ms > threshold || rng.int(128) === 0) && source.length > 16) {
    try {
      const slow = growth(source, averageParse)
      if (slow !== null) return finding('parse-superlinear', slow)
    } catch (error) { return finding('parse-exception', description(error)) }
  }
  if (ms > threshold) return finding('parse-slow', `${ms.toFixed(1)} ms > ${threshold.toFixed(1)} ms`)
  return null
}

function htmlErrors(html: string): string[] {
  const errors: string[] = []
  try { parseFragment(html, { onParseError: (error) => errors.push(error.code) }) }
  catch { /* parse5 cannot tokenize some Unicode scalar edge cases. */ }
  return errors
}

function quotedValueFollows(html: string, equalAt: number): boolean {
  let next = equalAt + 1
  while (html[next] === ' ') next++
  return html[next] === '"' || html[next] === "'"
}

function attributeValueProblem(html: string, start: number): { end: number, problem: string | null } {
  let quote = ''
  let at = start + 1
  for (; at < html.length; at++) {
    const char = html[at] ?? ''
    if (char === quote) quote = ''
    else if (quote === '' && (char === '"' || char === "'")) quote = char
    else if (quote === '' && char === '>') break
    else if (quote === '' && char === '=') {
      if (!quotedValueFollows(html, at)) {
        return { end: at, problem: html.slice(Math.max(0, at - 20), at + 30) }
      }
    }
  }
  return { end: at, problem: null }
}

function htmlAttributeProblem(html: string): string | null {
  for (let at = 0; at < html.length; at++) {
    const code = html.charCodeAt(at + 1) | 32
    if (html[at] !== '<' || code < 97 || code > 122) continue
    const scanned = attributeValueProblem(html, at)
    if (scanned.problem !== null) return scanned.problem
    at = scanned.end
  }
  return null
}

const VOID_TAGS: readonly string[] = Object.freeze(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link',
  'meta', 'param', 'source', 'track', 'wbr'])

function tagName(html: string, start: number): { name: string, closing: boolean } {
  let at = start + 1
  const closing = html[at] === '/'
  if (closing) at++
  const begin = at
  while (at < html.length) {
    const code = html.charCodeAt(at) | 32
    if ((code < 97 || code > 122) && (code < 48 || code > 57) && code !== 45) break
    at++
  }
  return { name: html.slice(begin, at).toLowerCase(), closing }
}

interface TagScan { end: number, name: string, closing: boolean, skip: boolean, error: string | null }

function scanTag(html: string, start: number): TagScan {
  if (html.startsWith('<!--', start)) {
    const end = html.indexOf('-->', start + 4)
    return { end: end < 0 ? html.length : end + 2, name: '', closing: false, skip: true,
      error: end < 0 ? 'unclosed comment' : null }
  }
  const scanned = attributeValueProblem(html, start)
  const shape = tagName(html, start)
  return { end: scanned.end, ...shape, skip: false,
    error: scanned.end >= html.length ? `unclosed tag at ${start}` : shape.name === '' ? `raw < at ${start}` : null }
}

function htmlBalanceProblem(html: string): string | null {
  const stack: string[] = []
  for (let at = 0; at < html.length;) {
    const start = html.indexOf('<', at)
    if (start < 0) break
    const tag = scanTag(html, start)
    if (tag.error !== null) return tag.error
    if (!tag.skip && tag.closing && stack.pop() !== tag.name) return `mismatched closing tag ${tag.name}`
    if (!tag.skip && !tag.closing && !VOID_TAGS.includes(tag.name)) stack.push(tag.name)
    at = tag.end + 1
  }
  return stack.length === 0 ? null : `unclosed ${stack[stack.length - 1]}`
}

function tagUrlProblem(tag: string): string | null {
  for (const marker of [' href=', ' src=']) {
    let found = tag.indexOf(marker)
    while (found >= 0) {
      const begin = found + marker.length
      const quote = tag[begin]
      if (quote !== '"' && quote !== "'") return tag.slice(begin)
      const finish = tag.indexOf(quote, begin + 1)
      if (finish < 0) break
      const address = tag.slice(begin + 1, finish)
      if (!isUrlAllowed(address)) return address
      found = tag.indexOf(marker, finish)
    }
  }
  return null
}

function htmlUrlProblem(html: string): string | null {
  for (let at = 0; at < html.length;) {
    const start = html.indexOf('<', at)
    if (start < 0) break
    const end = html.indexOf('>', start)
    if (end < 0) break
    const problem = tagUrlProblem(html.slice(start, end))
    if (problem !== null) return problem
    at = end + 1
  }
  return null
}

function hasBidiControl(html: string): boolean {
  for (let at = 0; at < html.length; at++) {
    if (html[at] === '<') {
      at = html.indexOf('>', at)
      if (at < 0) return false
      continue
    }
    const code = html.charCodeAt(at)
    if ((code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069)) return true
  }
  return false
}

function checkRender(source: string): Finding | null {
  let html: string
  try { html = render(source) } catch (error) {
    return finding(error instanceof CarveRenderError || error instanceof CarveInputError ? 'render-typed-error' :
      'render-exception', description(error))
  }
  const errors = htmlErrors(html)
  if (errors.length > 0) return finding('render-invalid-html', errors.join(', '))
  const balance = htmlBalanceProblem(html)
  if (balance !== null) return finding('render-unbalanced-tags', balance)
  const attribute = htmlAttributeProblem(html)
  if (attribute !== null) return finding('render-unquoted-attribute', attribute)
  const address = htmlUrlProblem(html)
  if (address !== null) return finding('render-denied-url', address)
  if (hasBidiControl(html) && !source.includes('```=html')) {
    return finding('render-bidi-control', 'bidi control in HTML output')
  }
  if (!isUrlAllowed('https://example.org') || isUrlAllowed('javascript:alert(1)')) {
    return finding('render-url-policy', 'exported URL policy disagrees with default')
  }
  return null
}

function optionHtmlProblem(html: string, source: string): string | null {
  const errors = htmlErrors(html)
  return errors[0] ?? htmlBalanceProblem(html) ?? htmlAttributeProblem(html) ?? htmlUrlProblem(html) ??
    (hasBidiControl(html) && !source.includes('```=html') ? 'bidi control between tags' : null)
}

function writerAccounting(diagnostics: readonly Diagnostic[]): Finding | null {
  const losses = diagnostics.filter((entry) => entry.code.includes('unspellable')).length
  const refusals = diagnostics.filter((entry) => entry.code.includes('refused')).length
  return losses + refusals === 0 ? null : { kind: 'writer-accounting', detail: `${losses} losses, ${refusals} refusals`,
    losses, refusals }
}

const VERBATIM: readonly Node['type'][] = Object.freeze(['code', 'code_block', 'raw_inline', 'raw_block', 'literal_inline',
  'frontmatter', 'comment', 'critic_comment', 'math', 'image'])

function isVerbatim(node: Node): boolean { return VERBATIM.includes(node.type) }

function verbatimRanges(document: DocumentNode): { start: number, end: number }[] {
  const ranges: { start: number, end: number }[] = []
  const pending: Node[] = [document]
  while (pending.length > 0) {
    const node = pending.pop()
    if (node === undefined) continue
    if (isVerbatim(node) && node.pos !== undefined) {
      ranges.push({ start: node.pos.startOffset, end: node.pos.endOffset })
    }
    forEachSlot(node, (children) => pending.push(...children))
  }
  return ranges
}

function hasTrailingSpaces(source: string, document: DocumentNode): boolean {
  const ranges = verbatimRanges(document)
  let offset = 0
  for (const line of source.split('\n')) {
    let end = line.endsWith('\r') ? line.length - 1 : line.length
    const before = end
    while (end > 0 && (line[end - 1] === ' ' || line[end - 1] === '\t')) end--
    const escaped = before - end === 1 && line[end - 1] === '\\'
    const byte = offset + Buffer.byteLength(line.slice(0, end))
    if (end < before && !escaped && !ranges.some((range) => range.start <= byte && byte < range.end)) return true
    offset += Buffer.byteLength(line) + 1
  }
  return false
}

function checkFormatMode(source: string, normalize: boolean): Finding | null {
  let output: ReturnType<typeof formatWithDiagnostics>
  try { output = formatWithDiagnostics(source, { normalize }) } catch (error) {
    return finding('format-exception', description(error))
  }
  const accounting = writerAccounting(output.diagnostics)
  let formattedTree: DocumentNode
  try {
    formattedTree = parse(output.source)
    if (accounting === null && !treesEqual(parse(source), formattedTree)) {
      return finding('format-tree-change', `normalize=${normalize}`)
    }
    if (accounting !== null) return accounting
    if (formatWithDiagnostics(output.source, { normalize }).source !== output.source) {
      return finding('format-not-idempotent', `normalize=${normalize}`)
    }
  } catch (error) { return finding('format-after-write-exception', description(error)) }
  if (!output.source.endsWith('\n') || output.source.endsWith('\n\n') || output.source.endsWith('\r\n')) {
    return finding('format-no-final-lf', `normalize=${normalize}`)
  }
  if (hasTrailingSpaces(output.source, formattedTree)) return finding('format-trailing-space', `normalize=${normalize}`)
  return accounting
}

function checkFormat(source: string): Finding | null {
  const first = checkFormatMode(source, false)
  if (first !== null && first.kind !== 'writer-accounting') return first
  const second = checkFormatMode(source, true)
  if (second !== null && second.kind !== 'writer-accounting') return second
  const losses = (first?.losses ?? 0) + (second?.losses ?? 0)
  const refusals = (first?.refusals ?? 0) + (second?.refusals ?? 0)
  return losses + refusals === 0 ? null : { kind: 'writer-accounting', detail: `${losses} losses, ${refusals} refusals`,
    losses, refusals }
}

function pointer(root: unknown, path: string): unknown {
  let value: unknown = root
  for (const part of path.split('/').slice(1)) {
    const key = part.replaceAll('~1', '/').replaceAll('~0', '~')
    if (Array.isArray(value)) value = value[Number(key)]
    else if (isRecord(value)) value = value[key]
    else return undefined
  }
  return value
}

function diagnosticsValid(source: string, document: DocumentNode, entries: readonly Diagnostic[]): Finding | null {
  const bytes = Buffer.byteLength(source)
  for (const entry of entries) {
    if (entry.path !== undefined && pointer(document, entry.path) === undefined) {
      return finding('diagnostic-bad-path', `${entry.code}: ${entry.path}`)
    }
    const range = entry.range
    if (range !== undefined && (range.startOffset < 0 || range.endOffset > bytes || range.startOffset > range.endOffset)) {
      return finding('diagnostic-bad-range', `${entry.code}: ${JSON.stringify(range)}`)
    }
  }
  return null
}

function checkDiagnostics(source: string): Finding | null {
  try {
    const parsed = parseWithDiagnostics(source)
    const result = diagnosticsValid(source, parsed.document, parsed.diagnostics)
    if (result !== null) return result
    const rendered = renderWithDiagnostics(source)
    const renderResult = diagnosticsValid(source, parsed.document, rendered.diagnostics)
    if (renderResult !== null) return renderResult
    const formatted = formatWithDiagnostics(source)
    return diagnosticsValid(source, parsed.document, formatted.diagnostics)
  } catch (error) { return finding('diagnostics-exception', description(error)) }
}

function tabSource(body: string): string {
  let longestColon = 0
  let longestTick = 0
  let colons = 0
  let ticks = 0
  for (const char of body) {
    colons = char === ':' ? colons + 1 : 0
    ticks = char === '`' ? ticks + 1 : 0
    longestColon = Math.max(longestColon, colons)
    longestTick = Math.max(longestTick, ticks)
  }
  const outer = ':'.repeat(Math.max(4, longestColon + 2))
  const inner = outer.slice(1)
  const code = '`'.repeat(Math.max(3, longestTick + 1))
  return `${outer} tabs\n${inner} tab "Generated"\n${code}\n${body}\n${code}\n${inner}\n${outer}\n`
}

function checkTabsFormat(source: string, document: DocumentNode): Finding | null {
  const extensions = [tabExtension, tabsExtension]
  const formatted = formatWithDiagnostics(source, { extensions })
  if (writerAccounting(formatted.diagnostics) === null && !treesEqual(document, parse(formatted.source, { extensions }))) {
    return finding('tabs-format-tree-change', 'tab formatting changed tree')
  }
  if (writerAccounting(formatted.diagnostics) === null &&
    formatted.source !== formatWithDiagnostics(formatted.source, { extensions }).source) {
    return finding('tabs-format-not-idempotent', 'tab formatting changed on second pass')
  }
  return diagnosticsValid(source, document, formatted.diagnostics)
}

function checkTabs(body: string): Finding | null {
  const source = tabSource(body)
  const extensions = [tabExtension, tabsExtension]
  try {
    const document = parse(source, { extensions })
    if (document.children[0]?.type !== 'block_extension' || document.children[0].name !== 'carve.tabs') {
      return finding('tabs-unclaimed', 'generated tabs source was not claimed')
    }
    validateTree(document, undefined, source, extensions)
    if (!treesEqual(document, decodeTree(encodeTree(document), source, extensions))) {
      return finding('tabs-json-roundtrip', 'extension tree changed after JSON')
    }
    if (!treesEqual(document, parse(source, { extensions }))) return finding('tabs-nondeterministic', 'second parse changed tree')
    const rendered = renderWithDiagnostics(source, { extensions, renderers: { 'carve.tabs': tabsRenderer } })
    const html = rendered.html
    const htmlError = htmlErrors(html)[0] ?? htmlBalanceProblem(html) ?? htmlAttributeProblem(html) ?? htmlUrlProblem(html)
    if (htmlError !== null) return finding('tabs-invalid-html', htmlError)
    const renderDiagnostic = diagnosticsValid(source, document, rendered.diagnostics)
    if (renderDiagnostic !== null) return renderDiagnostic
    const formatDiagnostic = checkTabsFormat(source, document)
    if (formatDiagnostic !== null) return formatDiagnostic
    const parsed = parseWithDiagnostics(source, { extensions })
    return diagnosticsValid(source, parsed.document, parsed.diagnostics)
  } catch (error) { return finding('tabs-exception', description(error)) }
}

function checkExtensions(source: string, rng: Random): Finding | null {
  const tabs = checkTabs(source)
  if (tabs !== null) return tabs
  const name = `test.random${rng.int(1000)}`
  const behavior = rng.int(4)
  const slotName = ['extra', 'note', 'caption'][rng.int(3)] ?? 'extra'
  const slotKind = rng.bool() ? 'inline' as const : 'block' as const
  const random = { name, version: '1', matcher: { form: 'div' as const, name: 'random' }, props: {},
    slots: { [slotName]: { kind: slotKind, optional: rng.bool() } },
    transform: (claim: import('../src/index.ts').ExtensionClaim) => claim.form === 'div' ?
      { type: 'block_extension' as const, name, version: '1', children: [], fallback: claim.body, source: claim.source } : null }
  const renderer = { version: '1', render: () => {
    if (behavior === 0) throw new Error('intentional renderer error')
    if (behavior === 1) return 42 as unknown as string
    return behavior === 2 ? 'x'.repeat(100_000) : '<span>ok</span>'
  } }
  try {
    const result = renderWithDiagnostics(`::: random\n${source}\n:::`, {
      extensions: [random], renderers: { [name]: renderer },
    })
    if (behavior < 2 && !result.diagnostics.some((entry) => entry.message.includes(name))) {
      return finding('extension-failure-unreported', `the ${name} renderer failure has no named diagnostic`)
    }
  } catch (error) { return finding('extension-renderer-exception', description(error)) }
  return null
}

function checkDecode(source: string): Finding | null {
  let document: DocumentNode | null = null
  try {
    document = decodeTree(source)
  } catch (error) {
    if (!(error instanceof CarveTreeError)) return finding('decode-untyped-error', description(error))
  }
  if (document !== null) {
    try {
      validateTree(document)
      validateTreeWithAnnotations(document, { ranges: [] })
    } catch (error) { return finding('decode-invalid-tree', description(error)) }
  }
  let layout: ReturnType<typeof parseWithLayout>['layout']
  try {
    layout = parseWithLayout(source).layout
  } catch (error) { return finding('layout-parse-exception', description(error)) }
  try { validateLayout(layout) } catch (error) { return finding('layout-invalid', description(error)) }
  try {
    validateLayout(JSON.parse(source) as unknown)
  } catch (error) {
    if (!(error instanceof CarveLayoutError)) return finding('layout-untyped-error', description(error))
  }
  return null
}

function checkLint(source: string, rng: Random): Finding | null {
  try {
    const result = diagnosticsValid(source, parse(source), lint(source))
    if (result !== null) return result
    if (rng.int(128) === 0 && source.length > 16) {
      const slow = growth(source, averageLint)
      if (slow !== null) return finding('lint-superlinear', slow)
    }
    return null
  } catch (error) {
    return finding('lint-exception', description(error))
  }
}

function averageLint(source: string): number {
  const start = cpuMicros()
  let runs = 0
  do { lint(source); runs++ } while (runs < 50 && cpuMicros() - start < 10_000)
  return (cpuMicros() - start) / (runs * 1000)
}

function checkMigrate(source: string): Finding | null {
  let value: unknown
  try { value = JSON.parse(source) as unknown } catch (error) { return finding('migrate-invalid-json', description(error)) }
  let document: DocumentNode
  try { document = migrateTree(value).document } catch (error) {
    if (!(error instanceof CarveTreeError)) return finding('migrate-untyped-error', description(error))
    return null
  }
  try { validateTree(document) } catch (error) { return finding('migrate-invalid-tree', description(error)) }
  return null
}

function checkImport(source: string, rng: Random): Finding | null {
  const formats = ['markdown', 'gfm', 'djot', 'html'] as const
  const format = formats[rng.int(formats.length)] ?? 'markdown'
  const result = spawnSync(process.execPath, ['v2/proptest/import-worker.mjs', format], {
    input: source, encoding: 'utf8', timeout: 3000, maxBuffer: 1024 * 1024,
  })
  if (result.error !== undefined) return finding('import-process-error', String(result.error))
  try {
    const output: unknown = JSON.parse(result.stdout)
    if (!isRecord(output)) return finding('import-untyped-error', result.stderr)
    if (output['kind'] === 'typed-error') return null
    if (output['kind'] !== 'tree' || output['document'] === undefined) {
      return finding('import-untyped-error', String(output['detail'] ?? result.stderr))
    }
    validateTree(output['document'])
  } catch (error) { return finding('import-invalid-tree', description(error)) }
  return null
}

interface OptionCase { name: string, kind: string, type: string, values?: string[] }
const OPTIONS = (JSON.parse(readFileSync('v2/data/options.json', 'utf8')) as { options: OptionCase[] }).options
const WIDE_TABLE = '| a | b |\n|---|---|\n| 🇺🇸 | 👩‍💻 |\n| 각 | á |\n'

function validOption(entry: OptionCase, rng: Random): unknown {
  if (entry.name === 'includes' || entry.name === 'social') return null
  if (entry.name === 'urlPolicy') return { deny: ['javascript'] }
  if (entry.type === 'boolean') return rng.bool()
  if (entry.type === 'enum') return entry.values?.[rng.int(entry.values.length)] ?? 'off'
  if (entry.type === 'list') return []
  return {}
}

function checkRenderedOption(source: string, entry: OptionCase, value: unknown, options: object): Finding | null {
  const html = render(source, options)
  if ((entry.name === 'rawHtml' || entry.name === 'roundtrip') && value === true) return null
  const problem = optionHtmlProblem(html, source)
  return problem === null ? null : finding('option-render-invalid-html', `${entry.name}: ${problem}`)
}

function checkValidOption(source: string, entry: OptionCase, value: unknown): Finding | null {
  const options = { [entry.name]: value }
  try {
    if (entry.kind === 'format') formatWithDiagnostics(source, options)
    else if (entry.kind === 'lint') lint(source, options)
    else if (entry.kind === 'parse') parse(source, options)
    else return checkRenderedOption(source, entry, value, options)
  } catch (error) {
    if (entry.kind === 'parse' && error instanceof CarveInputError) return null
    return finding('option-valid-rejected', `${entry.name}: ${description(error)}`)
  }
  return null
}

function checkInvalidOption(source: string, entry: OptionCase): Finding | null {
  const bad = entry.type === 'boolean' ? 17 : true
  const options = { [entry.name]: bad }
  try {
    if (entry.kind === 'format') formatWithDiagnostics(source, options)
    else if (entry.kind === 'lint') lint(source, options)
    else if (entry.kind === 'parse') parse(source, options)
    else render(source, options)
  } catch (error) {
    return error instanceof CarveOptionError ? null : finding('option-invalid-error', `${entry.name}: ${description(error)}`)
  }
  return finding('option-invalid-accepted', entry.name)
}

function checkOptions(source: string, rng: Random): Finding | null {
  const entry = OPTIONS[rng.int(OPTIONS.length)]
  if (entry === undefined) return null
  const candidate = entry.name === 'alignTables' ? WIDE_TABLE : source
  return checkValidOption(candidate, entry, validOption(entry, rng)) ?? checkInvalidOption(source, entry)
}

export function check(target: Target, source: string, rng: Random): Finding | null {
  switch (target) {
    case 'parse': return checkParse(source, rng)
    case 'render': return checkRender(source) ?? checkOptions(source, rng)
    case 'format': return checkFormat(source)
    case 'diagnostics': return checkDiagnostics(source)
    case 'extensions': return checkExtensions(source, rng)
    case 'decode': return checkDecode(source)
    case 'lint': return checkLint(source, rng)
    case 'migrate': return checkMigrate(source)
    case 'import': return checkImport(source, rng)
    case 'cli': return null
  }
}
