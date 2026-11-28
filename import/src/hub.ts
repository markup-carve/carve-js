// Markdown, GFM and Djot import through the HTML hub (ruling of 17 November): the reference library renders HTML and
// the 0.2 HTML importer reads it. Hooks here only shape what the library's HTML cannot carry on its own.
import { compile, parse as parseMarkdown, postprocess, preprocess } from 'micromark'
import type { CompileContext, Construct, Event, Extension, Handle, HtmlExtension, Options, State, Token } from 'micromark-util-types'
import { EditMap } from 'micromark-util-edit-map'
import { gfm } from 'micromark-extension-gfm'
import { gfmAutolinkLiteralHtml } from 'micromark-extension-gfm-autolink-literal'
import { gfmFootnoteHtml } from 'micromark-extension-gfm-footnote'
import { gfmStrikethroughHtml } from 'micromark-extension-gfm-strikethrough'
import { gfmTableHtml } from 'micromark-extension-gfm-table'
import { gfmTaskListItemHtml } from 'micromark-extension-gfm-task-list-item'
import { frontmatter } from 'micromark-extension-frontmatter'
import { math } from 'micromark-extension-math'
import { directive, directiveHtml, type Directive } from 'micromark-extension-directive'
import { parse as parseDjot, parseEvents as parseDjotEvents, renderHTML as renderDjot } from '@djot/djot'
import type { DocumentNode } from '../../src/index.ts'
import { commentEmptyItems, ensureForeignDepth, ImportInputError, type ImportResult, withoutHtmlRanges } from './kit.ts'
import { defaultTreeAdapter, type DefaultTreeAdapterTypes as Html } from 'parse5'
import { ADMONITION_KINDS, importHtml } from './html.ts'
import { constructRecords, djotConstructs, markdownConstructs } from './hub-constructs.ts'
import { installDjotUpstreamFixes } from './djot-upstream.ts'

export type HubFormat = 'markdown' | 'gfm' | 'djot'

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

/** Math as the Carve render spells it, which the HTML importer reads back as a typed formula (no KaTeX). */
function mathHtml(): HtmlExtension {
  return {
    enter: {
      mathFlow(this: CompileContext) { this.lineEndingIfNeeded(); this.tag('<p><span class="math display">\\[') },
      mathFlowFenceMeta(this: CompileContext) { this.buffer() },
      mathText(this: CompileContext) { this.tag('<span class="math inline">\\(') },
    },
    exit: {
      mathFlow(this: CompileContext) {
        const value = this.resume()
        this.raw(value.replace(/(?:\r?\n|\r)$/u, ''))
        this.tag('\\]</span></p>')
        this.setData('mathFlowOpen')
        this.setData('slurpOneLineEnding')
      },
      mathFlowFence(this: CompileContext) {
        if (!this.getData('mathFlowOpen')) {
          this.setData('mathFlowOpen', true)
          this.setData('slurpAllLineEndings')
          this.setData('slurpOneLineEnding', true)
          this.buffer()
        }
      },
      mathFlowFenceMeta(this: CompileContext) { this.resume() },
      mathFlowValue(this: CompileContext, token: Token) { this.raw(escapeHtml(this.sliceSerialize(token))) },
      mathText(this: CompileContext) { this.tag('\\)</span>') },
      mathTextData(this: CompileContext, token: Token) { this.raw(escapeHtml(this.sliceSerialize(token))) },
    },
  }
}

/** The YAML frontmatter is not HTML; the hub keeps its text and adds it to the tree after the HTML import. */
function frontmatterCapture(sink: Sink): HtmlExtension {
  // `yaml` and `toml` are token types the frontmatter extension adds; the handle map does not list them.
  const enter: Record<string, Handle> = {}
  const exit: Record<string, Handle> = {}
  for (const kind of ['yaml', 'toml'] as const) {
    enter[kind] = function (this: CompileContext) { this.buffer() }
    exit[kind] = function (this: CompileContext, token: Token) {
      this.resume()
      this.setData('slurpOneLineEnding', true)
      const lines = this.sliceSerialize(token).split(/\r?\n|\r/u).slice(1, -1)
      sink.format = kind
      sink.value = lines.length > 0 ? `${lines.join('\n')}\n` : ''
    }
  }
  return { enter, exit }
}

