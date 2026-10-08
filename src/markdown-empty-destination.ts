import { trimMatchingEdges } from './trim-non-nbsp.js'
import { readMarkdownReferenceDefinition } from './markdown-reference-definition.js'
/*
 * CommonMark links an empty destination; Carve reads `[t]()` as literal text
 * (markup-carve/carve#2069). The Markdown importer writes such a link as its
 * text and such an image as its alt text, matching markup-carve/carve-php#2067.
 */

import { markdownEmphasis } from './markdown-emphasis.js'
import { htmlToCarve } from './html-import.js'

/** Labels whose first reference definition has an empty destination, to its decoded title. */
export interface EmptyDestinationReferences {
  empty: Map<string, string>
  defined: Set<string>
  labels: Map<string, string>
  inline: Map<string, string>
  tableInline: Map<string, string>
  sourceLabels: Map<string, string>
  footnotes: Map<string, string>
}

function trimReferenceWhitespace(value: string): string {
  let start = 0
  let end = value.length
  while (start < end && (value[start] === ' ' || value[start] === '\t')) start++
  while (end > start && (value[end - 1] === ' ' || value[end - 1] === '\t')) end--
  return value.slice(start, end)
}

function rewriteParenthesizedTitle(value: string): string {
  const title = /[ \t]+\(((?:[^()\\]|\\.)*)\)\s*$/y
  for (let i = 0; i < value.length; i++) {
    if (value[i] !== ' ' && value[i] !== '\t') continue
    const start = i
    while (value[i + 1] === ' ' || value[i + 1] === '\t') i++
    if (value[i + 1] !== '(') continue
    title.lastIndex = start
    const match = title.exec(value)
    if (match) return `${value.slice(0, start)} "${match[1]!.replace(/"/g, '\\"')}"`
  }
  return value
}

const NO_REFERENCES: EmptyDestinationReferences = { empty: new Map(), defined: new Set(), labels: new Map(), inline: new Map(), tableInline: new Map(), sourceLabels: new Map(), footnotes: new Map() }

let references = NO_REFERENCES

/** Makes the references a document defines visible to the inline pass. */
export function useEmptyDestinationReferences(found: EmptyDestinationReferences | null): void {
  references = found ?? NO_REFERENCES
}

/** The first usable definition's source label, if this is a link reference. */
export function referenceDestinationLabel(
  label: string,
  decodeEntity: (entity: string) => string,
  placeholders: readonly string[] = [],
  table = false,
): string | undefined {
  if (label.startsWith('^')) return undefined
  const authored = references.sourceLabels.get(normalizeReferenceLabel(referenceSourceText(label, placeholders)))
  if (authored !== undefined && (references.inline.has(authored) || table && references.tableInline.has(authored))) return authored
  const key = normalizeReferenceLabel(decodeLinkTitle(label, decodeEntity, placeholders))
  const found = references.empty.has(key) ? undefined : references.labels.get(key)
  return table && found !== undefined && references.tableInline.has(found) && authored === undefined ? undefined : found
}

export function referenceInlineTarget(label: string, table = false): string | undefined {
  return references.inline.get(label) ?? (table ? references.tableInline.get(label) : undefined)
}

export function importedFootnoteLabel(label: string): string | undefined {
  return references.footnotes.get(label)
}

export function referenceSourceText(label: string, placeholders: readonly string[]): string {
  for (let pass = 0; pass < placeholders.length; pass++) {
    const restored = label.replace(/\x00P(\d+)\x00/g, (token, index: string) => placeholders[Number(index)] ?? token)
    if (restored === label) break
    label = restored
  }
  return label
}

export function referenceSourceLabel(label: string, placeholders: readonly string[]): string | undefined {
  return references.sourceLabels.get(normalizeReferenceLabel(referenceSourceText(label, placeholders)))
}

export function referenceLiteralText(label: string, decodeEntity: (entity: string) => string, placeholders: readonly string[]): string {
  return decodeLinkTitle(label, decodeEntity, placeholders)
}

