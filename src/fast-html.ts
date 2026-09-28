import { slugify, headingIdSlugOpts } from './heading-ids.js'
import { escapeAttrValue, escapeHtml, sanitizeUrl, type RenderOptions } from './render-html.js'
import type { ParseOptions } from './parse.js'
import { normalizeRefLabel } from './label-key.js'
import { linkDestinationValue } from './link-destination.js'

type Options = ParseOptions & RenderOptions & { profile?: unknown }
type LinkDef = { href: string; title?: string }

export type FastHtmlStats = {
  headings: number
  paragraphs: number
  blockQuotes: number
  codeFences: number
  thematicBreaks: number
  unorderedListItems: number
  orderedListItems: number
  tableRows: number
  linkDefinitions: number
  consumedLines: number
  activeDefinitions: number
}

type LayoutEvent = keyof Omit<FastHtmlStats, 'consumedLines' | 'activeDefinitions'>
export type FastHtmlResult = { html: string; accepted: FastHtmlStats }


class HtmlOutput {
  private parts: string[] = []
  private pending = ''
  private wrote = false
  constructor(private sink?: (chunk: string) => void, private discard = false) {}
  push(...parts: string[]): void {
    if (this.discard) return
    if (!this.sink) { this.parts.push(...parts); return }
    for (let part of parts) {
      while (part.length) {
        let end = Math.min(part.length, 4096 - this.pending.length)
        const newline = part.slice(0, end).indexOf('\n')
        if (newline >= 0 && newline < end) end = newline + 1
        this.pending += part.slice(0, end)
        part = part.slice(end)
        if (this.pending.length === 4096 || this.pending.endsWith('\n')) this.flush()
      }
    }
  }
  text(text: string): void { this.escape(text, escapeHtml) }
  attr(text: string): void { this.escape(text, escapeAttrValue) }
  private escape(text: string, escape: (text: string) => string): void {
    if (this.discard) return
    if (!this.sink) { this.push(escape(text)); return }
    for (let i = 0; i < text.length; i += 512) this.push(escape(text.slice(i, i + 512)))
  }
  private flush(): void {
    if (!this.pending) return
    this.sink!(this.pending)
    this.pending = ''
    this.wrote = true
  }
  finish(): string {
    if (this.sink) {
      this.flush()
      if (!this.wrote) this.sink('')
    }
    return this.parts.join('')
  }
}

export function tryFastHtmlStreaming(source: string, options: Options, sink: (chunk: string) => void): boolean {
  const opts = { ...options,
    ...(options.extensions ? { extensions: [...options.extensions] } : {}),
    ...(options.allowedUrlSchemes ? { allowedUrlSchemes: [...options.allowedUrlSchemes] } : {}),
    ...(options.deniedUrlSchemes ? { deniedUrlSchemes: [...options.deniedUrlSchemes] } : {}),
  }
  if (!tryFastHtmlAttempt(source, opts, new HtmlOutput(undefined, true))) return false
  const out = new HtmlOutput(sink)
  if (!tryFastHtmlAttempt(source, opts, out)) throw new Error('validated layout changed during rendering')
  out.finish()
  return true
}

function emptyStats(): FastHtmlStats {
  return {
    headings: 0, paragraphs: 0, blockQuotes: 0, codeFences: 0,
    thematicBreaks: 0, unorderedListItems: 0, orderedListItems: 0,
    tableRows: 0, linkDefinitions: 0, consumedLines: 0, activeDefinitions: 0,
  }
}

function accept(stats: FastHtmlStats | undefined, event: LayoutEvent, start: number, end: number, activeDefinition = false): void {
  if (!stats) return
  stats[event]++
  stats.consumedLines += end - start
  if (activeDefinition) stats.activeDefinitions++
}

/** Conservative borrowed renderer for the common stateless HTML subset. */
export function tryFastHtml(source: string, opts: Options): string | undefined {
  const out = new HtmlOutput()
  return tryFastHtmlAttempt(source, opts, out) ? out.finish() : undefined
}