interface Sink {
  format?: 'yaml' | 'toml'
  value?: string
  raw: { format: string, value: string }[]
  /** Set when the caller asks for construct records; the routes then fill it. */
  constructs?: ReturnType<typeof markdownConstructs>
}

const RAW_PLACEHOLDER = /^<!--carve-hub-raw-(\d+)-->\n$/u
const RAW_INLINE_PLACEHOLDER = /^<!--carve-hub-raw-(\d+)-->$/u

/**
 * Raw HTML stays raw, as the 0.1 importer kept it: an inline run is the `data-carve-raw` carrier (C2-H-186), and a
 * block a placeholder comment (C2-M-065) the hub swaps back for the block's HTML after the import.
 */
function rawHtmlCarrier(sink: Sink): HtmlExtension {
  let slurp: boolean | undefined
  return {
    enter: {
      htmlFlow(this: CompileContext) {
        this.lineEndingIfNeeded()
        // A tight paragraph before the block leaves micromark slurping line endings; the block's own are its text.
        slurp = this.getData('slurpAllLineEndings')
        this.setData('slurpAllLineEndings')
        this.buffer()
        this.setData('ignoreEncode', true)
      },
      htmlText(this: CompileContext) { this.buffer(); this.setData('ignoreEncode', true) },
    },
    exit: {
      htmlFlow(this: CompileContext) {
        this.setData('ignoreEncode')
        this.setData('slurpAllLineEndings', slurp)
        this.tag(rawBlockPlaceholder(sink, 'html', this.resume()))
      },
      htmlText(this: CompileContext) {
        this.setData('ignoreEncode')
        this.tag(`<span data-carve-raw="html">${escapeHtml(this.resume())}</span>`)
      },
    },
  }
}

/**
 * micromark 4.0.3 drops the line endings of a code block that follows a tight paragraph or a run of definitions: both
 * leave `slurpAllLineEndings` on, and only a paragraph clears it. The code text clears it; neither token has an enter
 * handler of its own.
 */
function codeLineEndings(): HtmlExtension {
  const clear: Handle = function () { this.setData('slurpAllLineEndings') }
  return { enter: { codeFencedFence: clear, codeFlowValue: clear } }
}

function rawBlockPlaceholder(sink: Sink, format: string, value: string): string {
  sink.raw.push({ format, value })
  return `<!--carve-hub-raw-${sink.raw.length - 1}-->`
}

/** The raw content a placeholder node stands for: a block ends in a line ending, inline content drops it. */
function keptRaw(record: Record<string, unknown>, raw: Sink['raw']): { format: string, value: string } | undefined {
  const block = record['type'] === 'raw_block'
  // A block in inline position, such as one after text in a tight list item, reaches the tree as inline raw content.
  if ((!block && record['type'] !== 'raw_inline') || typeof record['value'] !== 'string') return undefined
  const index = (block ? RAW_PLACEHOLDER : RAW_INLINE_PLACEHOLDER).exec(record['value'])?.[1]
  const kept = index === undefined ? undefined : raw[Number(index)]
  if (kept === undefined) return undefined
  if (block) return kept.value.endsWith('\n') ? kept : { format: kept.format, value: `${kept.value}\n` }
  return { format: kept.format, value: kept.value.replace(/(?:\r?\n|\r)+$/u, '') }
}

