// BBCode import (JavaScript only). No maintained BBCode-to-HTML library fits, so this module writes the HTML itself,
// with the tag set of the 0.1 `bbcodeToCarve`, and the 0.2 HTML importer and the writer do the rest.
import { ImportInputError, type ImportDiagnostic, type ImportResult, withoutHtmlRanges } from './kit.ts'
import { importHtml } from './html.ts'
import { readAttribution } from './bbcode-quote.ts'

/** The 0.1 limit: BBCode is bounded forum content, and a larger input is refused. */
export const BBCODE_MAX_INPUT_LENGTH = 262144

export class BbcodeInputTooLargeError extends ImportInputError {
  constructor(length: number) {
    super(`BBCode input exceeds maximum length of ${BBCODE_MAX_INPUT_LENGTH} bytes (got ${length})`, 'bbcode')
    this.name = 'BbcodeInputTooLargeError'
  }
}

interface Tag { kind: 'tag', name: string, value: string | undefined, children: Item[], start: number, end: number }
type Item = string | Tag

const BLOCK = new Set(['quote', 'code', 'list', 'hr', 'table', 'spoiler', 'center', 'left', 'right'])
const VOID = new Set(['hr', '*'])
const VERBATIM = new Set(['code', 'noparse', 'c', 'icode'])
const INLINE: Record<string, string> = { b: 'strong', i: 'em', u: 'u', s: 'del', strike: 'del', sup: 'sup', sub: 'sub' }
const PLAIN = new Set(['color', 'size', 'font'])
const KNOWN = new Set([...BLOCK, ...VERBATIM, ...Object.keys(INLINE), ...PLAIN, 'url', 'email', 'img', 'youtube',
  'tr', 'td', 'th', '*'])
const TAG = /\[(\/?)([a-z*]+)(?:=([^\]]*)|[ \t]+([^\]]*))?\]/giu

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

function unquote(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const quoted = value.length >= 2 && (value.startsWith('"') && value.endsWith('"') || value.startsWith("'") && value.endsWith("'"))
  return quoted ? value.slice(1, -1) : value
}

/** Tags pair by name on a stack; a close with no open, and an open never closed, stay literal text. */
class BbcodeReader {
  readonly root: Tag = { kind: 'tag', name: '', value: undefined, children: [], start: 0, end: 0 }
  private readonly stack: Tag[] = [this.root]
  private at = 0
  private readonly input: string
  private readonly diagnostics: ImportDiagnostic[]

  constructor(input: string, diagnostics: ImportDiagnostic[]) {
    this.input = input
    this.diagnostics = diagnostics
  }

  private get top(): Tag { return this.stack.at(-1) ?? this.root }

  private text(value: string): void {
    if (value === '') return
    const children = this.top.children
    const last = children.at(-1)
    if (typeof last === 'string') children[children.length - 1] = last + value
    else children.push(value)
  }

  read(): Item[] {
    const pattern = new RegExp(TAG.source, TAG.flags)
    for (let match = pattern.exec(this.input); match !== null; match = pattern.exec(this.input)) this.tag(match)
    this.text(this.input.slice(this.at))
    this.unwindUnclosed()
    return this.root.children
  }

  private tag(match: RegExpExecArray): void {
    const [whole, slash, rawName] = match
    const name = (rawName ?? '').toLowerCase()
    if (VERBATIM.has(this.top.name) && !(slash && name === this.top.name)) return
    this.text(this.input.slice(this.at, match.index))
    this.at = match.index + whole.length
    if (!KNOWN.has(name)) {
      if (!slash) this.diagnostics.push({ code: 'import-unsupported', severity: 'warning', channel: 'render-loss',
        foreignType: `bbcode:${name}`, message: `BBCode tag [${name}] has no counterpart; its content is kept` })
      return
    }
    if (slash) this.close(name, whole)
    else this.open(name, match, whole)
  }

