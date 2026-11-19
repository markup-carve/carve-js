// Markdown, GFM and Djot import through the HTML hub (ruling of 17 November): the reference library renders HTML and
// the 0.2 HTML importer reads it. Hooks here only shape what the library's HTML cannot carry on its own.
import { micromark } from 'micromark'
import type { CompileContext, Extension, Handle, HtmlExtension, Token } from 'micromark-util-types'
import { gfm } from 'micromark-extension-gfm'
import { gfmAutolinkLiteralHtml } from 'micromark-extension-gfm-autolink-literal'
import { gfmFootnoteHtml } from 'micromark-extension-gfm-footnote'
import { gfmStrikethroughHtml } from 'micromark-extension-gfm-strikethrough'
import { gfmTableHtml } from 'micromark-extension-gfm-table'
import { gfmTaskListItemHtml } from 'micromark-extension-gfm-task-list-item'
import { frontmatter } from 'micromark-extension-frontmatter'
import { math } from 'micromark-extension-math'
import { directive, directiveHtml, type Directive } from 'micromark-extension-directive'
import { parse as parseDjot, renderHTML as renderDjot } from '@djot/djot'
import type { DocumentNode } from '../../src/index.ts'
import { ensureForeignDepth, ImportInputError, type ImportResult, withoutHtmlRanges } from './kit.ts'
import { defaultTreeAdapter, type DefaultTreeAdapterTypes as Html } from 'parse5'
import { ADMONITION_KINDS, importHtml } from './html.ts'

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

interface Sink { format?: 'yaml' | 'toml', value?: string, raw: { format: string, value: string }[] }

const RAW_PLACEHOLDER = /^<!--carve-hub-raw-(\d+)-->\n$/u

/**
 * Raw HTML stays raw, as the 0.1 importer kept it: an inline run is the `data-carve-raw` carrier (C2-H-186), and a
 * block a placeholder comment (C2-M-065) the hub swaps back for the block's HTML after the import.
 */
function rawHtmlCarrier(sink: Sink): HtmlExtension {
  return {
    enter: {
      htmlFlow(this: CompileContext) { this.lineEndingIfNeeded(); this.buffer(); this.setData('ignoreEncode', true) },
      htmlText(this: CompileContext) { this.buffer(); this.setData('ignoreEncode', true) },
    },
    exit: {
      htmlFlow(this: CompileContext) {
        this.setData('ignoreEncode')
        this.tag(rawBlockPlaceholder(sink, 'html', this.resume()))
      },
      htmlText(this: CompileContext) {
        this.setData('ignoreEncode')
        this.tag(`<span data-carve-raw="html">${escapeHtml(this.resume())}</span>`)
      },
    },
  }
}

function rawBlockPlaceholder(sink: Sink, format: string, value: string): string {
  sink.raw.push({ format, value })
  return `<!--carve-hub-raw-${sink.raw.length - 1}-->`
}

function restoreRaw<T>(value: T, raw: Sink['raw']): T {
  if (Array.isArray(value)) return value.map((item: unknown) => restoreRaw(item, raw)) as T
  if (value === null || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  if (record['type'] === 'raw_block' && typeof record['value'] === 'string') {
    const index = RAW_PLACEHOLDER.exec(record['value'])?.[1]
    const kept = index === undefined ? undefined : raw[Number(index)]
    const html = kept?.value.endsWith('\n') === false ? `${kept.value}\n` : kept?.value
    if (kept !== undefined) return { ...record, format: kept.format, value: html } as T
  }
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

const GFM_HTML = (): HtmlExtension[] => [gfmAutolinkLiteralHtml(), gfmFootnoteHtml(), gfmStrikethroughHtml(), gfmTableHtml(),
  gfmTaskListItemHtml()]

/** Markdown (CommonMark) or GFM to HTML with micromark. */
export function markdownHtml(input: string, format: 'markdown' | 'gfm', sink: Sink): string {
  return micromark(input, {
    allowDangerousHtml: true,
    allowDangerousProtocol: true,
    extensions: [frontmatter(['yaml', 'toml']), math(), containerDirectives(), ...(format === 'gfm' ? [gfm()] : [])],
    htmlExtensions: [frontmatterCapture(sink), rawHtmlCarrier(sink), mathHtml(), directiveHandlers(),
      ...(format === 'gfm' ? GFM_HTML() : [])],
  })
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

interface InTags { inTags: (tag: string, node: unknown, newlines: number, extra: Record<string, string>) => string }

/** Djot to HTML with djot.js, the reference implementation; raw content of every format is carried as in Markdown. */
export function djotHtml(input: string, sink: Sink): string {
  const doc = parseDjot(input, { sourcePositions: false })
  ensureForeignDepth(doc, 'djot')
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
export function importThroughHtml(input: string, format: HubFormat): ImportResult {
  const sink: Sink = { raw: [] }
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
    finish: children => [...lead, ...(sink.raw.length > 0 ? restoreRaw(children, sink.raw) : children)] })
  // The libraries' own line breaks around tags are no whitespace of the input.
  return { ...result, diagnostics: withoutHtmlRanges(result.diagnostics) }
}