/** Test/benchmark observer; normal rendering does not allocate counters. */
export function tryFastHtmlWithStats(source: string, opts: Options): FastHtmlResult | undefined {
  const accepted = emptyStats()
  const out = new HtmlOutput()
  const html = tryFastHtmlAttempt(source, opts, out, accepted) ? out.finish() : undefined
  return html === undefined ? undefined : { html, accepted }
}

function tryFastHtmlAttempt(source: string, opts: Options, out: HtmlOutput, stats?: FastHtmlStats): true | undefined {
  if (
    opts.extensions?.length || opts.profile !== undefined || opts.sourceLine ||
    (opts as RenderOptions & { mode?: unknown }).mode !== undefined ||
    opts.sections === false || opts.smartTypography === false || opts.smartTypography === 'source' ||
    !isAscii(source) || /[\0\t\v\f\r]/.test(source) || source.startsWith('---') ||
    source.includes('[^') || source.includes('^[') || source.includes('[@') ||
    source.includes('</#') || source.includes('![') || source.includes('%%') ||
    source.includes(':::')
  ) return undefined

  const lines = source.split('\n')
  if (lines.at(-1) === '') lines.pop()
  if (lines.some((line) => / +$/.test(line))) return undefined
  // A LONE `+` IS THE LIST CONTINUATION MARKER (§17 L3), never a paragraph. It
  // renders NOTHING and attaches the block below it to the item above, which the
  // borrowed layout has no model for - so the document goes to the authoritative
  // pipeline, exactly as `%%`, `:::` and the footnote forms above do.
  //
  // Without this the marker was rendered as its own literal `<p>+</p>`, visible
  // in the output, and the item it should have attached to was closed instead:
  // `- a` / blank / `+` / blank / `- b` came back as two lists with a stray
  // paragraph between them. Corpus 251 pins the shape - a blank line before the
  // marker changes nothing about what it is.
  //
  // The bullet renderer already refuses `- +` (a marker as an item's content);
  // this is the same construct standing on its own line, which nothing checked.
  if (lines.some((line) => /^[ \t]*\+[ \t]*$/.test(line))) return undefined
  const collected = collectDefs(lines, stats !== undefined)
  if (!collected) return undefined
  if (stats) for (const line of collected.definitionLines ?? []) accept(stats, 'linkDefinitions', line, line + 1, true)
  return renderBlocks(lines, collected.defs, opts, out, stats)
}

function isAscii(source: string): boolean {
  for (let i = 0; i < source.length; i++) if (source.charCodeAt(i) > 0x7f) return false
  return true
}

function collectDefs(lines: string[], observe: boolean): { defs: Map<string, LinkDef>; definitionLines?: number[] } | undefined {
  const defs = new Map<string, LinkDef>()
  const definitionLines = observe ? [] as number[] : undefined
  let last = -1
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i]!.includes(']:')) { last = i; break }
  }
  if (last < 0) return { defs, ...(definitionLines ? { definitionLines } : {}) }
  let fence: { char: string; len: number } | undefined
  for (let i = 0; i <= last; i++) {
    const line = lines[i]!
    if (fence) {
      if (isFenceClose(line, fence)) fence = undefined
      continue
    }
    const open = fenceOpen(line)
    if (open) { fence = open; continue }
    if (!line.includes(']:')) continue
    // EXACTLY ONE SPACE IN EACH METADATA SLOT (corpus 265). `\s*` and `\s+`
    // accepted `[a]: /u  "T"`, which is NOT a definition - it renders as an
    // ordinary paragraph - and the fast path collected it and emitted nothing, so
    // the line vanished from the output. A definition the borrowed layout does not
    // recognize is handed back below rather than guessed at, which is why
    // tightening the pattern is the whole fix.
    const match = /^\[([^\]]+)\]: (\S+)(?: "([^"]*)")?$/.exec(line)
    if (!match || match[1]!.startsWith('@')) return undefined
    if (i > 0 && lines[i - 1]!.trim() !== '') return undefined
    if (i + 1 < lines.length && lines[i + 1]!.trim() !== '') return undefined
    // The run still has to BE a `link_destination`: it admits a parenthesis
    // only balanced or escaped, and it carries the three escapes. Read here by
    // the production's own reader rather than by the pattern above, which
    // collected `[a]: a(b` with the lone parenthesis in the href.
    const href = linkDestinationValue(match[2]!)
    if (href === null) return undefined
    defs.set(normalizeRefLabel(match[1]!), { href, ...(match[3] === undefined ? {} : { title: match[3] }) })
    definitionLines?.push(i)
  }
  return { defs, ...(definitionLines ? { definitionLines } : {}) }
}