  private close(name: string, whole: string): void {
    const open = lastIndexOf(this.stack, name)
    if (open <= 0) { this.text(whole); return }
    while (this.stack.length > open) {
      const closed = this.stack.pop()
      if (closed !== undefined) closed.end = this.at
    }
  }

  private open(name: string, match: RegExpExecArray, whole: string): void {
    if (name === '*') {
      if (this.top.name === '*') this.stack.pop()
      if (this.top.name !== 'list') { this.text(whole); return }
    }
    const raw = match[3] ?? match[4]
    const value = name === 'quote' ? raw : unquote(raw)
    const tag: Tag = { kind: 'tag', name, value, children: [], start: match.index, end: this.at }
    this.top.children.push(tag)
    if (!VOID.has(name) || name === '*') this.stack.push(tag)
  }

  /** An unclosed tag is literal text again, and its content stays in place. */
  private unwindUnclosed(): void {
    while (this.stack.length > 1) {
      const open = this.stack.pop()
      if (open === undefined || open.name === '*') continue
      const parent = this.top
      parent.children.splice(parent.children.indexOf(open), 1, literalOpen(this.input, open), ...open.children)
    }
  }
}

function literalOpen(input: string, tag: Tag): string {
  const close = input.indexOf(']', tag.start)
  return input.slice(tag.start, close + 1)
}

function lastIndexOf(stack: Tag[], name: string): number {
  for (let index = stack.length - 1; index >= 0; index--) if (stack[index]?.name === name) return index
  return -1
}

function plainText(items: Item[]): string {
  return items.map(item => typeof item === 'string' ? item : plainText(item.children)).join('')
}

function inlineHtml(items: Item[]): string {
  return items.map(item => typeof item === 'string' ? escapeHtml(item) : inlineTag(item)).join('')
}

function safeHref(value: string): string {
  return escapeHtml(value.trim())
}

function inlineTag(tag: Tag): string {
  const element = INLINE[tag.name]
  if (element !== undefined) return `<${element}>${inlineHtml(tag.children)}</${element}>`
  switch (tag.name) {
    case 'c':
    case 'icode': return `<code>${escapeHtml(plainText(tag.children))}</code>`
    case 'noparse': return escapeHtml(plainText(tag.children))
    case 'url': {
      const href = tag.value ?? plainText(tag.children)
      return `<a href="${safeHref(href)}">${tag.value === undefined ? escapeHtml(href.trim()) : inlineHtml(tag.children)}</a>`
    }
    case 'email': {
      const address = (tag.value ?? plainText(tag.children)).trim()
      return `<a href="mailto:${escapeHtml(address)}">${tag.value === undefined ? escapeHtml(address) : inlineHtml(tag.children)}</a>`
    }
    case 'img': return `<img src="${safeHref(plainText(tag.children))}" alt="${escapeHtml(tag.value ?? '')}">`
    case 'youtube': {
      const url = `https://www.youtube.com/watch?v=${encodeURIComponent(plainText(tag.children).trim())}`
      return `<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`
    }
    default: return inlineHtml(tag.children)
  }
}

/** A block container's children: block tags stand alone, and inline runs split into paragraphs at blank lines. */
function blocksHtml(items: Item[]): string {
  const out: string[] = []
  let run: Item[] = []
  const flush = (): void => {
    const paragraphs: Item[][] = [[]]
    for (const item of run) {
      if (typeof item !== 'string') { paragraphs.at(-1)?.push(item); continue }
      const parts = item.split(/\n[ \t]*\n\s*/u)
      parts.forEach((part, index) => {
        if (index > 0) paragraphs.push([])
        paragraphs.at(-1)?.push(part)
      })
    }
    for (const paragraph of paragraphs) {
      const html = inlineHtml(paragraph).trim()
      if (html !== '') out.push(`<p>${html}</p>`)
    }
    run = []
  }
  for (const item of items) {
    if (typeof item === 'string' || !BLOCK.has(item.name)) { run.push(item); continue }
    flush()
    out.push(blockTag(item))
  }
  flush()
  return out.join('\n')
}