const RE_ENTITY = /&(?:#[xX][0-9A-Fa-f]{1,6}|#[0-9]{1,7}|[A-Za-z][A-Za-z0-9]{1,31});/g

/** A label: text and brackets nested up to three deep. */
const BRACKET_0 = String.raw`[^[\]\n]`
const BRACKET_1 = String.raw`\[${BRACKET_0}*\]`
const BRACKET_2 = String.raw`\[(?:${BRACKET_0}|${BRACKET_1})*\]`
const BRACKET_3 = String.raw`\[(?:${BRACKET_0}|${BRACKET_2})*\]`
const LABEL = String.raw`((?:${BRACKET_0}|${BRACKET_3})*)`

const TITLE = String.raw`("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|\((?:[^()\\\n]|\\.)*\))`

function normalizeReferenceLabel(label: string): string {
  return label.trim().replace(/\s+/gu, ' ').toLowerCase().toUpperCase().toLowerCase()
}

/** A title's text: backslash escapes and character references decoded, placeholders read back. */
function decodeLinkTitle(title: string, decodeEntity: (entity: string) => string, placeholders: readonly string[] = []): string {
  return title.replace(
    new RegExp(String.raw`\x00P(\d+)\x00|\\([!-\/:-@\[-\x60{-~])|${RE_ENTITY.source}`, 'g'),
    (match, index: string | undefined, escaped: string | undefined) => {
      if (index !== undefined) return decodeLinkTitle(placeholders[Number(index)] ?? '', decodeEntity, placeholders)
      if (escaped !== undefined) return escaped
      return decodeEntity(match)
    },
  )
}

function htmlBlockCloser(rest: string): RegExp | null {
  const tag = /^<(script|pre|style|textarea)(?:[ \t>]|$)/i.exec(rest)
  if (tag) return new RegExp(`</${tag[1]!.toLowerCase()}>`, 'i')
  if (rest.startsWith('<!--')) return /-->/
  if (rest.startsWith('<?')) return /\?>/
  if (rest.startsWith('<![CDATA[')) return /\]\]>/
  if (/^<![A-Za-z]/.test(rest)) return />/
  return null
}