function renderBlocks(lines: string[], defs: Map<string, LinkDef>, opts: Options, out: HtmlOutput, stats?: FastHtmlStats): true | undefined {
  const sections: number[] = []
  const ids = new Map<string, number>()
  let i = 0
  let wrote = false
  while (i < lines.length) {
    const line = lines[i]!
    if (line.trim() === '' || /^\[[^\]]+\]:/.test(line)) { i++; continue }
    const heading = /^(#{1,6}) +(.*)$/.exec(line)
    if (heading) {
      const level = heading[1]!.length
      const title = heading[2]!.trimEnd()
      if (/[*\/`[]/.test(title) || (title.match(/:/g)?.length ?? 0) >= 2 || inlineComplex(title)) return undefined
      while (sections.at(-1) !== undefined && sections.at(-1)! >= level) {
        out.push('\n', indent(sections.length - 1), '</section>')
        sections.pop()
      }
      if (wrote) out.push('\n')
      const base = slugify(title, headingIdSlugOpts(opts))
      let count = ids.get(base) ?? 2
      let id = base
      if (ids.has(base)) {
        while (ids.has(`${base}-${count}`)) count++
        id = `${base}-${count}`
        ids.set(base, count + 1)
      }
      ids.set(id, 2)
      out.push(indent(sections.length), '<section id="'); out.attr(id)
      out.push('">\n', indent(sections.length + 1), `<h${level}>`)
      out.text(title); out.push(`</h${level}>`)
      if (stats) accept(stats, 'headings', i, i + 1)
      sections.push(level); wrote = true; i++; continue
    }
    if (wrote) out.push('\n')
    const depth = sections.length
    const fence = fenceOpen(line)
    if (fence) {
      if (fence.char !== '`' || line.startsWith(' ') || line.startsWith('>')) return undefined
      let close = i + 1
      while (close < lines.length && !isFenceClose(lines[close]!, fence)) close++
      if (close >= lines.length) return undefined
      const infoSlot = line.slice(fence.len)
      if (infoSlot.startsWith('  ')) return undefined
      const info = infoSlot.trim()
      if (info && !/^[A-Za-z0-9-]+$/.test(info)) return undefined
      out.push(indent(depth), '<pre><code', info ? ` class="language-${info}"` : '', '>')
      for (let j = i + 1; j < close; j++) { out.text(lines[j]!); out.push('\n') }
      // AN EMPTY PAYLOAD IS STILL A LINE. With no body lines the loop above emits
      // nothing at all, so an empty fence came back `<pre><code></code></pre>`
      // while the authoritative pipeline renders `<pre><code>\n</code></pre>` -
      // the shape corpus 276 pins for an empty code block.
      if (close === i + 1) out.push('\n')
      out.push('</code></pre>')
      if (stats) accept(stats, 'codeFences', i, close + 1)
      i = close + 1; wrote = true; continue
    }
    if (line.startsWith('- ')) {
      const rendered = renderList(lines, i, 0, depth, defs, opts, out, stats)
      if (!rendered) return undefined
      i = rendered.next; wrote = true; continue
    }
    if (thematicBreak(line)) {
      out.push(indent(depth), '<hr>')
      if (stats) accept(stats, 'thematicBreaks', i, i + 1)
      i++; wrote = true; continue
    }
    if (decimalListItem(line)) {
      const rendered = renderOrderedList(lines, i, depth, defs, opts, out, stats)
      if (!rendered) return undefined
      i = rendered.next; wrote = true; continue
    }
    if (line.startsWith('> ')) {
      const start = i
      out.push(indent(depth), '<blockquote><p>')
      while (lines[i]?.startsWith('> ')) {
        const text = lines[i]!.slice(2)
        if (blockish(text)) return undefined
        if (i > start) out.push('\n')
        if (!renderInline(text, defs, opts, out)) return undefined
        i++
      }
      if (lines[i] !== undefined && lines[i]!.trim() !== '') return undefined
      out.push('</p></blockquote>')
      if (stats) accept(stats, 'blockQuotes', start, i)
      wrote = true; continue
    }
    if (line.startsWith('|')) {
      const rendered = renderTable(lines, i, depth, defs, opts, out, stats)
      if (!rendered) return undefined
      i = rendered.next; wrote = true; continue
    }
    if (blockish(line)) return undefined
    const start = i
    out.push(indent(depth), '<p>')
    while (lines[i] !== undefined && lines[i]!.trim() !== '') {
      if (blockish(lines[i]!)) return undefined
      if (i > start) out.push('\n')
      if (!renderInline(lines[i]!, defs, opts, out)) return undefined
      i++
    }
    out.push('</p>')
    if (stats) accept(stats, 'paragraphs', start, i)
    wrote = true
  }
  while (sections.length) out.push('\n', indent(sections.length - 1), '</section>'), sections.pop()
  return true
}

function renderInline(text: string, defs: Map<string, LinkDef>, opts: Options, out: HtmlOutput): true | undefined {
  if (inlineComplex(text)) return undefined
  let i = 0, plain = 0
  while (i < text.length) {
    const delimiter = text[i]!
    if (!'*\/`['.includes(delimiter)) { i++; continue }
    out.text(text.slice(plain, i))
    if (delimiter === '*' || delimiter === '/') {
      const close = text.indexOf(delimiter, i + 1)
      if (close <= i + 1 || /\s/.test(text[i + 1]!) || /\s/.test(text[close - 1]!) ||
        (i > 0 && (/[A-Za-z0-9]/.test(text[i - 1]!) || text[i - 1] === delimiter)) ||
        /[A-Za-z0-9]/.test(text[close + 1] ?? '')) return undefined
      const tag = delimiter === '*' ? 'strong' : 'em'
      out.push(`<${tag}>`)
      if (!renderInline(text.slice(i + 1, close), defs, opts, out)) return undefined
      out.push(`</${tag}>`); i = close + 1
    } else if (delimiter === '`') {
      const close = text.indexOf('`', i + 1)
      if (close < 0) return undefined
      const code = text.slice(i + 1, close)
      if (/^\s|\s$/.test(code)) return undefined
      out.push('<code>'); out.text(code); out.push('</code>'); i = close + 1
    } else {
      const labelEnd = text.indexOf(']', i + 1)
      if (labelEnd < 0) return undefined
      const label = text.slice(i + 1, labelEnd)
      let href: string, title: string | undefined, end: number
      if (text[labelEnd + 1] === '(') {
        const close = text.indexOf(')', labelEnd + 2)
        href = text.slice(labelEnd + 2, close)
        if (close < 0 || !href || /[\s(]/.test(href)) return undefined
        end = close + 1
      } else if (text[labelEnd + 1] === '[') {
        const close = text.indexOf(']', labelEnd + 2)
        if (close < 0) return undefined
        const def = defs.get(normalizeRefLabel(text.slice(labelEnd + 2, close)))
        if (!def) return undefined
        href = def.href; title = def.title; end = close + 1
      } else return undefined
      out.push('<a href="'); out.attr(sanitizeUrl(href, opts)); out.push('"')
      if (title !== undefined) { out.push(' title="'); out.attr(title); out.push('"') }
      out.push('>')
      if (!renderInline(label, defs, opts, out)) return undefined
      out.push('</a>')
      i = end
    }
    plain = i
  }
  out.text(text.slice(plain))
  return true
}

function inlineComplex(text: string): boolean {
  let colons = 0
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    if (`{}^\\<>_~!@$=#'"`.includes(c)) return true
    if (c === ':' && ++colons === 2) return true
    const tail = text.slice(i)
    if (tail.startsWith('--') || tail.startsWith('...') || tail.startsWith('/*') ||
      tail.startsWith('*/') || tail.startsWith('``') || tail.startsWith('+-') ||
      tail.startsWith('(c)') || tail.startsWith('(r)') || tail.startsWith('(tm)')) return true
  }
  return false
}

function renderList(lines: string[], start: number, offset: number, depth: number, defs: Map<string, LinkDef>, opts: Options, out: HtmlOutput, stats?: FastHtmlStats): { next: number } | undefined {
  out.push(indent(depth), '<ul>')
  let i = start
  while (i < lines.length) {
    const line = lines[i]!, leading = line.length - line.trimStart().length
    if (leading < offset) break
    if (leading !== offset || !line.slice(leading).startsWith('- ')) return undefined
    const text = line.slice(leading + 2)
    if (!text || text.startsWith(' ') || text === '+' || blockish(text)) return undefined
    if (stats) accept(stats, 'unorderedListItems', i, i + 1)
    out.push('\n', indent(depth + 1), '<li>')
    if (!renderInline(text, defs, opts, out)) return undefined
    i++
    if (lines[i] !== undefined) {
      const nextIndent = lines[i]!.length - lines[i]!.trimStart().length
      if (nextIndent > offset) {
        if (nextIndent !== offset + 2 || !lines[i]!.slice(nextIndent).startsWith('- ')) return undefined
        out.push('\n')
        const nested = renderList(lines, i, offset + 2, depth + 2, defs, opts, out, stats)
        if (!nested) return undefined
        out.push('\n', indent(depth + 1)); i = nested.next
      }
    }
    out.push('</li>')
    if (i >= lines.length) break
    if (lines[i]!.trim() === '') {
      const next = lines.slice(i + 1).find((candidate) => candidate.trim() !== '')
      if (next && next.length - next.trimStart().length === offset && next.trimStart().startsWith('- ')) return undefined
      break
    }
  }
  out.push('\n', indent(depth), '</ul>')
  return { next: i }
}

function decimalListItem(line: string): { number: number; text: string } | undefined {
  const match = /^(\d+)\. ([^ ].*)$/.exec(line)
  if (!match) return undefined
  const number = Number(match[1])
  return Number.isSafeInteger(number) && number > 0 ? { number, text: match[2]! } : undefined
}

function renderOrderedList(lines: string[], start: number, depth: number, defs: Map<string, LinkDef>, opts: Options, out: HtmlOutput, stats?: FastHtmlStats): { next: number } | undefined {
  const first = decimalListItem(lines[start]!)
  if (!first) return undefined
  out.push(indent(depth), '<ol', first.number === 1 ? '' : ` start="${first.number}"`, '>')
  let i = start, expected = first.number
  while (i < lines.length) {
    const item = decimalListItem(lines[i]!)
    if (!item) break
    if (item.number !== expected || item.text === '+' || blockish(item.text)) return undefined
    out.push('\n', indent(depth + 1), '<li>')
    if (!renderInline(item.text, defs, opts, out)) return undefined
    out.push('</li>')
    if (stats) accept(stats, 'orderedListItems', i, i + 1)
    expected++; i++
  }
  if (lines[i] !== undefined && lines[i]!.trim() !== '') return undefined
  if (lines[i] !== undefined) {
    const next = lines.slice(i + 1).find((candidate) => candidate.trim() !== '')
    if (next !== undefined && decimalListItem(next) !== undefined) return undefined
  }
  out.push('\n', indent(depth), '</ol>')
  return { next: i }
}

function renderTable(lines: string[], start: number, depth: number, defs: Map<string, LinkDef>, opts: Options, out: HtmlOutput, stats?: FastHtmlStats): { next: number } | undefined {
  const heads = cells(lines[start]!), delimiter = cells(lines[start + 1] ?? '')
  if (!heads || !delimiter || !heads.length || heads.length !== delimiter.length) return undefined
  if (heads.some((cell) => cell === '^' || cell === '<')) return undefined
  const aligns = delimiter.map((cell) => alignment(cell))
  if (aligns.some((value) => value === false)) return undefined
  const renderCell = (tag: 'th' | 'td', cell: string, index: number): true | undefined => {
    const scope = tag === 'th' ? ' scope="col"' : ''
    const style = aligns[index] ? ` style="text-align: ${aligns[index]};"` : ''
    out.push(`<${tag}${scope}${style}>`)
    if (!renderInline(cell, defs, opts, out)) return undefined
    out.push(`</${tag}>`)
    return true
  }
  if (stats) accept(stats, 'tableRows', start, start + 2)
  let i = start + 2
  const rows: string[][] = []
  while (lines[i]?.trimStart().startsWith('|')) {
    const row = cells(lines[i]!)
    if (!row || row.length !== heads.length) return undefined
    if (row.some((cell) => cell === '^' || cell === '<')) return undefined
    if (stats) accept(stats, 'tableRows', i, i + 1)
    rows.push(row); i++
  }
  if (!rows.length) return undefined
  out.push(indent(depth), '<table>\n', indent(depth + 1), '<thead>\n', indent(depth + 2), '<tr>')
  for (const [index, cell] of heads.entries()) if (!renderCell('th', cell, index)) return undefined
  out.push('</tr>\n', indent(depth + 1), '</thead>\n', indent(depth + 1), '<tbody>')
  for (const row of rows) {
    out.push('\n', indent(depth + 2), '<tr>')
    for (const [index, cell] of row.entries()) if (!renderCell('td', cell, index)) return undefined
    out.push('</tr>')
  }
  out.push('\n', indent(depth + 1), '</tbody>\n', indent(depth), '</table>')
  return { next: i }
}

function cells(line: string): string[] | undefined {
  const trimmed = line.trim()
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|') || trimmed.includes('\\|')) return undefined
  return trimmed.slice(1, -1).split('|').map((cell) => cell.trim())
}

function alignment(cell: string): string | undefined | false {
  const left = cell.startsWith(':'), right = cell.endsWith(':')
  const core = cell.replace(/^:/, '').replace(/:$/, '').trim()
  if (core.length < 3 || !/^-+$/.test(core)) return false
  return left && right ? 'center' : right ? 'right' : left ? 'left' : undefined
}

function blockish(text: string): boolean {
  return /^(?:\s|#|\* |\+ |- |>|\||\{|:::|```|~~~|\.{1,9} |[A-Za-z0-9]+[.)] )/.test(text) || /^(?:---+|\*\*\*+)$/.test(text)
}
function thematicBreak(line: string): boolean {
  return /^(?:-{3,}|\*{3,}|_{3,})$/.test(line)
}
function fenceOpen(line: string): { char: string; len: number } | undefined {
  const match = /^(`{3,}|~{3,})/.exec(line)
  return match ? { char: match[1]![0]!, len: match[1]!.length } : undefined
}
function isFenceClose(line: string, fence: { char: string; len: number }): boolean {
  const match = new RegExp(`^${fence.char}{${fence.len},}\\s*$`).exec(line)
  return match !== null
}
function indent(level: number): string { return '  '.repeat(level) }
