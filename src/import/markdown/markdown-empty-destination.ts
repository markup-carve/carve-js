import { freeMarkerSerial } from '../../parse/list/marker-serial.js'
import { markdownInlineDestinationEnd } from './markdown-link-scopes.js'
import { rawBracketRunCloses } from '../../parse.js'
import { trimMatchingEdges } from '../../trim-non-nbsp.js'
import { readMarkdownReferenceDefinition } from './markdown-reference-definition.js'
/* Convert CommonMark empty destinations to native Carve links and images. */

import { markdownEmphasis } from './markdown-emphasis.js'
import { htmlToCarve } from '../../html-import.js'

/** Labels whose first reference definition has an empty destination, to its decoded title. */
export interface EmptyDestinationReferences {
  empty: Map<string, string>
  titled: Set<string>
  defined: Set<string>
  labels: Map<string, string>
  inline: Map<string, string>
  tableInline: Map<string, string>
  sourceLabels: Map<string, string>
  footnotes: Map<string, string>
  /** Stands for a line break inside a title written at a use, so the break can take the use's quote prefix. */
  titleWrap?: string
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

const NO_REFERENCES: EmptyDestinationReferences = { empty: new Map(), titled: new Set(), defined: new Set(), labels: new Map(), inline: new Map(), tableInline: new Map(), sourceLabels: new Map(), footnotes: new Map() }

let references = NO_REFERENCES
let boundaryKey: string | undefined

export function useEmptyDestinationBoundaryKey(key?: string): void {
  boundaryKey = key
}

function keepEmptyDestinationBoundary(text: string, lineStart: boolean, protect: (s: string) => string, enabled = true, literal = false): string {
  if (!enabled || boundaryKey === undefined || text === '' && lineStart) return literal ? protect(text) : text
  if (literal && !rawBracketRunCloses(text)) {
    text = text.replace(/(\\*)[\[\]]/g, (match, slashes: string) => slashes.length % 2 === 0 ? slashes + '\\' + match.at(-1)! : match)
  }
  if (text.startsWith('^')) text = protect('\\^') + text.slice(1)
  const separator = lineStart ? '' : protect('`<!--' + boundaryKey + '-->`{=html}')
  return `${separator}${protect('[')}${text === '' ? '0' : literal ? protect(text) : text}${protect(']')}${protect(`{${boundaryKey}=${text === '' ? 'empty' : 'label'}}`)}`
}

/** Makes the references a document defines visible to the inline pass. */
export function useEmptyDestinationReferences(found: EmptyDestinationReferences | null): void {
  references = found ?? NO_REFERENCES
}

/** The first usable definition's source label, if this is a link reference. */
export function referenceDestinationLabel(
  label: string,
  _decodeEntity: (entity: string) => string,
  placeholders: readonly string[] = [],
  table = false,
): string | undefined {
  if (label.startsWith('^')) return undefined
  const authored = references.sourceLabels.get(normalizeReferenceLabel(referenceSourceText(label, placeholders)))
  if (authored !== undefined && (references.inline.has(authored) || table && references.tableInline.has(authored))) return authored
  const key = normalizeReferenceLabel(referenceSourceText(label, placeholders))
  const found = references.labels.get(key)
  return table && found !== undefined && references.tableInline.has(found) && authored === undefined ? undefined : found
}

export function isEmptyDestinationReference(label: string, _decodeEntity: (entity: string) => string, placeholders: readonly string[]): boolean {
  return references.empty.has(normalizeReferenceLabel(referenceSourceText(label, placeholders)))
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

const ANGLE_DESTINATION = String.raw`<(?:[^<>\n\\]|\\[^\n])*>`
const DESTINATION = String.raw`(?:${ANGLE_DESTINATION}|[^<\x00-\x20\x7f][^\x00-\x20\x7f]*)`
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

/** The mutable state of one reference definition pass, shared by its branches. */
interface ReferenceExtraction {
  readonly lines: string[]
  readonly kept: string[]
  // The source index each kept line came from, so a diagnostic can name the
  // line the author wrote rather than its offset in this stripped array.
  readonly keptSource: number[]
  readonly bareReferenceHeads: Array<{ index: number; key: string; marker: number; labelLength: number }>
  sourceIndex: number
  precedingNonblank: string | undefined
  referenceChunk: { lines: readonly string[]; start: number; through: number; text: string; offsets: number[] } | undefined
  deferredBlanks: { start: number; end: number; values: string[] } | undefined
  nextSerial: number
  readonly reservedReferences: ReadonlySet<number>
  readonly decodeEntity: (entity: string) => string
  readonly titleBreakMarker: string
  readonly titleWrap: string
  readonly empty: Map<string, string>
  readonly titled: Set<string>
  readonly defined: Set<string>
  readonly authoredDefinitions: Set<string>
  readonly labels: Map<string, string>
  readonly sourceLabels: Map<string, string>
  readonly inline: Map<string, string>
  readonly tableInline: Map<string, string>
  readonly definitions: string[]
  readonly definitionContainers: boolean[]
  readonly discardedEmptyDefinitions: Array<{ line: number; label: string }>
}

/** A definition line as the pass reads it, with the containers it stands in. */
interface DefinitionLine {
  line: string
  i: number
  label: string
  key: string
  continued: string[]
  quotePrefix: string
  prefix: string
  opensItem: boolean
  lineDepth: number
  blockList: number
  wrappedDestinationTitle: boolean
}

const leadingSpaces = (s: string): number => /^ */.exec(s)![0].length
const LINE_TITLE = new RegExp(String.raw`^[ \t]*(?:${ANGLE_DESTINATION}|[^<\x00-\x20\x7f][^\x00-\x20\x7f]*)(?:[ \t]+${TITLE})?[ \t]*$`)
const opensBlock = (text: string): boolean =>
  /^ {0,3}(?:>|#{1,6}(?:[ \t]|$)|`{3,}|~{3,}|(?:[-*+]|[0-9]{1,9}[.)])(?:[ \t]|$))/.test(text) ||
  /^[ \t]*(?:=+|[-*_]{3,})[ \t]*$/.test(text)

function keepLines(st: ReferenceExtraction, ...entries: string[]): void {
  for (const entry of entries) if (entry.trim() !== '') st.precedingNonblank = entry
  for (const _ of entries) st.keptSource.push(st.sourceIndex)
  st.kept.push(...entries)
}

function nextNonblankFrom(st: ReferenceExtraction, start: number): number {
  let at = start
  if (st.deferredBlanks && at >= st.deferredBlanks.start && at < st.deferredBlanks.end) at = st.deferredBlanks.end
  while (at < st.lines.length && st.lines[at]!.trim() === '') at++
  return at
}

/** The serials authored text already spells, which generated labels skip. */
function reservedImportSerials(lines: readonly string[], decodeEntity: (entity: string) => string): { references: Set<number>; footnotes: Set<number> } {
  const references = new Set<number>()
  const footnotes = new Set<number>()
  for (const line of lines) {
    for (const match of line.matchAll(/\[carve-import-reference-(\d+)\]/gi)) references.add(Number(match[1]))
    for (const match of line.matchAll(/\[\^((?:[^[\]\\\n]|\\.)+)\]/g)) {
      const reserved = /^carve-import-footnote-(\d+)$/i.exec(decodeLinkTitle(match[1]!, decodeEntity).trim())
      if (reserved) footnotes.add(Number(reserved[1]))
    }
  }
  return { references, footnotes }
}

/**
 * Take the list markers off a line inside `quotePrefix`, and the container
 * prefixes nested under them off the content the block readings see.
 */
function readContainerPrefixes(
  line: string,
  quotePrefix: string,
  fence: string | null,
  listIndent: number,
  blockIndent: number,
): { prefix: string; content: string; blockContent: string; opensItem: boolean; listIndent: number; blockIndent: number } {
  let prefix = quotePrefix
  let content = line.slice(prefix.length)
  let opensItem = false
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
  // CONTAINER PREFIXES NEST, and the BLOCK decisions below need the innermost
  // content. An item's indentation or marker came off the line without the
  // quote regex running again, so a block quote inside that item still has its
  // `>` run on the content and a fence or an HTML block opening there would be
  // read as the block's own text. Only the fence and HTML-block readings take
  // the nested run off; everything else keeps the content it has today, so a
  // definition inside such a quote is handled exactly as before
  // (markup-carve/carve#2850).
  // Every container prefix the line carries comes off, not just the first:
  // `- - ::: note` opens TWO items on one line, and a quote inside an item
  // carries both prefixes. One marker stripped is not enough.
  //
  // A LIST MARKER INSIDE AN OPEN FENCE IS VERBATIM CONTENT, so only the
  // quote prefix keeps coming off there - stripping a marker would let a
  // `- ```` line inside the fence read as its closer.
  let blockContent = fence !== null && leadingSpaces(line) >= blockIndent
    ? line.slice(blockIndent)
    : content
  while (listIndent > 0) {
    const nested = /^((?: {0,3}>[ \t]?)*)/.exec(blockContent)![1]!
    if (nested !== '') {
      blockContent = blockContent.slice(nested.length)
      continue
    }
    if (fence !== null) break
    const inner = /^ {0,3}(?:[-*+]|[0-9]{1,9}[.)])[ \t]+(?=\S)/.exec(blockContent)
    // `- - -` is a thematic break, not two nested items.
    if (inner === null || /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/.test(blockContent)) break
    blockContent = blockContent.slice(inner[0].length)
  }
  // The content column EVERY prefix on the line put the body at, which is
  // what a continuation line of this item is read against. `listIndent` only
  // counts the first marker, so a body six columns in under `- - - ` would
  // otherwise read as code.
  if (opensItem) blockIndent = line.length - blockContent.length
  else if (listIndent === 0) blockIndent = 0
  if (!opensItem && blockIndent > listIndent && leadingSpaces(line) >= blockIndent) {
    blockContent = line.slice(blockIndent)
    const nested = /^((?: {0,3}>[ \t]?)*)/.exec(blockContent)![1]!
    if (nested !== '') blockContent = blockContent.slice(nested.length)
  }
  return { prefix, content, blockContent, opensItem, listIndent, blockIndent }
}

/**
 * Join the continuation lines of a definition title, which CommonMark lets
 * wrap, into `definition[2]`, so the branch below sees one title. The breaks
 * are restored when the title is decoded or written. Null where it stays.
 */
function joinWrappedDefinitionTitle(
  st: ReferenceExtraction,
  definition: RegExpExecArray,
  i: number,
  destinationPattern: string,
  titleOnNext: boolean,
  continuationAt: (at: number) => string | undefined,
): { i: number; wrapped: boolean } | null {
  const empty = /^[ \t]*<>/.test(definition[2]!)
  const marker = empty ? st.titleBreakMarker : st.titleWrap
  let joined = titleOnNext ? `${definition[2]!.trimEnd()} ${continuationAt(i + 1)!.trimStart()}` : definition[2]!
  let end = titleOnNext ? i + 1 : i
  const opener = new RegExp(String.raw`^[ \t]*${destinationPattern}[ \t]+(["'(])((?:[^\\]|\\.)*)$`).exec(joined)
  const closer = opener ? (opener[1] === '(' ? /[()]/ : new RegExp(opener[1]!)) : null
  // Read on only while the title is open, so a run of definitions stays linear.
  if (closer !== null && !closer.test(opener![2]!.replace(/\\./g, ''))) {
    for (;;) {
      const body = continuationAt(end + 1)
      if (body === undefined) break
      joined += marker + body
      end++
      if (closer.test(body.replace(/\\./g, ''))) break
    }
  }
  if (end > i && new RegExp(String.raw`^[ \t]*${destinationPattern}[ \t]+${TITLE}[ \t]*$`).test(joined)) {
    definition[2] = joined
    return { i: end, wrapped: !empty && joined.includes(st.titleWrap) }
  }
  return null
}

/** Write a definition with a destination, or keep a bare reference head. */
function writeTargetDefinition(st: ReferenceExtraction, d: DefinitionLine, destination: string): { i: number; canStart: boolean } {
  const { line, label, key, continued, quotePrefix, prefix, opensItem, lineDepth, blockList, wrappedDestinationTitle } = d
  let i = d.i
  const target = trimReferenceWhitespace(destination)
  if (target === '') {
    const marker = line.indexOf(`[${label}]:`)
    const next = st.lines[i + 1]
    const setext = next?.startsWith(quotePrefix) && /^ {0,3}(?:=+|-+)[ \t]*$/.test(next.slice(quotePrefix.length))
    if (marker >= 0 && !setext) st.bareReferenceHeads.push({ index: st.kept.length, key, marker, labelLength: label.length })
    keepLines(st, line, ...continued)
    return { i, canStart: false }
  }
  const authoredKey = normalizeReferenceLabel(label)
  const authoredRepeated = st.authoredDefinitions.has(authoredKey)
  const repeated = st.defined.has(key) || authoredRepeated
  st.authoredDefinitions.add(authoredKey)
  st.defined.add(key)
  if (label.startsWith('^')) {
    keepLines(st, line, ...continued)
    return { i, canStart: true }
  }
  if (!repeated) {
    st.labels.set(key, label)
    st.sourceLabels.set(normalizeReferenceLabel(label), label)
  }
  const preceding = st.precedingNonblank
  const nextNonblank = st.lines[nextNonblankFrom(st, i + 1)]
  const isItem = (entry: string | undefined) => entry !== undefined &&
    /^ {0,3}(?:[-*+]|[0-9]{1,9}[.)])(?:[ \t]|$)/.test(entry.slice(quotePrefix.length))
  if (!opensItem && leadingSpaces(line) < 2 && st.kept.at(-1)?.trim() === '' && isItem(preceding) && isItem(nextNonblank)) {
    keepLines(st, line, ...continued)
    return { i, canStart: true }
  }
  const next = st.lines[i + 1]
  const nextTitle = next !== undefined && next.startsWith(quotePrefix)
    ? new RegExp(String.raw`^[ \t]*${TITLE}[ \t]*$`).exec(next.slice(quotePrefix.length)) : null
  const targetHasTitle = new RegExp(String.raw`[ \t]${TITLE}[ \t]*$`).test(target)
  let title = !targetHasTitle && nextTitle
    ? ` ${nextTitle[1]}` : ''
  let multilineTitle = false
  if (!title && !targetHasTitle && opensItem && next !== undefined && /^ {2,}"[^"\n]*$/.test(next) &&
      st.lines[i + 2] !== undefined && /^ {2,}[^"\n]*"[ \t]*$/.test(st.lines[i + 2]!) &&
      !st.lines.some((candidate, at) => at !== i &&
        (/^ {0,3}>/.test(candidate) || /^(?:[ \t]*[-*+][ \t]+)?#{1,6}[ \t]/.test(candidate) ||
          /^[ \t]*\|/.test(candidate) || /^[ \t]*\d+[.)][ \t]/.test(candidate) ||
          /^[ \t]*[-=]+[ \t]*$/.test((st.lines[at + 1] ?? '').replace(/^(?: {0,3}>[ \t]?)*/, ''))) &&
        Array.from(candidate.matchAll(/\[([^\]\n]+)\]/g)).some(match => normalizeReferenceLabel(match[1]!) === key))) {
    title = ` "${next.trimStart().slice(1)}${st.titleBreakMarker}${st.lines[i + 2]!.trim().slice(0, -1)}"`
    multilineTitle = true
    i += 2
  } else if (title) i++
  if (!repeated && label.includes('|')) st.tableInline.set(label, `${target}${title}`)
  const writtenTarget = rewriteParenthesizedTitle(`${target}${title}`.replace(new RegExp(String.raw`^<((?:[^<>\n\\]|\\[^\n])+)>`), (_match, url: string) =>
    url.replace(/[ \t]/g, (space) => encodeURIComponent(space)),
  ))
  if ((multilineTitle || wrappedDestinationTitle) && !repeated) {
    while (st.reservedReferences.has(st.nextSerial)) st.nextSerial++
    const canonical = `carve-import-reference-${st.nextSerial++}`
    st.inline.set(canonical, `${target}${title}`)
    st.sourceLabels.set(key, canonical)
  } else if (!authoredRepeated && !wrappedDestinationTitle) {
    st.definitions.push(`[${label}]: ${writtenTarget}`)
    st.definitionContainers.push(opensItem || lineDepth > 0 || blockList > 0)
  }
  if (opensItem) {
    const nextLine = st.lines[i + 1]
    if (nextLine !== undefined && nextLine.trim() !== '' && leadingSpaces(nextLine) < prefix.length + 4 &&
        !opensBlock(nextLine) && !/^ {0,3}\[[^\]\n]+\]:/.test(nextLine.trimStart())) {
      st.lines[i + 1] = prefix + nextLine.trimStart()
    } else {
      let continuation = i + 2
      if (nextLine?.trim() === '') {
        continuation = nextNonblankFrom(st, continuation)
      }
      if (nextLine?.trim() === '' && continuation < st.lines.length &&
          leadingSpaces(st.lines[continuation]!) >= prefix.length && leadingSpaces(st.lines[continuation]!) < prefix.length + 4 &&
          !opensBlock(st.lines[continuation]!.trimStart())) {
        const moved = prefix + st.lines[continuation]!.trimStart()
        // Keep a blank run in place while chained definitions move ahead of it.
        const values = st.deferredBlanks?.values ?? st.lines.slice(i + 1, continuation)
        if (st.deferredBlanks) {
          for (let at = st.deferredBlanks.end; at < continuation; at++) values.push(st.lines[at]!)
        }
        st.deferredBlanks = { start: i + 2, end: continuation + 1, values }
        st.lines[i + 1] = moved
        st.lines[continuation] = ''
        st.referenceChunk = undefined
      } else keepLines(st, prefix.trimEnd() + ' \x00REFITEM\x00')
    }
  } else if (quotePrefix !== '') {
    keepLines(st, quotePrefix)
  } else if ((st.kept.length === 0 || st.kept.at(-1)!.trim() === '') && st.lines[i + 1]?.trim() === '') {
    i++
  } else if (st.lines[i + 1]?.startsWith('    ') && st.lines[i + 1]!.trim() !== '') {
    st.lines[i + 1] = st.lines[i + 1]!.replace(/^ {4}/, '')
    if (st.referenceChunk && i + 1 >= st.referenceChunk.start && i + 1 <= st.referenceChunk.through) {
      st.referenceChunk.offsets[i + 1 - st.referenceChunk.start]! += 4
    }
  }
  return { i, canStart: true }
}

