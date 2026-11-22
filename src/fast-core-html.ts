/* eslint-disable complexity, sonarjs/cognitive-complexity -- the conservative scanner keeps every bailout at its grammar branch */
// A direct HTML path for the stateless, unambiguous ASCII core subset.
// Anything that needs the complete block or inline grammar returns undefined.
import { foldLabel } from './ast-attributes.ts'
import { escapeAttribute, escapeText, passesPolicy } from './html-attributes.ts'
import { type Settings } from './options.ts'
import { slugify } from './slug.ts'

interface Definition { href: string }
interface Result { html: string, next: number }

const MARK = /[*/`\[]/g
const COMPLEX = /[{}^\\<>_~!@$=#'"]|--|\.\.\.|\/\*|\*\/|``|\+-|\((?:c|r|tm)\)/
const BLOCK = /^(?:\s|#|\* |\+ |- |> |\||\{|:::|```|~~~|\.{1,9} |[A-Za-z0-9]+[.)] )/

function plain(text: string): boolean {
  return !COMPLEX.test(text) && !/[\x00-\x1f\x7f-\uffff]/.test(text)
}

function word(code: number): boolean {
  return code >= 48 && code <= 57 || code >= 65 && code <= 90 || code >= 97 && code <= 122
}

function inline(text: string, definitions: ReadonlyMap<string, Definition>, settings: Settings): string | undefined {
  if (text.includes('**') || text.includes('``')) return undefined
  let out = ''
  let at = 0
  let plainStart = 0
  while (at < text.length) {
    MARK.lastIndex = at
    const match = MARK.exec(text)
    if (match === null) break
    at = match.index
    const before = text.slice(plainStart, at)
    if (!plain(before)) return undefined
    out += escapeText(before)
    const mark = text[at]!
    if (mark === '*' || mark === '/') {
      const close = text.indexOf(mark, at + 1)
      if (close <= at + 1 || text[at + 1] === ' ' || text[close - 1] === ' ' ||
        (at > 0 && (word(text.charCodeAt(at - 1)) || text[at - 1] === mark)) ||
        word(text.charCodeAt(close + 1))) return undefined
      const child = inline(text.slice(at + 1, close), definitions, settings)
      if (child === undefined) return undefined
      const tag = mark === '*' ? 'strong' : 'em'
      out += `<${tag}>${child}</${tag}>`
      at = close + 1
    } else if (mark === '`') {
      const close = text.indexOf('`', at + 1)
      if (close <= at + 1 || text[at + 1] === ' ' || text[close - 1] === ' ') return undefined
      out += `<code>${escapeText(text.slice(at + 1, close))}</code>`
      at = close + 1
    } else {
      const labelEnd = text.indexOf(']', at + 1)
      if (labelEnd < 0) return undefined
      const label = text.slice(at + 1, labelEnd)
      let href: string
      let end: number
      if (text[labelEnd + 1] === '(') {
        const close = text.indexOf(')', labelEnd + 2)
        if (close < 0) return undefined
        href = text.slice(labelEnd + 2, close)
        end = close + 1
      } else if (text[labelEnd + 1] === '[') {
        const close = text.indexOf(']', labelEnd + 2)
        if (close < 0) return undefined
        const definition = definitions.get(foldLabel(text.slice(labelEnd + 2, close)))
        if (definition === undefined) return undefined
        href = definition.href
        end = close + 1
      } else return undefined
      if (!/^https?:\/\/[A-Za-z0-9./_-]+$/.test(href) || !passesPolicy(settings, href)) return undefined
      const child = inline(label, definitions, settings)
      if (child === undefined) return undefined
      out += `<a href="${escapeAttribute(href)}">${child}</a>`
      at = end
    }
    plainStart = at
  }
  const rest = text.slice(plainStart)
  return plain(rest) ? out + escapeText(rest) : undefined
}

function indent(depth: number): string { return '  '.repeat(depth) }

/** A tight dash list, possibly with a nested list separated by one blank line. */
function list(lines: readonly string[], start: number, column: number, depth: number,
  definitions: ReadonlyMap<string, Definition>, settings: Settings): Result | undefined {
  if (depth > 64) return undefined
  const parts: string[] = [`${indent(depth)}<ul>`]
  let at = start
  let count = 0
  while (at < lines.length) {
    const line = lines[at]!
    if (!line.startsWith(`${' '.repeat(column)}- `)) break
    const body = line.slice(column + 2)
    if (body === '' || body.startsWith(' ') || body.endsWith(' ') || BLOCK.test(body)) return undefined
    const content = inline(body, definitions, settings)
    if (content === undefined) return undefined
    at++
    let nestedAt = at
    while (lines[nestedAt] === '') nestedAt++
    let nested: Result | undefined
    if (lines[nestedAt]?.startsWith(`${' '.repeat(column + 2)}- `)) {
      if (nestedAt - at > 1) return undefined
      nested = list(lines, nestedAt, column + 2, depth + 2, definitions, settings)
      if (nested === undefined) return undefined
      at = nested.next
    }
    if (nested === undefined) parts.push(`${indent(depth + 1)}<li>${content}</li>`)
    else parts.push(`${indent(depth + 1)}<li>${content}\n${nested.html}\n${indent(depth + 1)}</li>`)
    count++
    if (lines[at] === '') {
      let next = at + 1
      while (lines[next] === '') next++
      if (lines[next]?.startsWith(`${' '.repeat(column)}- `)) return undefined
      break
    }
    if (lines[at]?.startsWith(`${' '.repeat(column + 2)}- `)) return undefined
  }
  if (count === 0) return undefined
  parts.push(`${indent(depth)}</ul>`)
  return { html: parts.join('\n'), next: at }
}

