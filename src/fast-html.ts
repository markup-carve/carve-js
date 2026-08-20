import { slugify, headingIdSlugOpts } from './heading-ids.js'
import { escapeAttrValue, escapeHtml, sanitizeUrl, type RenderOptions } from './render-html.js'
import type { ParseOptions } from './parse.js'

type Options = ParseOptions & RenderOptions & { profile?: unknown }
type LinkDef = { href: string; title?: string }

/** Conservative borrowed renderer for the common stateless HTML subset. */
export function tryFastHtml(source: string, opts: Options): string | undefined {
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
  const defs = collectDefs(lines)
  if (!defs) return undefined
  return renderBlocks(lines, defs, opts)
}

function isAscii(source: string): boolean {
  for (let i = 0; i < source.length; i++) if (source.charCodeAt(i) > 0x7f) return false
  return true
}

function collectDefs(lines: string[]): Map<string, LinkDef> | undefined {
  const defs = new Map<string, LinkDef>()
  let last = -1
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i]!.includes(']:')) { last = i; break }
  }
  if (last < 0) return defs
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
    const match = /^\[([^\]]+)\]:\s*(\S+?)(?:\s+"([^"]*)")?$/.exec(line)
    if (!match || match[1]!.startsWith('@')) return undefined
    if (i > 0 && lines[i - 1]!.trim() !== '') return undefined
    if (i + 1 < lines.length && lines[i + 1]!.trim() !== '') return undefined
    defs.set(match[1]!, { href: match[2]!, ...(match[3] === undefined ? {} : { title: match[3] }) })
  }
  return defs
}

function renderBlocks(lines: string[], defs: Map<string, LinkDef>, opts: Options): string | undefined {
  const out: string[] = []
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
      const count = (ids.get(base) ?? 0) + 1
      ids.set(base, count)
      const id = count === 1 ? base : `${base}-${count}`
      out.push(indent(sections.length), '<section id="', escapeAttrValue(id), '">\n',
        indent(sections.length + 1), `<h${level}>`, escapeHtml(title), `</h${level}>`)
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
      for (let j = i + 1; j < close; j++) out.push(escapeHtml(lines[j]!), '\n')
      out.push('</code></pre>')
      i = close + 1; wrote = true; continue
    }
    if (line.startsWith('- ')) {
      const rendered = renderList(lines, i, 0, depth, defs, opts)
      if (!rendered) return undefined
      out.push(rendered.html); i = rendered.next; wrote = true; continue
    }
    if (line.startsWith('> ')) {
      if (lines[i + 1] !== undefined && lines[i + 1]!.trim() !== '') return undefined
      const text = line.slice(2)
      if (blockish(text)) return undefined
      const html = renderInline(text, defs, opts)
      if (html === undefined) return undefined
      out.push(indent(depth), '<blockquote><p>', html, '</p></blockquote>')
      i++; wrote = true; continue
    }
    if (line.startsWith('|')) {
      const rendered = renderTable(lines, i, depth, defs, opts)
      if (!rendered) return undefined
      out.push(rendered.html); i = rendered.next; wrote = true; continue
    }
    if (blockish(line) || (lines[i + 1] !== undefined && lines[i + 1]!.trim() !== '')) return undefined
    const html = renderInline(line, defs, opts)
    if (html === undefined) return undefined
    out.push(indent(depth), '<p>', html, '</p>')
    i++; wrote = true
  }
  while (sections.length) out.push('\n', indent(sections.length - 1), '</section>'), sections.pop()
  return out.join('')
}

function renderInline(text: string, defs: Map<string, LinkDef>, opts: Options): string | undefined {
  if (inlineComplex(text)) return undefined
  const out: string[] = []
  let i = 0, plain = 0
  while (i < text.length) {
    const delimiter = text[i]!
    if (!'*\/`['.includes(delimiter)) { i++; continue }
    out.push(escapeHtml(text.slice(plain, i)))
    if (delimiter === '*' || delimiter === '/') {
      const close = text.indexOf(delimiter, i + 1)
      if (close <= i + 1 || /\s/.test(text[i + 1]!) || /\s/.test(text[close - 1]!) ||
        (i > 0 && /[A-Za-z0-9]/.test(text[i - 1]!)) || /[A-Za-z0-9]/.test(text[close + 1] ?? '')) return undefined
      const inner = renderInline(text.slice(i + 1, close), defs, opts)
      if (inner === undefined) return undefined
      const tag = delimiter === '*' ? 'strong' : 'em'
      out.push(`<${tag}>`, inner, `</${tag}>`); i = close + 1
    } else if (delimiter === '`') {
      const close = text.indexOf('`', i + 1)
      if (close < 0) return undefined
      const code = text.slice(i + 1, close)
      if (/^\s|\s$/.test(code)) return undefined
      out.push('<code>', escapeHtml(code), '</code>'); i = close + 1
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
        const def = defs.get(text.slice(labelEnd + 2, close))
        if (!def) return undefined
        href = def.href; title = def.title; end = close + 1
      } else return undefined
      const inner = renderInline(label, defs, opts)
      if (inner === undefined) return undefined
      out.push('<a href="', escapeAttrValue(sanitizeUrl(href, opts)), '"',
        title === undefined ? '' : ` title="${escapeAttrValue(title)}"`, '>', inner, '</a>')
      i = end
    }
    plain = i
  }
  out.push(escapeHtml(text.slice(plain)))
  return out.join('')
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