function hasNestedReferenceHead(source: string): boolean {
  const opener = /^ {0,3}\[/.exec(source)
  if (!opener) return false
  let nested = false
  for (let at = opener[0].length; at < source.length; at++) {
    const ch = source[at]!
    if (ch === '\\') {
      const next = source[++at]
      if (next === undefined || /[\r\n\u2028\u2029]/.test(next)) return false
    } else if (ch === '\n') return false
    else if (ch === '[') nested = true
    else if (ch === ']') return nested && source[at + 1] === ':'
  }
  return false
}

/**
 * Remove reference definitions from the body. Empty destinations are recorded
 * for inline fallback; other definitions are returned for the document end.
 */
export function extractReferenceDefinitions(
  inputLines: readonly string[],
  decodeEntity: (entity: string) => string,
  interruptsParagraph: (line: string) => boolean,
  opensOpaqueHtml: (line: string, atBlockStart: boolean) => boolean = () => false,
): { lines: string[]; references: EmptyDestinationReferences; definitions: string[] } {
  const lines = [...inputLines]
  const empty = new Map<string, string>()
  const defined = new Set<string>()
  const authoredDefinitions = new Set<string>()
  const labels = new Map<string, string>()
  const definitions: string[] = []
  const inline = new Map<string, string>()
  const tableInline = new Map<string, string>()
  let nextSerial = 1
  const sourceLabels = new Map<string, string>()
  const footnotes = new Map<string, string>()
  const reservedFootnotes = new Set<number>()
  let nextFootnote = 1
  const reservedReferences = new Set<number>()
  for (const line of lines) {
    for (const match of line.matchAll(/\[carve-import-reference-(\d+)\]/gi)) reservedReferences.add(Number(match[1]))
    for (const match of line.matchAll(/\[\^((?:[^[\]\\\n]|\\.)+)\]/g)) {
      const reserved = /^carve-import-footnote-(\d+)$/i.exec(decodeLinkTitle(match[1]!, decodeEntity))
      if (reserved) reservedFootnotes.add(Number(reserved[1]))
    }
  }
  const kept: string[] = []
  let precedingNonblank: string | undefined
  const keep = (...entries: string[]): void => {
    for (const entry of entries) if (entry.trim() !== '') precedingNonblank = entry
    kept.push(...entries)
  }
  let referenceChunk: { lines: readonly string[]; start: number; through: number; text: string; offsets: number[] } | undefined
  const referenceSource = (index: number): string => {
    if (!referenceChunk || referenceChunk.lines !== lines || index > referenceChunk.through) {
      const chunks: string[] = []
      const offsets: number[] = []
      let size = 0, through = index
      for (; through < lines.length && lines[through]!.trim() !== '' && (through === index || !interruptsParagraph(lines[through]!)); through++) {
        offsets.push(size)
        chunks.push(lines[through]!)
        size += lines[through]!.length + 1
      }
      referenceChunk = { lines, start: index, through: through - 1, text: chunks.join('\n'), offsets }
    }
    return referenceChunk.text.slice(referenceChunk.offsets[index - referenceChunk.start])
  }
  let deferredBlanks: { start: number; end: number; values: string[] } | undefined
  const flushBlanks = (): void => {
    if (!deferredBlanks) return
    for (let at = deferredBlanks.start; at < deferredBlanks.end; at++) {
      lines[at] = deferredBlanks.values[at - deferredBlanks.start]!
    }
    deferredBlanks = undefined
    referenceChunk = undefined
  }
  const nextNonblankFrom = (start: number): number => {
    let at = start
    if (deferredBlanks && at >= deferredBlanks.start && at < deferredBlanks.end) at = deferredBlanks.end
    while (at < lines.length && lines[at]!.trim() === '') at++
    return at
  }
  let fence: string | null = null
  let htmlCloser: RegExp | null = null
  let blockDepth = 0
  let blockList = 0
  let canStart = true
  let depth = 0
  let listIndent = 0
  const leadingSpaces = (s: string) => /^ */.exec(s)![0].length
  const lineTitle = new RegExp(String.raw`^[ \t]*(?:<[^<>\n]*>|[^<\x00-\x20\x7f][^\x00-\x20\x7f]*)(?:[ \t]+${TITLE})?[ \t]*$`)
  const opensBlock = (text: string): boolean =>
    /^ {0,3}(?:>|#{1,6}(?:[ \t]|$)|`{3,}|~{3,}|(?:[-*+]|[0-9]{1,9}[.)])(?:[ \t]|$))/.test(text) ||
    /^[ \t]*(?:=+|[-*_]{3,})[ \t]*$/.test(text)
  for (let i = 0; i < lines.length; i++) {
    if (deferredBlanks && i >= deferredBlanks.start) flushBlanks()
    const line = lines[i]!
    let prefix = /^((?: {0,3}>[ \t]?)*)/.exec(line)![1]!
    let content = line.slice(prefix.length)
    const quotePrefix = prefix
    const lineDepth = (prefix.match(/>/g) ?? []).length
    let opensItem = false
    // Leaving the container ends a fence or HTML block opened in it.
    if (
      (fence !== null || htmlCloser !== null) &&
      (lineDepth < blockDepth || (blockList > 0 && quotePrefix === '' && line.trim() !== '' && leadingSpaces(line) < blockList))
    ) {
      fence = null
      htmlCloser = null
      canStart = true
    }
    if (htmlCloser !== null) {
      if (htmlCloser.test(line)) {
        htmlCloser = null
        canStart = true
      }
      keep(line)
      continue
    }
    const marker = /^ {0,3}(?:[-*+]|[0-9]{1,9}[.)])[ \t]+(?=\S)/.exec(content)
    if (fence === null && !/^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/.test(content) && marker) {
      prefix += marker[0]
      content = content.slice(marker[0].length)
      listIndent = prefix.length
      opensItem = true
    } else if (listIndent > 0 && content.trim() !== '') {
      if (leadingSpaces(line) >= listIndent) content = line.slice(listIndent)
      else listIndent = 0
    }
    if (fence !== null) {
      const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(content)
      if (close && close[1]![0] === fence[0] && close[1]!.length >= fence.length) {
        fence = null
        canStart = true
      }
      keep(line)
      depth = lineDepth
      continue
    }
    const open = /^ {0,3}(`{3,}|~{3,})/.exec(content)
    if (open) {
      fence = open[1]!
      blockDepth = lineDepth
      blockList = listIndent
      keep(line)
      depth = lineDepth
      continue
    }
    const closer = htmlBlockCloser(content.replace(/^ +/, ''))
    if (closer !== null && leadingSpaces(content) <= 3) {
      if (!closer.test(content.replace(/^ +/, '').slice(2))) {
        htmlCloser = closer
        blockDepth = lineDepth
        blockList = listIndent
      }
      keep(line)
      depth = lineDepth
      canStart = true
      continue
    }
    if (leadingSpaces(content) <= 3 && opensOpaqueHtml(content, canStart)) {
      htmlCloser = /^[ \t]*$/
      blockDepth = lineDepth
      blockList = listIndent
      keep(line)
      depth = lineDepth
      continue
    }
    if (canStart && !opensItem && lineDepth === 0 && listIndent === 0 && /^ {0,3}\[(?!\^)/.test(content)) {
      const single = /^ {0,3}\[((?:[^[\]\\]|\\.)+)\]:(.*)$/.exec(content)
      const ordinary = single && !/\\\]/.test(single[1]!) && (single[2]!.trim() === '' || lineTitle.test(single[2]!))
      const parsed = ordinary ? undefined : readMarkdownReferenceDefinition(referenceSource(i))
      if (parsed?.complex && !parsed.target.startsWith('<>')) {
        const key = normalizeReferenceLabel(parsed.label)
        if (!authoredDefinitions.has(key)) {
          while (reservedReferences.has(nextSerial)) nextSerial++
          const canonical = `carve-import-reference-${nextSerial++}`
          inline.set(canonical, parsed.target)
          sourceLabels.set(normalizeReferenceLabel(parsed.label), canonical)
          defined.add(key)
          authoredDefinitions.add(key)
        }
        i += parsed.lines - 1
        depth = 0
        canStart = true
        continue
      }
      if (parsed === null && (/^ {0,3}\[(?:[^[\]\\\n]|\\.)+\]:[ \t]*</.test(content) || hasNestedReferenceHead(content))) {
        keep(line.replace(/^( *)\[/, '$1\\['))
        canStart = false
        continue
      }
    }
    // A deeper quote opens a block; a shallower line is lazy continuation.
    const definition = /^ {0,3}\[((?:[^[\]\\]|\\.)+)\]:(.*)$/.exec(content)
    if (definition?.[1]?.startsWith('^')) {
      const label = definition[1].slice(1)
      const key = label
      if (label.includes('|') && !footnotes.has(key)) {
        while (reservedFootnotes.has(nextFootnote)) nextFootnote++
        footnotes.set(key, `carve-import-footnote-${nextFootnote++}`)
      }
      const next = lines[nextNonblankFrom(i + 1)]
      const empty = definition[2]!.trim() === '' && (next === undefined || !/^ {4}/.test(next.slice(quotePrefix.length)))
      keep(line + (empty ? ' \x00FNEMPTY\x00' : ''))
      depth = lineDepth
      canStart = false
      continue
    }
    if (
      (canStart || opensItem || lineDepth > depth) &&
      definition &&
      new RegExp(String.raw`^[ \t]*(?:(?:<[^<>\n]*>|[^<\x00-\x20\x7f][^\x00-\x20\x7f]*)(?:[ \t]+${TITLE})?[ \t]*)?$`).test(definition[2]!)
    ) {
      depth = lineDepth
      const key = normalizeReferenceLabel(decodeLinkTitle(definition[1]!, decodeEntity))
      const continued: string[] = []
      let destination = definition[2]!
      const following = lines[i + 1]
      if (trimReferenceWhitespace(destination) === '' && following !== undefined && following.startsWith(quotePrefix) &&
          !opensBlock(following.slice(quotePrefix.length)) && lineTitle.test(following.slice(quotePrefix.length))) {
        continued.push(following)
        i++
        destination = following.slice(quotePrefix.length)
      }
      const emptied = new RegExp(String.raw`^[ \t]*<>(?:[ \t]+${TITLE})?[ \t]*$`).exec(destination)
      if (!emptied) {
        const target = trimReferenceWhitespace(destination)
        if (target === '') {
          keep(line, ...continued)
          canStart = false
          continue
        }
        const authoredKey = normalizeReferenceLabel(definition[1]!)
        const authoredRepeated = authoredDefinitions.has(authoredKey)
        const repeated = defined.has(key) || authoredRepeated
        authoredDefinitions.add(authoredKey)
        defined.add(key)
        if (definition[1]!.startsWith('^')) {
          keep(line, ...continued)
          canStart = true
          continue
        }
        if (!repeated) {
          labels.set(key, definition[1]!)
          sourceLabels.set(normalizeReferenceLabel(definition[1]!), definition[1]!)
        }
        const preceding = precedingNonblank
        const nextNonblank = lines[nextNonblankFrom(i + 1)]
        const isItem = (entry: string | undefined) => entry !== undefined &&
          /^ {0,3}(?:[-*+]|[0-9]{1,9}[.)])(?:[ \t]|$)/.test(entry.slice(quotePrefix.length))
        if (!opensItem && kept.at(-1)?.trim() === '' && isItem(preceding) && isItem(nextNonblank)) {
          keep(line, ...continued)
          canStart = true
          continue
        }
        const next = lines[i + 1]
        const nextTitle = next !== undefined && next.startsWith(quotePrefix)
          ? new RegExp(String.raw`^[ \t]*${TITLE}[ \t]*$`).exec(next.slice(quotePrefix.length)) : null
        const title = !new RegExp(String.raw`[ \t]${TITLE}[ \t]*$`).test(target) && nextTitle
          ? ` ${nextTitle[1]}` : ''
        if (title) i++
        if (!repeated && definition[1]!.includes('|')) tableInline.set(definition[1]!, `${target}${title}`)
        const writtenTarget = rewriteParenthesizedTitle(`${target}${title}`.replace(/^<([^<>]+)>/, (_match, url: string) =>
          url.replace(/[ \t]/g, (space) => encodeURIComponent(space)),
        ))
        if (!authoredRepeated || empty.has(key)) definitions.push(`[${definition[1]}]: ${writtenTarget}`)
        if (opensItem) {
          const nextLine = lines[i + 1]
          if (nextLine !== undefined && nextLine.trim() !== '' && leadingSpaces(nextLine) < prefix.length + 4 &&
              !opensBlock(nextLine) && !/^ {0,3}\[[^\]\n]+\]:/.test(nextLine.trimStart())) {
            lines[i + 1] = prefix + nextLine.trimStart()
          } else {
            let continuation = i + 2
            if (nextLine?.trim() === '') {
              continuation = nextNonblankFrom(continuation)
            }
            if (nextLine?.trim() === '' && continuation < lines.length &&
                leadingSpaces(lines[continuation]!) >= prefix.length && leadingSpaces(lines[continuation]!) < prefix.length + 4 &&
                !opensBlock(lines[continuation]!.trimStart())) {
              const moved = prefix + lines[continuation]!.trimStart()
              // Keep a blank run in place while chained definitions move ahead of it.
              const values = deferredBlanks?.values ?? lines.slice(i + 1, continuation)
              if (deferredBlanks) {
                for (let at = deferredBlanks.end; at < continuation; at++) values.push(lines[at]!)
              }
              deferredBlanks = { start: i + 2, end: continuation + 1, values }
              lines[i + 1] = moved
              lines[continuation] = ''
              referenceChunk = undefined
            } else keep(prefix.trimEnd() + ' \x00REFITEM\x00')
          }
        } else if (quotePrefix !== '') {
          const nextLine = lines[i + 1]
          if (nextLine !== undefined && nextLine.trim() !== '' && !opensBlock(nextLine) &&
              !/^ {0,3}\[[^\]\n]+\]:/.test(nextLine.trimStart())) {
            keep(quotePrefix + nextLine.trimStart())
            i++
          } else keep(quotePrefix)
        } else if ((kept.length === 0 || kept.at(-1)!.trim() === '') && lines[i + 1]?.trim() === '') {
          i++
        } else if (lines[i + 1]?.startsWith('    ') && lines[i + 1]!.trim() !== '') {
          lines[i + 1] = lines[i + 1]!.replace(/^ {4}/, '')
          if (referenceChunk && i + 1 >= referenceChunk.start && i + 1 <= referenceChunk.through) {
            referenceChunk.offsets[i + 1 - referenceChunk.start]! += 4
          }
        }
        canStart = true
        continue
      }
      let raw = emptied[1] ?? ''
      const next = lines[i + 1]
      const nextTitle = next !== undefined && next.startsWith(quotePrefix) ? new RegExp(String.raw`^[ \t]*${TITLE}[ \t]*$`).exec(next.slice(quotePrefix.length)) : null
      if (raw === '' && nextTitle) {
        raw = nextTitle[1]!
        i++
      }
      const authoredKey = normalizeReferenceLabel(definition[1]!)
      if (!defined.has(key) && !authoredDefinitions.has(authoredKey)) empty.set(key, raw === '' ? '' : decodeLinkTitle(raw.slice(1, -1), decodeEntity))
      defined.add(key)
      authoredDefinitions.add(authoredKey)
      canStart = true
      // Keep the item as an empty comment line; the output pass restores the
      // marker after inline conversion.
      if (opensItem) keep(prefix.trimEnd() + ' \x00REFITEM\x00')
      else if (quotePrefix !== '') keep(quotePrefix)
      else if ((kept.length === 0 || kept.at(-1)!.trim() === '') && i + 1 < lines.length && lines[i + 1]!.trim() === '') i++
      continue
    }
    keep(line)
    depth = lineDepth
    canStart = content.trim() === '' || /^ {0,3}(?:#{1,6}(?:[ \t]|$)|([-*_])(?:[ \t]*\1){2,}[ \t]*$|=+[ \t]*$)/.test(content)
  }
  return { lines: kept, references: { empty, defined, labels, inline, tableInline, sourceLabels, footnotes }, definitions }
}

/** A line-initial block opener in text, escaped so the text stays a paragraph. */
export function escapeLineInitialBlockSyntax(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      const m = /^([ \t]*)(\S.*)$/.exec(line)
      if (!m) return line
      const [, indent, rest] = m as unknown as [string, string, string]
      if (/^([-*_])(?:[ \t]*\1){2,}[ \t]*$/.test(rest)) return indent + rest.replace(/([-*_])/g, '\\$1')
      const fence = /^(`{3,}|~{3,}|:{3,})/.exec(rest)
      if (fence) return indent + fence[1]!.replace(/./g, '\\$&') + rest.slice(fence[1]!.length)
      const ordered = /^([0-9]{1,9}|[A-Za-z])([.)])([ \t]|$)/.exec(rest)
      if (ordered) return indent + ordered[1]! + '\\' + rest.slice(ordered[1]!.length)
      if (/^(?:[-*](?:[ \t]|$)|#{1,6}[ \t]|>|\||::|%%)/.test(rest)) return indent + '\\' + rest
      return line
    })
    .join('\n')
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

function quoteAttributeValue(value: string): string {
  if (/^[^\s"'{}]+$/u.test(value)) return value
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/** CommonMark's alt text: the description's content with its markup removed. */
export function plainAltText(label: string, placeholders: readonly string[], decodeEntity: (entity: string) => string): string {
  let previous: string
  const nestedLink = new RegExp(String.raw`!?\[${LABEL}\]\([^()\n]*\)`, 'g')
  const referenceLink = new RegExp(String.raw`!?\[${LABEL}\]`, 'g')
  const referenceTail = /\[([^[\]\n]*)\]/y
  const defined = (label: string): boolean => references.defined.has(normalizeReferenceLabel(decodeLinkTitle(label, decodeEntity, placeholders)))
  do {
    previous = label
    label = label.replace(/\x00P(\d+)\x00/g, (token, index: string) => {
      const span = placeholders[Number(index)] ?? token
      return span.startsWith('(') || span.startsWith('![') || span.startsWith('[') ? span : token
    })
    label = label.replace(nestedLink, '$1')
    let written = '', cursor = 0
    referenceLink.lastIndex = 0
    for (let match; (match = referenceLink.exec(label)) !== null;) {
      const end = referenceLink.lastIndex
      written += label.slice(cursor, match.index)
      referenceTail.lastIndex = end
      const tail = referenceTail.exec(label)
      if (tail && defined(tail[1] || match[1]!)) {
        written += match[1]!
        referenceLink.lastIndex = referenceTail.lastIndex
      } else {
        written += !tail && label[end] !== '(' && label[end] !== ':' && defined(match[1]!) ? match[1]! : match[0]
      }
      cursor = referenceLink.lastIndex
    }
    label = written + label.slice(cursor)
  } while (label !== previous)
  return markdownEmphasis(label, undefined, undefined, placeholders, true).replace(RE_ENTITY, decodeEntity).replace(/\x00P(\d+)\x00/g, (_m, index: string) => {
    const span = placeholders[Number(index)] ?? ''
    const code = /^(`+)([\s\S]*)\1$/.exec(span)
    if (code) {
      const padded = /^ ([\s\S]*\S[\s\S]*) $/.exec(code[2]!)
      return padded ? padded[1]! : code[2]!
    }
    return decodeLinkTitle(span, decodeEntity, placeholders)
  })
}

/**
 * The Carve a link or image with no destination leaves behind: a link's text,
 * or an image's plain alt text written as the HTML importer writes
 * `<img src="">`, in a span when a title survives.
 */
function unwrapEmptyDestination(
  label: string,
  image: boolean,
  title: string,
  before: string,
  placeholders: readonly string[],
  protect: (s: string) => string,
  decodeEntity: (entity: string) => string,
): string {
  // Bare at the start of a line or container, the text would open a block.
  const lineStart = /^[ \t]*(?:(?:>|[-*+]|(?:[0-9]{1,9}|[A-Za-z])[.)])[ \t]+|>)*$/.test(before)
  if (image) {
    const titleAttr = title === '' ? '' : ` title="${escapeHtml(title)}"`
    const html = `<p><img src="" alt="${escapeHtml(plainAltText(label, placeholders, decodeEntity))}"${titleAttr}></p>`
    const text = trimMatchingEdges(htmlToCarve(html).value, (code) => code === 10)
    return protect(lineStart ? escapeLineInitialBlockSyntax(text) : text)
  }
  if (title === '') return lineStart ? escapeLineInitialBlockSyntax(label) : label
  return `[${label}]${protect(`{title=${quoteAttributeValue(title)}}`)}`
}

/** Rewrites every link and image with an empty destination on one line of inline text. */
export function unwrapEmptyDestinations(
  line: string,
  placeholders: readonly string[],
  protect: (s: string) => string,
  decodeEntity: (entity: string) => string,
): string {
  const replaceAt = (re: RegExp, pick: (m: RegExpExecArray) => string | null): void => {
    const subject = line
    let out = ''
    let cursor = 0
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(subject)) !== null) {
      const replacement = pick(m)
      if (replacement === null) continue
      out += subject.slice(cursor, m.index) + replacement
      cursor = m.index + m[0].length
    }
    line = out + subject.slice(cursor)
  }
  const unwrap = (m: RegExpExecArray, title: string, subject: string) =>
    unwrapEmptyDestination(m[1]!, m[0][0] === '!', title, subject.slice(0, m.index), placeholders, protect, decodeEntity)
  if (references.empty.size > 0) {
    const byReference = (m: RegExpExecArray, reference: string, subject: string): string | null => {
      const key = normalizeReferenceLabel(decodeLinkTitle(reference, decodeEntity, placeholders))
      const title = references.empty.get(key)
      return title === undefined ? null : unwrap(m, title, subject)
    }
    let subject = line
    replaceAt(new RegExp(String.raw`!?\[${LABEL}\](?:\[\]|\[([^[\]\n]+)\])`, 'g'), (m) => byReference(m, m[2] ?? m[1]!, subject))
    subject = line
    replaceAt(/!?\[([^[\]\n]+)\](?![[(:])/g, (m) => byReference(m, m[1]!, subject))
  }
  const subject = line
  replaceAt(
    new RegExp(String.raw`!?\[${LABEL}\]\([ \t]*(?:<>(?:[ \t]+("[^"\n]*"|'[^'\n]*'|\([^()\n]*\)))?[ \t]*)?\)`, 'g'),
    (m) => unwrap(m, m[2] !== undefined ? decodeLinkTitle(m[2].slice(1, -1), decodeEntity, placeholders) : '', subject),
  )
  return line
}