function definitionsOf(lines: readonly string[]): Map<string, Definition> | undefined {
  const definitions = new Map<string, Definition>()
  let fence = false
  for (let at = 0; at < lines.length; at++) {
    const line = lines[at]!
    if (line.startsWith('```')) { fence = !fence; continue }
    if (fence || !line.includes(']:')) continue
    const match = /^\[([A-Za-z0-9 -]+)\]: (https?:\/\/[A-Za-z0-9./_-]+)$/.exec(line)
    if (match === null || (at > 0 && lines[at - 1] !== '' && !/^\[[^\]]+\]: /.test(lines[at - 1]!)) ||
      (at + 1 < lines.length && lines[at + 1] !== '' && !/^\[[^\]]+\]: /.test(lines[at + 1]!))) return undefined
    const key = foldLabel(match[1]!)
    if (!definitions.has(key)) definitions.set(key, { href: match[2]! })
  }
  return definitions
}

/** This path is used only with the default options; all uncertain forms return undefined. */
export function fastCoreHtml(source: string, settings: Settings): string | undefined {
  if (source === '' || source.startsWith('---') || /[^\x09\x0a\x20-\x7e]/.test(source) || source.includes('\t') ||
    source.includes('%%') || source.includes('::') || source.includes('![') ||
    source.includes('[^') || source.includes('^[') || source.includes('</#') ||
    /(?:^|\n)\+/.test(source) || source.includes('\\') || source.includes('  \n')) return undefined
  const lines = source.split('\n')
  if (lines.at(-1) === '') lines.pop()
  const definitions = definitionsOf(lines)
  if (definitions === undefined) return undefined
  const sections: number[] = []
  const ids = new Map<string, number>()
  const parts: string[] = []
  let at = 0
  let previousEnd = -1
  while (at < lines.length) {
    const current = lines[at]!
    if (current === '' || /^\[[^\]]+\]: /.test(current)) { at++; continue }
    if (previousEnd === at) return undefined
    const heading = /^(#{1,6}) ([^#].*)$/.exec(current)
    if (heading !== null) {
      const title = heading[2]!
      if (title.endsWith(' ') || !plain(title) || /[*\[\]/`]/.test(title)) return undefined
      const level = heading[1]!.length
      while (sections.at(-1) !== undefined && sections.at(-1)! >= level) {
        parts.push(`${indent(sections.length - 1)}</section>`)
        sections.pop()
      }
      const base = slugify(title, settings.headingIds)
      let id = base
      let suffix = ids.get(base) ?? 2
      while (ids.has(id)) id = `${base}-${suffix++}`
      ids.set(base, suffix)
      ids.set(id, 2)
      parts.push(`${indent(sections.length)}<section id="${escapeAttribute(id)}">`)
      parts.push(`${indent(sections.length + 1)}<h${level}>${escapeText(title)}</h${level}>`)
      sections.push(level)
      at++
    } else if (/^```[A-Za-z0-9-]*$/.test(current)) {
      const language = current.slice(3)
      let close = at + 1
      while (close < lines.length && lines[close] !== '```') {
        if (lines[close]!.startsWith('```')) return undefined
        close++
      }
      if (close === lines.length) return undefined
      const body = lines.slice(at + 1, close).map((line) => `${escapeText(line)}\n`).join('')
      parts.push(`${indent(sections.length)}<pre><code${language === '' ? '' : ` class="language-${language}"`}>${body}</code></pre>`)
      at = close + 1
    } else if (current.startsWith('- ')) {
      const rendered = list(lines, at, 0, sections.length, definitions, settings)
      if (rendered === undefined) return undefined
      parts.push(rendered.html)
      at = rendered.next
    } else if (current.startsWith('> ')) {
      const quote: string[] = []
      while (lines[at]?.startsWith('> ')) {
        const body = lines[at]!.slice(2)
        if (BLOCK.test(body)) return undefined
        const html = inline(body, definitions, settings)
        if (html === undefined) return undefined
        quote.push(html)
        at++
      }
      parts.push(`${indent(sections.length)}<blockquote><p>${quote.join('\n')}</p></blockquote>`)
    } else {
      const paragraph: string[] = []
      while (lines[at] !== undefined && lines[at] !== '') {
        const body = lines[at]!
        if (body !== '---' && (BLOCK.test(body) || body.startsWith(': '))) return undefined
        if (body.endsWith(' ')) return undefined
        const html = body === '---' ? '—' : inline(body, definitions, settings)
        if (html === undefined) return undefined
        paragraph.push(html)
        at++
      }
      parts.push(`${indent(sections.length)}<p>${paragraph.join('\n')}</p>`)
    }
    previousEnd = at
  }
  while (sections.length > 0) {
    parts.push(`${indent(sections.length - 1)}</section>`)
    sections.pop()
  }
  return parts.join('\n')
}
