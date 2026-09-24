/*
 * CommonMark links an empty destination; Carve reads `[t]()` as literal text
 * (markup-carve/carve#2069). The Markdown importer writes such a link as its
 * text and such an image as its alt text, matching markup-carve/carve-php#2067.
 */

import { htmlToCarve } from './html-import.js'

/** Labels whose first reference definition has an empty destination, to its decoded title. */
export interface EmptyDestinationReferences {
  empty: Map<string, string>
  defined: Set<string>
  labels: Map<string, string>
}

const NO_REFERENCES: EmptyDestinationReferences = { empty: new Map(), defined: new Set(), labels: new Map() }

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
): string | undefined {
  if (label.startsWith('^')) return undefined
  const key = normalizeReferenceLabel(decodeLinkTitle(label, decodeEntity, placeholders))
  return references.empty.has(key) ? undefined : references.labels.get(key)
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
  return label.trim().replace(/\s+/gu, ' ').toUpperCase().toLowerCase()
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

/**
 * Remove reference definitions from the body. Empty destinations are recorded
 * for inline fallback; other definitions are returned for the document end.
 */
export function extractReferenceDefinitions(
  lines: readonly string[],
  decodeEntity: (entity: string) => string,
): { lines: string[]; references: EmptyDestinationReferences; definitions: string[] } {
  const empty = new Map<string, string>()
  const defined = new Set<string>()
  const labels = new Map<string, string>()
  const definitions: string[] = []
  const kept: string[] = []
  let fence: string | null = null
  let htmlCloser: RegExp | null = null
  let blockDepth = 0
  let blockList = 0
  let canStart = true
  let depth = 0
  let listIndent = 0
  const leadingSpaces = (s: string) => /^ */.exec(s)![0].length
  const lineTitle = new RegExp(String.raw`^[ \t]*(?:<[^<>\n]*>|[^<\s]\S*)(?:[ \t]+${TITLE})?[ \t]*$`)
  const opensBlock = (text: string): boolean =>
    /^ {0,3}(?:>|#{1,6}(?:[ \t]|$)|`{3,}|~{3,}|(?:[-*+]|[0-9]{1,9}[.)])(?:[ \t]|$))/.test(text) ||
    /^[ \t]*(?:=+|[-*_]{3,})[ \t]*$/.test(text)
  for (let i = 0; i < lines.length; i++) {
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
      kept.push(line)
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
      kept.push(line)
      depth = lineDepth
      continue
    }
    const open = /^ {0,3}(`{3,}|~{3,})/.exec(content)
    if (open) {
      fence = open[1]!
      blockDepth = lineDepth
      blockList = listIndent
      kept.push(line)
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
      kept.push(line)
      depth = lineDepth
      canStart = true
      continue
    }
    // A deeper quote opens a block; a shallower line is lazy continuation.
    const definition = /^ {0,3}\[((?:[^[\]\\]|\\.)+)\]:(.*)$/.exec(content)
    if (
      (canStart || opensItem || lineDepth > depth) &&
      definition &&
      new RegExp(String.raw`^[ \t]*(?:(?:<[^<>\n]*>|[^<\s]\S*)(?:[ \t]+${TITLE})?[ \t]*)?$`).test(definition[2]!)
    ) {
      depth = lineDepth
      const key = normalizeReferenceLabel(decodeLinkTitle(definition[1]!, decodeEntity))
      const continued: string[] = []
      let destination = definition[2]!
      const following = lines[i + 1]
      if (destination.trim() === '' && following !== undefined && following.startsWith(quotePrefix) &&
          !opensBlock(following.slice(quotePrefix.length)) && lineTitle.test(following.slice(quotePrefix.length))) {
        continued.push(following)
        i++
        destination = following.slice(quotePrefix.length)
      }
      const emptied = new RegExp(String.raw`^[ \t]*<>(?:[ \t]+${TITLE})?[ \t]*$`).exec(destination)
      if (!emptied) {
        const target = destination.trim()
        if (target === '') {
          kept.push(line, ...continued)
          canStart = false
          continue
        }
        const repeated = defined.has(key)
        defined.add(key)
        if (definition[1]!.startsWith('^')) {
          kept.push(line, ...continued)
          canStart = true
          continue
        }
        if (!repeated) labels.set(key, definition[1]!)
        let preceding: string | undefined
        for (let at = kept.length - 1; at >= 0; at--) {
          if (kept[at]!.trim() !== '') { preceding = kept[at]; break }
        }
        let nextNonblank: string | undefined
        for (let at = i + 1; at < lines.length; at++) {
          if (lines[at]!.trim() !== '') { nextNonblank = lines[at]; break }
        }
        const isItem = (entry: string | undefined) => entry !== undefined &&
          /^ {0,3}(?:[-*+]|[0-9]{1,9}[.)])(?:[ \t]|$)/.test(entry.slice(quotePrefix.length))
        if (!opensItem && kept.at(-1)?.trim() === '' && isItem(preceding) && isItem(nextNonblank)) {
          kept.push(line, ...continued)
          canStart = true
          continue
        }
        const next = lines[i + 1]
        const nextTitle = next !== undefined && next.startsWith(quotePrefix)
          ? new RegExp(String.raw`^[ \t]*${TITLE}[ \t]*$`).exec(next.slice(quotePrefix.length)) : null
        const title = !new RegExp(String.raw`[ \t]${TITLE}[ \t]*$`).test(target) && nextTitle
          ? ` ${nextTitle[1]}` : ''
        if (title) i++
        const writtenTarget = `${target}${title}`.replace(/^<([^<>]+)>/, (_match, url: string) =>
          url.replace(/[ \t]/g, (space) => encodeURIComponent(space)),
        ).replace(
          /[ \t]+\(((?:[^()\\]|\\.)*)\)\s*$/,
          (_match, body: string) => ` "${body.replace(/"/g, '\\"')}"`,
        )
        if (!repeated || empty.has(key)) definitions.push(`[${definition[1]}]: ${writtenTarget}`)
        if (opensItem) {
          const nextLine = lines[i + 1]
          if (nextLine !== undefined && nextLine.trim() !== '' && leadingSpaces(nextLine) < prefix.length + 4 &&
              !opensBlock(nextLine) && !/^ {0,3}\[[^\]\n]+\]:/.test(nextLine.trimStart())) {
            lines = [...lines.slice(0, i + 1), prefix + nextLine.trimStart(), ...lines.slice(i + 2)]
          } else {
            const continuation = lines.findIndex((candidate, at) => at > i + 1 && candidate.trim() !== '')
            if (nextLine?.trim() === '' && continuation > i + 1 &&
                leadingSpaces(lines[continuation]!) >= prefix.length && leadingSpaces(lines[continuation]!) < prefix.length + 4 &&
                !opensBlock(lines[continuation]!.trimStart())) {
              lines = [...lines.slice(0, i + 1), prefix + lines[continuation]!.trimStart(),
                ...lines.slice(i + 1, continuation), ...lines.slice(continuation + 1)]
            } else kept.push(prefix.trimEnd() + ' \x00REFITEM\x00')
          }
        } else if (quotePrefix !== '') {
          const nextLine = lines[i + 1]
          if (nextLine !== undefined && nextLine.trim() !== '' && !opensBlock(nextLine) &&
              !/^ {0,3}\[[^\]\n]+\]:/.test(nextLine.trimStart())) {
            kept.push(quotePrefix + nextLine.trimStart())
            i++
          } else kept.push(quotePrefix)
        } else if ((kept.length === 0 || kept.at(-1)!.trim() === '') && lines[i + 1]?.trim() === '') {
          i++
        } else if (lines[i + 1]?.startsWith('    ') && lines[i + 1]!.trim() !== '') {
          lines = [...lines.slice(0, i + 1), lines[i + 1]!.replace(/^ {4}/, ''), ...lines.slice(i + 2)]
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
      if (!defined.has(key)) empty.set(key, raw === '' ? '' : decodeLinkTitle(raw.slice(1, -1), decodeEntity))
      defined.add(key)
      canStart = true
      // A quote keeps its line, and so does a list item: dropping the item took
      // it out of the list, so the list came back one item short of what
      // CommonMark reads (markup-carve/carve-js#1991). The item is left holding
      // the same placeholder a NON-empty destination leaves behind, since the
      // two say the same thing - an item whose only content was a definition
      // that moved away.
      if (opensItem) kept.push(prefix.trimEnd() + ' \x00REFITEM\x00')
      else if (quotePrefix !== '') kept.push(quotePrefix)
      else if ((kept.length === 0 || kept.at(-1)!.trim() === '') && i + 1 < lines.length && lines[i + 1]!.trim() === '') i++
      continue
    }
    kept.push(line)
    depth = lineDepth
    canStart = content.trim() === '' || /^ {0,3}(?:#{1,6}(?:[ \t]|$)|([-*_])(?:[ \t]*\1){2,}[ \t]*$|=+[ \t]*$)/.test(content)
  }
  return { lines: kept, references: { empty, defined, labels }, definitions }
}

/** A line-initial block opener in text, escaped so the text stays a paragraph. */
function escapeLineInitialBlockSyntax(text: string): string {
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
function plainAltText(label: string, placeholders: readonly string[], decodeEntity: (entity: string) => string): string {
  let previous: string
  const nestedLink = new RegExp(String.raw`!?\[${LABEL}\]\([^()\n]*\)`, 'g')
  const referenceLink = new RegExp(String.raw`!?\[${LABEL}\](?:\[([^[\]\n]*)\])?(?![[(:])`, 'g')
  do {
    previous = label
    label = label.replace(nestedLink, '$1')
    label = label.replace(referenceLink, (match, text: string, reference: string | undefined) =>
      references.defined.has(normalizeReferenceLabel(decodeLinkTitle(reference ? reference : text, decodeEntity, placeholders))) ? text : match,
    )
    label = label.replace(/(\*{1,3}|_{1,3}|~~)(?!\s)(.+?)(?<!\s)\1/g, '$2')
  } while (label !== previous)
  return label.replace(RE_ENTITY, decodeEntity).replace(/\x00P(\d+)\x00/g, (_m, index: string) => {
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
    const text = htmlToCarve(html).value.replace(/^\n+|\n+$/g, '')
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