function renderList(lines: string[], start: number, offset: number, depth: number, defs: Map<string, LinkDef>, opts: Options): { html: string; next: number } | undefined {
  const out: string[] = [indent(depth), '<ul>']
  let i = start
  while (i < lines.length) {
    const line = lines[i]!, leading = line.length - line.trimStart().length
    if (leading < offset) break
    if (leading !== offset || !line.slice(leading).startsWith('- ')) return undefined
    const text = line.slice(leading + 2)
    if (!text || text.startsWith(' ') || text === '+' || blockish(text)) return undefined
    const inline = renderInline(text, defs, opts)
    if (inline === undefined) return undefined
    out.push('\n', indent(depth + 1), '<li>', inline); i++
    if (lines[i] !== undefined) {
      const nextIndent = lines[i]!.length - lines[i]!.trimStart().length
      if (nextIndent > offset) {
        if (nextIndent !== offset + 2 || !lines[i]!.slice(nextIndent).startsWith('- ')) return undefined
        const nested = renderList(lines, i, offset + 2, depth + 2, defs, opts)
        if (!nested) return undefined
        out.push('\n', nested.html, '\n', indent(depth + 1)); i = nested.next
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
  return { html: out.join(''), next: i }
}

function renderTable(lines: string[], start: number, depth: number, defs: Map<string, LinkDef>, opts: Options): { html: string; next: number } | undefined {
  const heads = cells(lines[start]!), delimiter = cells(lines[start + 1] ?? '')
  if (!heads || !delimiter || !heads.length || heads.length !== delimiter.length) return undefined
  const aligns = delimiter.map((cell) => alignment(cell))
  if (aligns.some((value) => value === false)) return undefined
  const renderCell = (tag: 'th' | 'td', cell: string, index: number): string | undefined => {
    const inline = renderInline(cell, defs, opts)
    if (inline === undefined) return undefined
    const scope = tag === 'th' ? ' scope="col"' : ''
    const style = aligns[index] ? ` style="text-align: ${aligns[index]};"` : ''
    return `<${tag}${scope}${style}>${inline}</${tag}>`
  }
  const header = heads.map((cell, index) => renderCell('th', cell, index))
  if (header.some((cell) => cell === undefined)) return undefined
  let i = start + 2
  const rows: string[][] = []
  while (lines[i]?.trimStart().startsWith('|')) {
    const row = cells(lines[i]!)
    if (!row || row.length !== heads.length) return undefined
    rows.push(row); i++
  }
  if (!rows.length) return undefined
  const out = [indent(depth), '<table>\n', indent(depth + 1), '<thead><tr>', header.join(''), '</tr></thead>\n', indent(depth + 1), '<tbody>']
  for (const row of rows) {
    const rendered = row.map((cell, index) => renderCell('td', cell, index))
    if (rendered.some((cell) => cell === undefined)) return undefined
    out.push('\n', indent(depth + 2), '<tr>', rendered.join(''), '</tr>')
  }
  out.push('\n', indent(depth + 1), '</tbody>\n', indent(depth), '</table>')
  return { html: out.join(''), next: i }
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
function fenceOpen(line: string): { char: string; len: number } | undefined {
  const match = /^(`{3,}|~{3,})/.exec(line)
  return match ? { char: match[1]![0]!, len: match[1]!.length } : undefined
}
function isFenceClose(line: string, fence: { char: string; len: number }): boolean {
  const match = new RegExp(`^${fence.char}{${fence.len},}\\s*$`).exec(line)
  return match !== null
}
function indent(level: number): string { return '  '.repeat(level) }