function restoreRaw<T>(value: T, raw: Sink['raw']): T {
  if (Array.isArray(value)) return value.map((item: unknown) => restoreRaw(item, raw)) as T
  if (value === null || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  const kept = keptRaw(record, raw)
  if (kept !== undefined) return { ...record, ...kept } as T
  if (Array.isArray(record['children'])) return { ...record, children: restoreRaw(record['children'], raw) } as T
  return value
}

function directiveAttributes(node: Directive, extraClass?: string): string {
  const entries = Object.entries(node.attributes ?? {})
  const classes = [extraClass, entries.find(([key]) => key === 'class')?.[1]].filter(Boolean).join(' ')
  return [...(classes ? [['class', classes]] : []), ...entries.filter(([key]) => key !== 'class')]
    .map(([key, value]) => ` ${key}="${escapeHtml(value ?? '')}"`).join('')
}

/** A container directive of an admonition kind is the Carve admonition carrier; any other directive a classed div or span. */
function directiveHandlers(): HtmlExtension {
  function container(this: CompileContext, node: Directive): void {
    const known = (ADMONITION_KINDS as readonly string[]).includes(node.name)
    this.tag(known ? `<aside${directiveAttributes(node, `admonition ${node.name}`)}>` : `<div${directiveAttributes(node, node.name)}>`)
    if (node.label) this.tag(`<p class="admonition-title">${node.label}</p>`)
    if (node.content) this.raw(node.content)
    this.tag(known ? '</aside>' : '</div>')
  }
  function any(this: CompileContext, node: Directive): boolean {
    if (node.type === 'containerDirective') container.call(this, node)
    else if (node.type === 'leafDirective') this.tag(`<div${directiveAttributes(node, node.name)}><p>${node.label ?? ''}</p></div>`)
    else this.tag(`<span${directiveAttributes(node, node.name)}>${node.label ?? ''}</span>`)
    return true
  }
  return directiveHtml({ '*': any })
}

/**
 * Both libraries write a tight list's paragraphs bare and a loose list's in `<p>`; the HTML alone reads an item of
 * several blocks as loose (C2-M-033), so the hub marks each list without an item paragraph with `data-carve-tight`.
 */
function markTightLists(nodes: Html.ChildNode[]): void {
  const pending = [...nodes]
  while (pending.length > 0) {
    const node = pending.pop()
    if (node === undefined || !defaultTreeAdapter.isElementNode(node)) continue
    pending.push(...defaultTreeAdapter.getChildNodes(node))
    if (node.tagName !== 'ul' && node.tagName !== 'ol') continue
    const items = node.childNodes.filter(child => defaultTreeAdapter.isElementNode(child) && child.tagName === 'li')
    const loose = items.some(item => defaultTreeAdapter.getChildNodes(item as Html.Element)
      .some(child => defaultTreeAdapter.isElementNode(child) && child.tagName === 'p'))
    if (!loose) node.attrs.push({ name: 'data-carve-tight', value: '' })
  }
}

const ALERT_KINDS: Record<string, string> = { NOTE: 'note', TIP: 'tip', IMPORTANT: 'info', WARNING: 'warning', CAUTION: 'danger' }

/** The alert kind of a quote whose first line is `[!KIND]` alone, and the text node that holds the marker. */
function alertOf(node: Html.Element): { kind: string, first: Html.Element, lead: Html.TextNode, marker: string } | undefined {
  if (node.tagName !== 'blockquote' || node.attrs.length > 0) return undefined
  const first = node.childNodes.find(child => !(defaultTreeAdapter.isTextNode(child) && child.value.trim() === ''))
  if (first === undefined || !defaultTreeAdapter.isElementNode(first) || first.tagName !== 'p') return undefined
  const lead = first.childNodes[0]
  if (lead === undefined || !defaultTreeAdapter.isTextNode(lead)) return undefined
  const match = /^\[!([A-Z]+)\](?:\n|$)/u.exec(lead.value)
  const kind = match?.[1] === undefined ? undefined : ALERT_KINDS[match[1]]
  return match === null || kind === undefined ? undefined : { kind, first, lead, marker: match[0] }
}

/** A GitHub alert is the admonition the 0.1 importer made of it (C2-A-066). */
function githubAlerts(nodes: Html.ChildNode[]): void {
  const pending = [...nodes]
  while (pending.length > 0) {
    const node = pending.pop()
    if (node === undefined || !defaultTreeAdapter.isElementNode(node)) continue
    pending.push(...defaultTreeAdapter.getChildNodes(node))
    const alert = alertOf(node)
    if (alert === undefined) continue
    alert.lead.value = alert.lead.value.slice(alert.marker.length)
    if (alert.lead.value === '') alert.first.childNodes.shift()
    if (alert.first.childNodes.every(child => defaultTreeAdapter.isTextNode(child) && child.value.trim() === '')) {
      node.childNodes.splice(node.childNodes.indexOf(alert.first), 1)
    }
    node.tagName = 'aside'
    node.nodeName = 'aside'
    node.attrs.push({ name: 'class', value: `admonition ${alert.kind}` })
  }
}

/** GFM points each note reference at the label heading of the notes, which C2-M-061 drops; the pointer goes with it. */
function dropNoteLabelPointers(nodes: Html.ChildNode[]): void {
  const pending = [...nodes]
  while (pending.length > 0) {
    const node = pending.pop()
    if (node === undefined || !defaultTreeAdapter.isElementNode(node)) continue
    pending.push(...defaultTreeAdapter.getChildNodes(node))
    if (node.tagName === 'a' && node.attrs.some(entry => entry.name === 'data-footnote-ref')) {
      node.attrs = node.attrs.filter(entry => !(entry.name === 'aria-describedby' && entry.value === 'footnote-label'))
    }
  }
}

/** GFM's HTML without the tag filter: raw HTML stays raw in the tree, and the render decides what reaches the output. */
/** Container directives only: text and leaf directives would claim ordinary prose such as `10:30` (CommonMark has none). */
function containerDirectives(): Extension {
  const flow = directive().flow?.[58]
  const constructs = (Array.isArray(flow) ? flow : flow === undefined ? [] : [flow])
    // The container construct is the only concrete one; the package does not export the constructs by name.
    .filter(construct => construct.concrete === true)
  return { flow: { 58: constructs } }
}

/**
 * micromark 4.0.3 reads every line below an open flow construct as an interruption, so a list after indented code has
 * to start at 1 and cannot be empty. CommonMark 0.31 sets those conditions only for a list that interrupts a paragraph.
 * The document reads `_gfmTableDynamicInterruptHack` on the flow as "this construct is not interrupted"; indented code
 * sets it while it is open.
 */
function indentedCodeDoesNotInterrupt(): Extension {
  const entry = parseMarkdown().constructs.flowInitial?.[32]
  const code = Array.isArray(entry) ? entry[0] : entry
  if (code?.tokenize === undefined) return {}
  const codeIndented: Construct = { ...code, tokenize(effects, ok, nok) {
    const done = (next: State): State => (value) => {
      this._gfmTableDynamicInterruptHack = false
      return next(value)
    }
    this._gfmTableDynamicInterruptHack = true
    return code.tokenize.call(this, effects, done(ok), done(nok))
  } }
  return { flowInitial: { [-2]: codeIndented, [-1]: codeIndented, 32: codeIndented } }
}

const CONTINUED_OVER_BLANKS = new Set(['listOrdered', 'listUnordered', 'gfmFootnoteDefinition'])
const CONTAINERS = new Set([...CONTINUED_OVER_BLANKS, 'blockQuote'])

/**
 * micromark 4.0.3 ends an unclosed fence in a container with one line ending of its own, which doubles the last one
 * when the code's text already holds it. The line endings the code is owed past its text, read from the events after it:
 * one for a last line of quote markers only, or for text that ends inside a line, and one per blank line a closing list
 * or note held.
 */
function owedLineEndings(events: Event[], exit: number, token: Token, text: string): number {
  if (endsOnQuoteMarkers(events, exit + 1)) return 1
  if (!/[\n\r]/u.test(text)) return 0
  if (!/[\n\r]$/u.test(text) || token.end.column > 1) return 1
  let continued = false
  let blanks = 0
  for (let index = exit + 1; index < events.length; index++) {
    const [kind, next] = events[index]!
    if (kind === 'exit' && CONTAINERS.has(next.type)) {
      continued ||= CONTINUED_OVER_BLANKS.has(next.type)
    } else if (next.type === 'lineEnding' && next.start.column === 1) {
      if (kind === 'enter') blanks++
    } else {
      break
    }
  }
  return continued ? blanks : 0
}

function endsOnQuoteMarkers(events: Event[], start: number): boolean {
  let index = start
  let markers = 0
  const prefixAt = (at: number): string | undefined => {
    const event = events[at]
    return event?.[0] === 'enter' && /^(?:blockQuotePrefix|linePrefix)$/u.test(event[1].type) ? event[1].type : undefined
  }
  for (let type = prefixAt(index); type !== undefined; type = prefixAt(index)) {
    while (index < events.length && !(events[index]![0] === 'exit' && events[index]![1].type === type)) index++
    index++
    if (type === 'blockQuotePrefix') markers++
  }
  if (markers === 0 || index >= events.length) return false
  for (; index < events.length; index++) {
    if (events[index]![0] !== 'exit' || !CONTAINERS.has(events[index]![1].type)) return false
  }
  return true
}

/** micromark's own exit of fenced code, with the line endings of an unclosed fence in a container counted. */
function unclosedFenceLineEndings(events: Event[]): HtmlExtension {
  const owed = new Map<Token, number>()
  let depth = 0
  events.forEach(([kind, token, context], index) => {
    if (CONTAINERS.has(token.type)) depth += kind === 'enter' ? 1 : -1
    if (kind === 'exit' && token.type === 'codeFenced' && depth > 0) {
      owed.set(token, owedLineEndings(events, index, token, context.sliceSerialize(token)))
    }
  })
  return { exit: { codeFenced(token) {
    const count = this.getData('fencesCount')
    const unclosed = count !== undefined && count < 2
    if (unclosed) this.raw('\n'.repeat(owed.get(token) ?? 0))
    if (this.getData('flowCodeSeenData')) this.lineEndingIfNeeded()
    this.tag('</code></pre>')
    if (unclosed) this.lineEndingIfNeeded()
    this.setData('flowCodeSeenData')
    this.setData('fencesCount')
    this.setData('slurpOneLineEnding')
  } } }
}

const GFM_HTML = (): HtmlExtension[] => [gfmAutolinkLiteralHtml(), gfmFootnoteHtml(), gfmStrikethroughHtml(), gfmTableHtml(),
  gfmTaskListItemHtml()]

/**
 * micromark-extension-frontmatter 2.0.0 tries an opening fence as a concrete construct up to the end of the input, so an
 * unclosed `---` on the first line kept the document from opening any list or quote. It runs only on a closed one.
 */
const CLOSED_FRONTMATTER = /^\uFEFF?(---|\+\+\+)[ \t]*(?:\r\n?|\n)(?:[^\n\r]*(?:\r\n?|\n))*?\1[ \t]*(?:\r\n?|\n|$)/u
const YAML_MAPPING_KEY = /^(?:"(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^\s\-[{"'#][^:\r\n]*):(?:[ \t]|$)/u

function frontmatterBodyStart(input: string): number {
  let at = (input.charCodeAt(0) === 0xFEFF ? 1 : 0) + 3
  while (input[at] === ' ' || input[at] === '\t') at++
  if (input[at] === '\r') at++
  if (input[at] === '\n') at++
  return at
}

/** The #2799 shape test applies to an ambiguous bare dash fence, never to an explicit format. */
function closedFrontmatter(input: string): boolean {
  if (!CLOSED_FRONTMATTER.test(input)) return false
  if (input.startsWith('+++', input.charCodeAt(0) === 0xFEFF ? 1 : 0)) return true
  let at = frontmatterBodyStart(input)
  while (at < input.length) {
    let end = at
    while (end < input.length && input[end] !== '\r' && input[end] !== '\n') end++
    const line = input.slice(at, end)
    if (/^---[ \t]*$/u.test(line)) return false
    if (line.trim() === '' || line.trimStart().startsWith('#')) {
      at = end + (input[end] === '\r' && input[end + 1] === '\n' ? 2 : 1)
      continue
    }
    return YAML_MAPPING_KEY.test(line)
  }
  return false
}

/** Markdown (CommonMark) or GFM to HTML with micromark. */
export function markdownHtml(input: string, format: 'markdown' | 'gfm', sink: Sink): string {
  const options: Options = {
    allowDangerousHtml: true,
    allowDangerousProtocol: true,
    extensions: [...(closedFrontmatter(input) ? [frontmatter(['yaml', 'toml'])] : []), math(), containerDirectives(),
      indentedCodeDoesNotInterrupt(), ...(format === 'gfm' ? [gfm()] : [])],
    htmlExtensions: [frontmatterCapture(sink), rawHtmlCarrier(sink), mathHtml(), codeLineEndings(), directiveHandlers(),
      ...(format === 'gfm' ? GFM_HTML() : [])],
  }
  // micromark's own pipeline, run here so the constructs come from the events it compiles.
  const events: Event[] = postprocess(parseMarkdown(options).document().write(preprocess()(input, undefined, true)))
  if (sink.constructs !== undefined) sink.constructs = markdownConstructs(events, input, format === 'gfm')
  const htmlExtensions = [...options.htmlExtensions ?? [], unclosedFenceLineEndings(events)]
  return compile({ ...options, htmlExtensions })(events)
}

/** djot.js generates a section id from each heading; Carve generates its own, so only an authored id is written. */
function dropGeneratedIds(root: object): void {
  const pending: unknown[] = [root]
  while (pending.length > 0) {
    const node = pending.pop()
    if (node === null || typeof node !== 'object') continue
    if ('autoAttributes' in node) Reflect.deleteProperty(node, 'autoAttributes')
    const children: unknown = Reflect.get(node, 'children')
    if (Array.isArray(children)) pending.push(...(children as unknown[]))
  }
}

interface InlineMatch { startpos: number, endpos: number, annot: string }
interface InlineParser { matches: InlineMatch[], addMatch: (startpos: number, endpos: number, annot: string, matchIndex?: number) => void }

/**
 * djot.js 0.3.2 groups a `!` with the text before it, and the image marker then replaces that whole text run, so
 * `a ![b](c)` loses `a `. Mirrors the upstream fix (jgm/djot.js c7760b9f, unreleased): the run is cut before the `!`.
 * The library does not export its inline parser, so the prototype is taken from a parser it opens.
 */
function patchDjotImageMarker(): void {
  const events = parseDjotEvents('x\ny\n')
  events[Symbol.iterator]().next()
  const containers: unknown = Reflect.get(events, 'containers')
  const parser: unknown = Array.isArray(containers) ? Reflect.get(containers.at(-1) as object, 'inlineParser') : undefined
  if (parser === null || typeof parser !== 'object') return
  const prototype = Object.getPrototypeOf(parser) as InlineParser & { carveImageMarker?: true }
  if (prototype.carveImageMarker === true || typeof prototype.addMatch !== 'function') return
  const addMatch = prototype.addMatch
  prototype.addMatch = function (this: InlineParser, startpos, endpos, annot, matchIndex) {
    const previous = matchIndex === undefined ? undefined : this.matches[matchIndex]
    if (annot === 'image_marker' && previous?.annot === 'str' && previous.startpos < startpos) {
      previous.endpos = startpos - 1
      return
    }
    addMatch.call(this, startpos, endpos, annot, matchIndex)
  }
  prototype.carveImageMarker = true
}

patchDjotImageMarker()
installDjotUpstreamFixes()

/**
 * micromark-util-edit-map 1.0.0 rebuilds the whole event list on every `consume`, and micromark's document tokenizer
 * consumes once per closed container, so a document of many quotes took quadratic time. Edits that sit near the end of
 * the list are spliced in place; anything else keeps the library's rebuild.
 */
function patchEditMapConsume(): void {
  const prototype = EditMap.prototype as EditMap & { carveSplice?: true }
  if (prototype.carveSplice === true) return
  const consume = prototype.consume
  prototype.consume = function (this: EditMap, events: Event[]) {
    const map = this.map.sort((a, b) => a[0] - b[0])
    let moved = 0
    for (const [index, [at, remove, add]] of map.entries()) {
      const next = map[index + 1]
      moved += events.length - at + add.length
      if (moved > events.length || add.length > SPLICE_LIMIT || (next !== undefined && at + remove > next[0])) {
        consume.call(this, events)
        return
      }
    }
    for (let index = map.length - 1; index >= 0; index--) {
      const [at, remove, add] = map[index]!
      events.splice(at, remove, ...add)
    }
    map.length = 0
    this.index.clear()
  }
  prototype.carveSplice = true
}

const SPLICE_LIMIT = 10_000

patchEditMapConsume()

interface InTags { inTags: (tag: string, node: unknown, newlines: number, extra: Record<string, string>) => string }

/** Djot to HTML with djot.js, the reference implementation; raw content of every format is carried as in Markdown. */
export function djotHtml(input: string, sink: Sink): string {
  const doc = parseDjot(input, { sourcePositions: sink.constructs !== undefined })
  ensureForeignDepth(doc, 'djot')
  if (sink.constructs !== undefined) sink.constructs = djotConstructs(doc, input.length)
  dropGeneratedIds(doc)
  return renderDjot(doc, { overrides: {
    raw_inline: node => `<span data-carve-raw="${escapeHtml(node.format)}">${escapeHtml(node.text)}</span>`,
    raw_block: node => `${rawBlockPlaceholder(sink, node.format, node.text)}\n`,
    // djot.js leaves out `start="0"`, which C2-B-041 keeps.
    ordered_list: (node, renderer) => (renderer as unknown as InTags).inTags('ol', node, 2, {
      ...(node.start !== undefined && node.start !== 1 ? { start: String(node.start) } : {}),
      ...(node.style && !/1/u.test(node.style) ? { type: node.style.replace(/[().]/gu, '') } : {}),
    }),
  } })
}

/** Imports through the hub: library HTML, then the 0.2 HTML importer with raw HTML kept, then the frontmatter. */
export function importThroughHtml(input: string, format: HubFormat, constructs = false): ImportResult {
  const sink: Sink = { raw: [], ...(constructs ? { constructs: [] } : {}) }
  let html: string
  try {
    html = format === 'djot' ? djotHtml(input, sink) : markdownHtml(input, format, sink)
  } catch (error) {
    if (error instanceof ImportInputError) throw error
    throw new ImportInputError(error instanceof Error ? error.message : String(error), format)
  }
  const lead: DocumentNode['children'] = sink.format === undefined ? []
    : [{ type: 'frontmatter', format: sink.format, value: sink.value ?? '' }]
  const result = importHtml(html, true, { prepare: nodes => {
    markTightLists(nodes)
    if (format !== 'gfm') return
    dropNoteLabelPointers(nodes)
    githubAlerts(nodes)
  },
    finish: children => {
      commentEmptyItems(children)
      return [...lead, ...(sink.raw.length > 0 ? restoreRaw(children, sink.raw) : children)]
    } })
  // The libraries' own line breaks around tags are no whitespace of the input.
  const diagnostics = withoutHtmlRanges(result.diagnostics)
  if (sink.constructs === undefined) return { ...result, diagnostics }
  return { ...result, diagnostics, constructs: constructRecords(input, sink.constructs, result.document, diagnostics) }
}