/** Record a definition whose destination is empty, for inline fallback. */
function recordEmptyDestination(st: ReferenceExtraction, d: DefinitionLine, emptied: RegExpExecArray): number {
  const { label, key, quotePrefix, prefix, opensItem, lineDepth, blockList } = d
  let i = d.i
  let raw = emptied[1] ?? ''
  const next = st.lines[i + 1]
  const nextTitle = next !== undefined && next.startsWith(quotePrefix) ? new RegExp(String.raw`^[ \t]*${TITLE}[ \t]*$`).exec(next.slice(quotePrefix.length)) : null
  if (raw === '' && nextTitle) {
    raw = nextTitle[1]!
    i++
  }
  const authoredKey = normalizeReferenceLabel(label)
  if (!st.defined.has(key) && !st.authoredDefinitions.has(authoredKey)) {
    st.empty.set(key, raw === '' ? '' : decodeLinkTitle(raw.slice(1, -1), st.decodeEntity).replaceAll(st.titleBreakMarker, '\n'))
    if (raw !== '') st.titled.add(key)
    if (raw !== '') st.discardedEmptyDefinitions.push({ line: st.sourceIndex, label })
    const canonicalLabel = label.includes('\\')
      ? label
      : decodeLinkTitle(label, st.decodeEntity)
    st.labels.set(key, canonicalLabel)
    st.sourceLabels.set(key, canonicalLabel)
    if (raw === '') {
      st.definitions.push(`[${canonicalLabel}]:`)
      st.definitionContainers.push(opensItem || lineDepth > 0 || blockList > 0)
    }
  }
  st.defined.add(key)
  st.authoredDefinitions.add(authoredKey)
  // Keep the item as an empty comment line; the output pass restores the
  // marker after inline conversion.
  if (opensItem) keepLines(st, prefix.trimEnd() + ' \x00REFITEM\x00')
  else if (quotePrefix !== '') keepLines(st, quotePrefix)
  else if ((st.kept.length === 0 || st.kept.at(-1)!.trim() === '') && i + 1 < st.lines.length && st.lines[i + 1]!.trim() === '') i++
  return i
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
): {
  lines: string[]
  sourceLines: number[]
  references: EmptyDestinationReferences
  definitions: string[]
  definitionContainers: boolean[]
  discardedEmptyDefinitions: Array<{ line: number; label: string }>
  /** Input line indices this pass read as HTML BLOCK content. */
  htmlLines: Set<number>
  /** Input line indices opening a list item whose content is a task box plus an HTML comment. */
  taskHtmlLines: Set<number>
  titleBreakMarker: string
} {
  const htmlLines = new Set<number>()
  const taskHtmlLines = new Set<number>()
  const lines = [...inputLines]
  const titleSerial = freeMarkerSerial(inputLines, 'CARVEMDTITLEBREAK', 'CARVEMDTITLEWRAP')
  const titleBreakMarker = `CARVEMDTITLEBREAK${titleSerial}Z`
  const titleWrap = `CARVEMDTITLEWRAP${titleSerial}Z`
  const empty = new Map<string, string>()
  const titled = new Set<string>()
  const defined = new Set<string>()
  const labels = new Map<string, string>()
  const definitions: string[] = []
  const definitionContainers: boolean[] = []
  const discardedEmptyDefinitions: Array<{ line: number; label: string }> = []
  const inline = new Map<string, string>()
  const tableInline = new Map<string, string>()
  const sourceLabels = new Map<string, string>()
  const footnotes = new Map<string, string>()
  let nextFootnote = 1
  const reserved = reservedImportSerials(lines, decodeEntity)
  const reservedFootnotes = reserved.footnotes
  const st: ReferenceExtraction = {
    lines, kept: [], keptSource: [], bareReferenceHeads: [], sourceIndex: 0, precedingNonblank: undefined,
    referenceChunk: undefined, deferredBlanks: undefined, nextSerial: 1, reservedReferences: reserved.references,
    decodeEntity, titleBreakMarker, titleWrap, empty, titled, defined, authoredDefinitions: new Set(), labels,
    sourceLabels, inline, tableInline, definitions, definitionContainers, discardedEmptyDefinitions,
  }
  const { kept } = st
  const keep = (...entries: string[]): void => keepLines(st, ...entries)
  const referenceSource = (index: number): string => {
    if (!st.referenceChunk || st.referenceChunk.lines !== lines || index > st.referenceChunk.through) {
      const chunks: string[] = []
      const offsets: number[] = []
      let size = 0, through = index
      for (; through < lines.length && lines[through]!.trim() !== '' && (through === index || !interruptsParagraph(lines[through]!)); through++) {
        offsets.push(size)
        chunks.push(lines[through]!)
        size += lines[through]!.length + 1
      }
      st.referenceChunk = { lines, start: index, through: through - 1, text: chunks.join('\n'), offsets }
    }
    return st.referenceChunk.text.slice(st.referenceChunk.offsets[index - st.referenceChunk.start])
  }
  const flushBlanks = (): void => {
    const blanks = st.deferredBlanks
    if (!blanks) return
    for (let at = blanks.start; at < blanks.end; at++) {
      lines[at] = blanks.values[at - blanks.start]!
    }
    st.deferredBlanks = undefined
    st.referenceChunk = undefined
  }
  let fence: string | null = null
  let htmlCloser: RegExp | null = null
  let blockDepth = 0
  let blockList = 0
  let canStart = true
  let depth = 0
  let listIndent = 0
  /** The content column every container prefix on the line put the body at. */
  let blockIndent = 0
  for (let i = 0; i < lines.length; i++) {
    st.sourceIndex = i
    if (st.deferredBlanks && i >= st.deferredBlanks.start) flushBlanks()
    const line = lines[i]!
    const quotePrefix = /^((?: {0,3}>[ \t]?)*)/.exec(line)![1]!
    const lineDepth = (quotePrefix.match(/>/g) ?? []).length
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
      htmlLines.add(i)
      let htmlStart = 0
      for (let level = 0; level < blockDepth; level++) {
        htmlStart = quotePrefix.indexOf('>', htmlStart) + 1
        if (line[htmlStart] === ' ' || line[htmlStart] === '\t') htmlStart++
      }
      if (htmlCloser.test(line.slice(htmlStart))) {
        htmlCloser = null
        canStart = true
      }
      keep(line)
      continue
    }
    const containers = readContainerPrefixes(line, quotePrefix, fence, listIndent, blockIndent)
    const { prefix, content, blockContent, opensItem } = containers
    listIndent = containers.listIndent
    blockIndent = containers.blockIndent
    if (fence !== null) {
      const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(blockContent)
      if (close && close[1]![0] === fence[0] && close[1]!.length >= fence.length) {
        fence = null
        canStart = true
      }
      keep(line)
      depth = lineDepth
      continue
    }
    const open = /^ {0,3}(`{3,}|~{3,})/.exec(blockContent)
    if (open) {
      fence = open[1]!
      blockDepth = lineDepth
      blockList = listIndent
      keep(line)
      depth = lineDepth
      continue
    }
    // A TASK BOX IS INLINE CONTENT, so an HTML block cannot begin after it and
    // a carrier marker standing there is not one. It is still the whole line,
    // which is what admits it (markup-carve/carve#2850).
    if (opensItem && leadingSpaces(blockContent) <= 3 && /^\[[ xX]\][ \t]+<!--/.test(blockContent.replace(/^ +/, ''))) {
      taskHtmlLines.add(i)
    }
    const closer = htmlBlockCloser(blockContent.replace(/^ +/, ''))
    if (closer !== null && leadingSpaces(blockContent) <= 3) {
      htmlLines.add(i)
      if (!closer.test(blockContent.replace(/^ +/, '').slice(2))) {
        htmlCloser = closer
        blockDepth = lineDepth
        blockList = listIndent
      }
      keep(line)
      depth = lineDepth
      canStart = true
      continue
    }
    if (leadingSpaces(blockContent) <= 3 && opensOpaqueHtml(blockContent, canStart)) {
      htmlLines.add(i)
      htmlCloser = /^[ \t]*$/
      blockDepth = lineDepth
      blockList = listIndent
      keep(line)
      depth = lineDepth
      continue
    }
    if (canStart && !opensItem && lineDepth === 0 && listIndent === 0 && /^ {0,3}\[(?!\^)/.test(content)) {
      const single = /^ {0,3}\[((?:[^[\]\\]|\\.)+)\]:(.*)$/.exec(content)
      const ordinary = single && !/\\\]/.test(single[1]!) && (single[2]!.trim() === '' || LINE_TITLE.test(single[2]!))
      const parsed = ordinary ? undefined : readMarkdownReferenceDefinition(referenceSource(i))
      if (parsed?.complex && !parsed.target.startsWith('<>')) {
        const key = normalizeReferenceLabel(parsed.label)
        if (!st.authoredDefinitions.has(key)) {
          while (st.reservedReferences.has(st.nextSerial)) st.nextSerial++
          const canonical = `carve-import-reference-${st.nextSerial++}`
          inline.set(canonical, parsed.target)
          sourceLabels.set(normalizeReferenceLabel(parsed.label), canonical)
          defined.add(key)
          st.authoredDefinitions.add(key)
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
      if ((label.includes('|') || decodeLinkTitle(label, decodeEntity) !== label) && !footnotes.has(key)) {
        while (reservedFootnotes.has(nextFootnote)) nextFootnote++
        footnotes.set(key, `carve-import-footnote-${nextFootnote++}`)
      }
      const next = lines[nextNonblankFrom(st, i + 1)]
      const empty = definition[2]!.trim() === '' && (next === undefined || !/^ {4}/.test(next.slice(quotePrefix.length)))
      keep(line + (empty ? ' \x00FNEMPTY\x00' : ''))
      depth = lineDepth
      canStart = false
      continue
    }
    // A paragraph continuation line of this definition, without its quote
    // prefix. A line with fewer `>` is a lazy continuation (CommonMark 5.1).
    const continuationAt = (at: number): string | undefined => {
      const following = lines[at]
      if (following === undefined) return undefined
      const followingPrefix = /^((?: {0,3}>[ \t]?)*)/.exec(following)![1]!
      if ((followingPrefix.match(/>/g) ?? []).length > lineDepth) return undefined
      const body = following.slice(followingPrefix.length)
      return body.trim() === '' || opensBlock(body) ? undefined : body
    }
    // A quoted definition with a destination joins a wrapped title too, and
    // its uses become titled inline links (carve-js#3169).
    const quotedDestination = lineDepth > 0 && listIndent === 0 && !definition?.[1]?.startsWith('^') &&
      new RegExp(String.raw`^[ \t]*${DESTINATION}(?:[ \t]+["'(]|[ \t]*$)`).test(definition?.[2] ?? '')
    const destinationPattern = quotedDestination ? DESTINATION : '<>'
    const titleOnNext = new RegExp(String.raw`^[ \t]*${destinationPattern}[ \t]*$`).test(definition?.[2] ?? '') &&
      /^[ \t]*["'(]/.test(continuationAt(i + 1) ?? '')
    let wrappedDestinationTitle = false
    if ((canStart || lineDepth > depth) && !opensItem && (quotePrefix === '' || listIndent === 0) && definition &&
      (new RegExp(String.raw`^[ \t]*${destinationPattern}[ \t]+["'(]`).test(definition[2]!) || titleOnNext)) {
      const joined = joinWrappedDefinitionTitle(st, definition, i, destinationPattern, titleOnNext, continuationAt)
      if (joined !== null) {
        i = joined.i
        wrappedDestinationTitle = joined.wrapped
      }
    }
    if (
      (canStart || opensItem || lineDepth > depth) &&
      definition &&
      new RegExp(String.raw`^[ \t]*(?:(?:${ANGLE_DESTINATION}|[^<\x00-\x20\x7f][^\x00-\x20\x7f]*)(?:[ \t]+${TITLE})?[ \t]*)?$`).test(definition[2]!)
    ) {
      depth = lineDepth
      const key = normalizeReferenceLabel(definition[1]!)
      const continued: string[] = []
      let destination = definition[2]!
      const following = lines[i + 1]
      if (trimReferenceWhitespace(destination) === '' && following !== undefined && following.startsWith(quotePrefix) &&
          !opensBlock(following.slice(quotePrefix.length)) && LINE_TITLE.test(following.slice(quotePrefix.length))) {
        continued.push(following)
        i++
        destination = following.slice(quotePrefix.length)
      }
      const d: DefinitionLine = { line, i, label: definition[1]!, key, continued, quotePrefix, prefix, opensItem, lineDepth, blockList, wrappedDestinationTitle }
      const emptied = new RegExp(String.raw`^[ \t]*<>(?:[ \t]+${TITLE})?[ \t]*$`).exec(destination)
      if (!emptied) {
        const written = writeTargetDefinition(st, d, destination)
        i = written.i
        canStart = written.canStart
        continue
      }
      i = recordEmptyDestination(st, d, emptied)
      canStart = true
      continue
    }
    keep(line)
    depth = lineDepth
    canStart = content.trim() === '' || /^ {0,3}(?:#{1,6}(?:[ \t]|$)|([-*_])(?:[ \t]*\1){2,}[ \t]*$|=+[ \t]*$)/.test(content)
  }
  for (const { index, key, marker, labelLength } of st.bareReferenceHeads) {
    const line = kept[index]!
    kept[index] = defined.has(key)
      ? line.slice(0, marker + labelLength + 2) + '[]' + line.slice(marker + labelLength + 2)
      : line.slice(0, marker) + '\\' + line.slice(marker)
  }
  return {
    lines: kept,
    titleBreakMarker,
    sourceLines: st.keptSource,
    references: { empty, titled, defined, labels, inline, tableInline, sourceLabels, footnotes, titleWrap },
    definitions,
    definitionContainers,
    discardedEmptyDefinitions,
    htmlLines,
    taskHtmlLines,
  }
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

/** CommonMark's alt text: the description's content with its markup removed. */
export function plainAltText(label: string, placeholders: readonly string[], decodeEntity: (entity: string) => string, sources: readonly string[] = placeholders): string {
  let previous: string
  const nestedLink = new RegExp(String.raw`!?\[${LABEL}\](?=\()`, 'g')
  const referenceLink = new RegExp(String.raw`!?\[${LABEL}\]`, 'g')
  const referenceTail = /\[([^[\]\n]*)\]/y
  const defined = (label: string): boolean => references.defined.has(normalizeReferenceLabel(referenceSourceText(label, placeholders)))
  do {
    previous = label
    label = label.replace(/\x00P(\d+)\x00/g, (token, index: string) => {
      const span = placeholders[Number(index)] ?? token
      return span.startsWith('(') || span.startsWith('![') || span.startsWith('[') ? span : token
    })
    let nestedWritten = '', nestedCursor = 0
    nestedLink.lastIndex = 0
    for (let match; (match = nestedLink.exec(label)) !== null;) {
      const open = nestedLink.lastIndex
      const end = markdownInlineDestinationEnd(label, open)
      const destination = end === undefined ? undefined : label.slice(open, end + 1)
      const original = destination?.includes('\x00') ? referenceSourceText(destination, sources) : undefined
      if (end === undefined || original !== undefined && markdownInlineDestinationEnd(original, 0) !== original.length - 1) { nestedLink.lastIndex = match.index + 1; continue }
      nestedWritten += label.slice(nestedCursor, match.index) + match[1]!
      nestedLink.lastIndex = end + 1
      nestedCursor = nestedLink.lastIndex
    }
    label = nestedWritten + label.slice(nestedCursor)
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
  return markdownEmphasis(label, undefined, undefined, placeholders, true, true).replace(RE_ENTITY, decodeEntity).replace(/\x00P(\d+)\x00/g, (_m, index: string) => {
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
 * Write a native Carve link or image for a Markdown empty destination.
 * Image alternative text is flattened through the HTML importer.
 */
function unwrapEmptyDestination(
  label: string,
  image: boolean,
  title: string,
  before: string,
  placeholders: readonly string[],
  protect: (s: string) => string,
  decodeEntity: (entity: string) => string,
  keepBoundary = true,
  hasTitle = false,
): string {
  // Bare at the start of a line or container, the text would open a block.
  const lineStart = /^[ \t]*(?:(?:>|[-*+]|(?:[0-9]{1,9}|[A-Za-z])[.)])[ \t]+|>)*(?:#{1,6}[ \t]+)?$/.test(before)
  if (image) {
    const titleAttr = hasTitle ? ` title="${escapeHtml(title)}"` : ''
    const html = `<p><img src="" alt="${escapeHtml(plainAltText(label, placeholders, decodeEntity))}"${titleAttr}></p>`
    const written = trimMatchingEdges(htmlToCarve(html).value, (code) => code === 10)
    const text = hasTitle && references.titleWrap !== undefined ? written.replaceAll('\n', references.titleWrap) : written
    return keepEmptyDestinationBoundary(lineStart ? escapeLineInitialBlockSyntax(text) : text, lineStart, protect, keepBoundary, true)
  }
  const escaped = title.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  const slot = hasTitle ? `( "${references.titleWrap === undefined ? escaped : escaped.replaceAll('\n', references.titleWrap)}")` : '()'
  return `[${label}]${protect(slot)}`
}

/** Rewrites empty Markdown destinations to native Carve spellings. */
export function unwrapEmptyDestinations(
  line: string,
  placeholders: readonly string[],
  protect: (s: string) => string,
  decodeEntity: (entity: string) => string,
  onUnwrap?: (image: boolean, before: string, subject: string) => void,
  excluded?: (subject: string, offset: number) => boolean,
  prepareLabel?: (label: string) => string,
  keepBoundaryAt?: (subject: string, offset: number) => boolean,
  insideImageAt?: (subject: string, offset: number) => boolean,
): string {
  const replaceAt = (re: RegExp, pick: (m: RegExpExecArray, emittedPrefix: string) => string | null): void => {
    const subject = line
    let out = ''
    let cursor = 0
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(subject)) !== null) {
      if (excluded?.(subject, m.index)) {
        re.lastIndex = m.index + 1
        continue
      }
      const replacement = pick(m, out + subject.slice(cursor, m.index))
      if (replacement === null) continue
      out += subject.slice(cursor, m.index) + replacement
      cursor = m.index + m[0].length
    }
    line = out + subject.slice(cursor)
  }
  let imageSubject: string | undefined
  let imageRanges: Array<[number, number]> = []
  const unwrap = (m: RegExpExecArray, title: string, subject: string, emittedPrefix: string, hasTitle: boolean) => {
    if (subject !== imageSubject) {
      imageSubject = subject
      imageRanges = []
      const images = new RegExp(String.raw`!\[${LABEL}\](?:(\((?:[^()\n]|\([^()\n]*\))*\))|\[([^[\]\n]*)\])?`, 'g')
      for (const image of subject.matchAll(images)) {
        const key = normalizeReferenceLabel(referenceSourceText(image[3] || image[1]!, placeholders))
        if (image[2] !== undefined || references.defined.has(key)) {
          imageRanges.push([image.index!, image.index! + 2 + image[1]!.length])
        }
      }
    }
    const insideImage = (insideImageAt?.(subject, m.index) ?? false) || imageRanges.some(([start, end]) => m.index > start && m.index < end)
    if (!insideImage) {
      onUnwrap?.(m[0][0] === '!', subject.slice(0, m.index), subject)
    }
    const image = m[0][0] === '!'
    const label = image ? m[1]! : prepareLabel?.(m[1]!) ?? m[1]!
    const next = subject[m.index + m[0].length]
    const isolatedPlainLabel = /^[A-Za-z0-9 ]+$/.test(m[1]!)
      && (emittedPrefix === '' || /\s$/.test(emittedPrefix))
      && (next === undefined || /\s/.test(next))
    return unwrapEmptyDestination(label, image, title, emittedPrefix, placeholders, protect, decodeEntity, !insideImage && !isolatedPlainLabel && (keepBoundaryAt?.(subject, m.index) ?? true), hasTitle)
  }
  if (references.empty.size > 0) {
    const byReference = (m: RegExpExecArray, reference: string, subject: string, emittedPrefix: string): string | null => {
      const key = normalizeReferenceLabel(referenceSourceText(reference, placeholders))
      const title = references.empty.get(key)
      return title === undefined || !references.titled.has(key) ? null : unwrap(m, title, subject, emittedPrefix, true)
    }
    let subject = line
    replaceAt(new RegExp(String.raw`!?\[${LABEL}\](?:\[\]|\[([^[\]\n]+)\])`, 'g'), (m, before) => byReference(m, m[2] ?? m[1]!, subject, before))
    subject = line
    replaceAt(/!?\[([^[\]\n]+)\](?![[(:])/g, (m, before) => {
      const next = /^\x00P(\d+)\x00/.exec(subject.slice(m.index + m[0].length))
      if (next && placeholders[Number(next[1])] !== '\\]') return null
      return byReference(m, m[1]!, subject, before)
    })
  }
  const subject = line
  replaceAt(
    new RegExp(String.raw`!?\[${LABEL}\]\([ \t]*(?:<>(?:[ \t]+("[^"\n]*"|'[^'\n]*'|\([^()\n]*\)))?[ \t]*)?\)`, 'g'),
    (m, before) => unwrap(m, m[2] !== undefined ? decodeLinkTitle(m[2].slice(1, -1), decodeEntity, placeholders) : '', subject, before, m[2] !== undefined),
  )
  return line
}