function blockTag(tag: Tag): string {
  switch (tag.name) {
    case 'hr': return '<hr>'
    case 'code': return codeHtml(tag)
    case 'quote': {
      const quote = `<blockquote>${blocksHtml(tag.children)}</blockquote>`
      const caption = tag.value === undefined ? '' : readAttribution(tag.value).caption
      return caption ? `<figure>${quote}<figcaption>${escapeHtml(caption)}</figcaption></figure>` : quote
    }
    case 'spoiler': return `<div class="spoiler">${blocksHtml(tag.children)}</div>`
    case 'center':
    case 'left':
    case 'right': return `<div style="text-align: ${tag.name};">${blocksHtml(tag.children)}</div>`
    case 'list': return listHtml(tag)
    case 'table': return tableHtml(tag)
    default: return blocksHtml(tag.children)
  }
}

function codeHtml(tag: Tag): string {
  const code = plainText(tag.children).replace(/^\n/u, '')
  // A leading `=` would make the fence a raw block (`[code= =html]`), so it is cut, as in 0.1.
  const language = tag.value?.trim().toLowerCase().replace(/^=+/u, '').trimStart()
  return `<pre><code${language ? ` class="language-${escapeHtml(language)}"` : ''}>${escapeHtml(code)}</code></pre>`
}

function listHtml(tag: Tag): string {
  const items = tag.children.filter(item => isTag(item, '*'))
  const ordered = tag.value !== undefined && tag.value !== ''
  const type = ordered && /^[aAiI]$/u.test(tag.value ?? '') ? ` type="${tag.value}"` : ''
  const body = items.map(item => `<li>${itemHtml(item.children)}</li>`).join('')
  return ordered ? `<ol${type}>${body}</ol>` : `<ul>${body}</ul>`
}

/** A list item of one paragraph is written bare, as a tight list writes it (C2-M-033). */
function itemHtml(items: Item[]): string {
  const blank = items.some(item => typeof item === 'string' && /\n[ \t]*\n/u.test(item.trim()))
  return blank || items.some(item => typeof item !== 'string' && BLOCK.has(item.name)) ? blocksHtml(items) : inlineHtml(items).trim()
}

function isTag(item: Item, ...names: string[]): item is Tag {
  return typeof item !== 'string' && names.includes(item.name)
}

/** Rows of `[tr]` with `[td]` and `[th]` cells; a first row of header cells only is the table head. */
function tableHtml(tag: Tag): string {
  const rows = tag.children.filter(row => isTag(row, 'tr')).map(row => row.children.filter(cell => isTag(cell, 'td', 'th')))
  const rowHtml = (cells: Tag[]): string =>
    `<tr>${cells.map(cell => `<${cell.name}>${inlineHtml(cell.children).trim()}</${cell.name}>`).join('')}</tr>`
  const first = rows[0]
  const head = first !== undefined && first.length > 0 && first.every(cell => cell.name === 'th')
  const body = (head ? rows.slice(1) : rows).map(rowHtml).join('')
  return `<table>${head && first ? `<thead>${rowHtml(first)}</thead>` : ''}${body ? `<tbody>${body}</tbody>` : ''}</table>`
}

/** BBCode as the HTML this module writes for it; exported for the measurements. */
export function bbcodeHtml(input: string, diagnostics: ImportDiagnostic[] = []): string {
  return blocksHtml(new BbcodeReader(input.replace(/\r\n?/gu, '\n'), diagnostics).read())
}

export function importBbcode(input: string): ImportResult {
  const length = new TextEncoder().encode(input).length
  if (length > BBCODE_MAX_INPUT_LENGTH) throw new BbcodeInputTooLargeError(length)
  const diagnostics: ImportDiagnostic[] = []
  const html = bbcodeHtml(input, diagnostics)
  const result = importHtml(html, false)
  return { ...result, diagnostics: [...diagnostics, ...withoutHtmlRanges(result.diagnostics)] }
}
