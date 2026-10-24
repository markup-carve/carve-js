import { djotImportLosses } from './djot-import-losses.js'
import { djotBlockLayout } from './djot-block-layout.js'
import { continuesParagraph } from './djot-attributes.js'
import { djotCollapsedReferenceCache } from './djot-collapsed-reference.js'
import { djotTableRows, isDjotEscaped, maskDjotCodeAndDestinations } from '../../djot-migrate.js'
import { readAttributes } from './djot-word-attributes.js'
import { parseAttrs } from '../../extension/attribute-parser.js'
import { djotInlineBoundaries } from './djot-inline-boundaries.js'

const definitionKey = (label: string): string => label.trim().replace(/[ \t\r\n]+/g, ' ')
const referenceKey = (label: string): string =>
  definitionKey(label.replace(/\\([ \t!-\/:-@\[-`{-~])/g, '$1'))

function literalReferenceAttributes(source: string, depth: number): string {
  return source.split('\n').map((line, index) => {
    let at = 0
    if (index) for (let level = 0; level < depth; level++) {
      const prefix = /^[ \t]*>(?:[ \t]|$)/.exec(line.slice(at))
      if (!prefix) break
      at += prefix[0].length
    }
    return line.slice(0, at) + line.slice(at).replace(/[!-\/:-@\[-`{-~]/g, char => '\\' + char)
  }).join('\n')
}

function referenceMask(source: string): string {
  const mask = maskDjotCodeAndDestinations(source, false, true, false).split('')
  for (let at = 0; at < source.length; at++) {
    if (mask[at] !== '{' || isDjotEscaped(source, at)) continue
    const attrs = readAttributes(source, at)
    if (!attrs) continue
    for (let k = at; k < attrs.end; k++) if (mask[k] !== '\n') mask[k] = ' '
    at = attrs.end - 1
  }
  return mask.join('')
}

function foldLabelLines(label: string): string {
  const lines = label.split('\n')
  const first = lines.shift()!.trimEnd()
  const last = lines.pop()!.trimStart()
  return [first, ...lines.map(line => line.trim()).filter(Boolean), last].join(' ')
}

function continuesReferenceQuote(source: string, at: number, label: string, contentStart: (line: string) => number): boolean {
  const firstLine = source.slice(source.lastIndexOf('\n', at) + 1, at)
  const depth = (firstLine.slice(0, contentStart(firstLine)).match(/>/g) ?? []).length
  if (depth === 0) return true
  return label.split('\n').slice(1).every(line => {
    const prefix = /^(?:[ \t]*>(?:[ \t]|$))*/.exec(line)![0]
    return (prefix.match(/>/g) ?? []).length >= depth ||
      !/^(?:#{1,6} |[-*+](?:[ \t]|$)|[0-9A-Za-z]+[.)] |:{3,}|`{3,}|~{3,}|\||\{|\[[^\]]+\]:)/.test(line.slice(prefix.length).replace(/^[ \t]*/, ''))
  })
}

function normalizeMultilineLabels(
  source: string,
  replace: (at: number, label: string, image: boolean) => string | undefined,
  explicit: boolean,
  mask: string,
): string {
  let open = -1, multiline = false, copied = 0, consumed = 0, output = ''
  const images: boolean[] = []
  const boundaries = source.includes('\n') && source.includes('[') ? new Set(djotInlineBoundaries(source, mask)) : new Set<number>()
  for (let at = 0; at < source.length; at++) {
    if (boundaries.has(at)) { images.length = 0; open = -1; multiline = false }
    if (source[at] === '[') {
      if (mask[at] !== ' ') images.push((images.at(-1) ?? false) || source[at - 1] === '!' && !isDjotEscaped(source, at - 1))
      open = at; multiline = false
    }
    else if (source[at] === '\n') multiline = true
    else if (source[at] === ']') {
      const image = mask[at] !== ' ' ? images.pop() ?? false : false
      if (open >= 0 && multiline && (explicit ? source[open - 1] === ']' : source[at + 1] === '[')) {
        const start = explicit ? open - 1 : source[open - 1] === '!' ? open - 1 : open
        if (start >= consumed) {
          consumed = at + 1
          const replacement = replace(start, source.slice(open + 1, at), image)
          if (replacement !== undefined) {
            output += source.slice(copied, start) + source.slice(start, open + 1) + replacement + ']'
            copied = at + 1
          }
        }
      }
      open = -1
    }
  }
  return output + source.slice(copied)
}

type AcceptedDefinitions = ReadonlyMap<number, { label: string; target: string; end: number }>
type ReferenceDefinition = { target: string; attrs: string; slots: Map<string, string[]>; line: number; first: number }
type ReferenceUse = {
  at: number; end: number; key: string; rawKey: string; label: string
  own: string; ownSlots: Map<string, string[]>; formatted: boolean
}
type CollapsedReferenceText = ReturnType<typeof djotCollapsedReferenceCache>

interface ReferenceLines {
  source: string
  lines: string[]
  offsets: number[]
  contentStart: (line: string) => number
}

interface DefinitionScan {
  definitions: Map<string, ReferenceDefinition>
  definitionLines: Set<number>
  removed: Set<number>
}

interface AttributeRun {
  first: number
  attrs: string[]
  attributeLines: number[]
}

/** Fold multiline labels; return the folded source and the mask the second fold read. */
function foldReferenceLabels(
  source: string,
  contentStart: (line: string) => number,
  imageChildText: boolean,
): { source: string; mask: string } {
  let mask = referenceMask(source)
  source = normalizeMultilineLabels(source, (at, label, image) =>
    !image && !imageChildText && mask[at] !== ' ' && !isDjotEscaped(source, at) && !label.startsWith('^') &&
    !label.includes('`') && !/\n[ \t]*\n/.test(label) && continuesReferenceQuote(source, at, label, contentStart)
      ? foldLabelLines(label)
      : undefined, false, mask)
  mask = referenceMask(source)
  const labels = new Set(
    source.split('\n').flatMap((line) => {
      const definition = /^\[(?!\^)([^\]\n]+)\]:/.exec(line.slice(contentStart(line)))
      return definition ? [definitionKey(definition[1]!)] : []
    }),
  )
  source = normalizeMultilineLabels(source, (at, label) =>
    mask[at] === ']' && !/\n[ \t]*\n/.test(label) && labels.has(referenceKey(label))
      ? label.replace(/\s+/g, ' ').trim()
      : undefined, true, mask)
  return { source, mask }
}

function readReferenceLines(source: string, contentStart: (line: string) => number): ReferenceLines {
  const lines = source.split('\n')
  let offset = 0
  const offsets = lines.map(line => { const at = offset; offset += line.length + 1; return at })
  return { source, lines, offsets, contentStart }
}

/** Attribute-only lines that would continue the paragraph above them. */
function attributeContinuations({ source, lines, offsets, contentStart }: ReferenceLines): Map<number, boolean> {
  const attributeContinues = new Map<number, boolean>()
  for (let index = 0; index < lines.length; index++) {
    const start = contentStart(lines[index]!)
    const content = lines[index]!.slice(start)
    if (content.startsWith('{') && readAttributes(content, 0)?.end === content.length) {
      const previous = lines[index - 1] ?? ''
      const priorBody = previous.slice(contentStart(previous))
      attributeContinues.set(index, !/^:{3,}[ \t]*$/.test(priorBody) && !/[-*+.):]/.test(lines[index]!.slice(0, start)) && continuesParagraph(source, offsets[index]! + start))
    }
  }
  return attributeContinues
}

function quoteOpeningLines(lines: readonly string[], contentStart: (line: string) => number): Set<number> {
  const quoteOpenings = new Set<number>()
  let previousQuoteDepth = 0
  for (const [index, line] of lines.entries()) {
    const depth = (line.slice(0, contentStart(line)).match(/>/g) ?? []).length
    if (depth > previousQuoteDepth) quoteOpenings.add(index)
    previousQuoteDepth = depth
  }
  return quoteOpenings
}

/** Walk up from definition `n` over the attribute lines that belong to it. */
function precedingAttributeRun(
  { lines, contentStart }: ReferenceLines,
  n: number,
  start: number,
  attributeContinues: ReadonlyMap<number, boolean>,
  quoteOpenings: ReadonlySet<number>,
  enabled: boolean,
): AttributeRun {
  let first = n, cursor = n
  const attrs: string[] = []
  const attributeLines: number[] = []
  let attributeDepth: number | undefined
  while (cursor > 0 && enabled) {
    const precedingStart = contentStart(lines[cursor - 1]!)
    const precedingPrefix = lines[cursor - 1]!.slice(0, precedingStart)
    const prefix = lines[n]!.slice(0, start)
    const quoteDepth = (value: string) => value.split('>').length - 1
    if (/[-*+.):]/.test(prefix) || quoteDepth(prefix) > quoteDepth(precedingPrefix)) break
    const depth = quoteDepth(precedingPrefix)
    const preceding = lines[cursor - 1]!.slice(precedingStart)
    if (preceding.trim() === '') {
      if (quoteOpenings.has(cursor - 1)) break
      if (attributeDepth !== undefined && depth < attributeDepth) break
      cursor--; continue
    }
    if (attributeDepth !== undefined && depth < attributeDepth) break
    if (!/[-*+.):]/.test(precedingPrefix) && attributeContinues.get(cursor - 1) === true) break
    const parsed = readAttributes(preceding, 0)
    if (parsed?.end !== preceding.length) break
    attributeDepth = depth
    attrs.push(preceding)
    attributeLines.push(cursor - 1)
    first = --cursor
    if (quoteOpenings.has(cursor)) break
  }
  return { first, attrs, attributeLines }
}

function definitionBoundary({ lines, contentStart }: ReferenceLines, definitionLines: ReadonlySet<number>, at: number): boolean {
  const previous = lines[at - 1] ?? ''
  const previousStart = contentStart(previous)
  const previousContent = previous.slice(previousStart).trim()
  const currentStart = contentStart(lines[at] ?? '')
  const noteAt = previous.slice(0, previousStart).indexOf('[^')
  const ownerStart = noteAt < 0 ? previousStart : noteAt + 1
  const quoteDepth = (line: string): number => (/^(?:(?:[ \t]*>)+[ \t]*)?/.exec(line)![0].match(/>/g) ?? []).length
  const outdented = quoteDepth(lines[at] ?? '') < quoteDepth(previous) || currentStart < ownerStart && (noteAt >= 0 || /(?:[-*+] |[0-9A-Za-z]+[.)] |\([0-9A-Za-z]+\) )/.test(previous.slice(0, previousStart)))
  return at === 0 || previousContent === '' || outdented || definitionLines.has(at - 1) ||
    /^(?:#{1,6}(?: |$)|:{3,}|[`~]{3,}|\||(?:[-*][ \t]*){3,}$)/.test(previousContent) ||
    readAttributes(previousContent, 0)?.end === previousContent.length
}

/** Drop attribute lines that cannot start a block; false when the definition itself cannot. */
function settleAttributeRun(ref: ReferenceLines, definitionLines: ReadonlySet<number>, n: number, run: AttributeRun): boolean {
  if (definitionBoundary(ref, definitionLines, run.first)) return true
  const { lines, contentStart } = ref
  let tail = -1
  for (const [index, at] of run.attributeLines.entries()) {
    const previous = lines[at - 1] ?? ''
    if (previous.slice(contentStart(previous)).trim() === '') tail = index
  }
  if (tail >= 0) {
    run.first = run.attributeLines[tail]!
    run.attrs.length = tail + 1
    run.attributeLines.length = tail + 1
    return true
  }
  if (!definitionBoundary(ref, definitionLines, n)) return false
  run.first = n
  run.attrs.length = 0
  run.attributeLines.length = 0
  return true
}

function collectReferenceDefinitions(
  ref: ReferenceLines,
  definitionMask: readonly string[],
  caretOnly: boolean,
  aliasesOnly: boolean,
  accepted: AcceptedDefinitions | undefined,
): DefinitionScan {
  const { lines, contentStart } = ref
  const attributeContinues = attributeContinuations(ref)
  const quoteOpenings = quoteOpeningLines(lines, contentStart)
  const scan: DefinitionScan = { definitions: new Map(), definitionLines: new Set(), removed: new Set() }
  for (let n = 0; n < lines.length; n++) {
    const start = contentStart(lines[n]!)
    const definition = /^\[(?!\^[^\]\n]+\]:(?:[ \t\r]|$))([^\]\n]+)\]:[ \t]*([^ \t\r\n]*)\r?$/.exec(lines[n]!.slice(start))
    if (!definition || definitionMask[n]![start] !== '[' || caretOnly && (!definition[1]!.startsWith('^') || !accepted?.has(n))) continue
    const run = precedingAttributeRun(ref, n, start, attributeContinues, quoteOpenings, !caretOnly && !aliasesOnly)
    if (!settleAttributeRun(ref, scan.definitionLines, n, run)) continue
    for (const at of run.attributeLines) scan.removed.add(at)
    const attributes = run.attrs.reverse().join('')
    scan.definitions.set(definitionKey(definition[1]!), {
      target: definition[2]!,
      attrs: attributes,
      slots: referenceAttributeSlots(attributes),
      line: n,
      first: run.first,
    })
    for (let k = run.first; k <= n; k++) scan.definitionLines.add(k)
  }
  return scan
}

/** Heading targets for NUL-bearing labels that no definition claims. */
function headingAliasTargets(
  source: string,
  mask: string,
  contentStart: (line: string) => number,
  accepted: AcceptedDefinitions | undefined,
  definitions: ReadonlyMap<string, ReferenceDefinition>,
  actualHeadingTargets: ReadonlyMap<string, string>,
): Map<string, string> {
  const headingTargets = new Map<string, string>()
  const targets = new Map<string, string>()
  djotImportLosses(source, djotTableRows(source, mask), contentStart, [], accepted ?? new Map(), targets)
  for (const [key, target] of targets)
    if ((key.includes('\0U\0') || key.includes('�')) && target.startsWith('#') && !definitions.has(key)) {
      const actual = actualHeadingTargets.get(key.replaceAll('\0U\0', '\0'))
      if (actual !== undefined) headingTargets.set(key, actual)
    }
  return headingTargets
}

function lineRows(lines: readonly string[], length: number): Uint32Array {
  const rowAt = new Uint32Array(length + 1)
  let offset = 0
  for (const [n, line] of lines.entries()) {
    rowAt.fill(n, offset, offset + line.length + 1)
    offset += line.length + 1
  }
  return rowAt
}

interface BracketIndex {
  escaped: Uint8Array
  closers: Map<number, number>
  nextCloser: Int32Array
  nextPipe: Int32Array | undefined
}

interface ReferenceScan {
  source: string
  maskText: string
  pipeMaskText: string
  tableRows: readonly boolean[]
  rowAt: Uint32Array
  boundaries: readonly number[]
}

function isTablePipe(scan: ReferenceScan, escaped: Uint8Array, at: number): boolean {
  return !!scan.tableRows[scan.rowAt[at]!] && scan.source[at] === '|' && scan.pipeMaskText[at] === '|' && !escaped[at]
}

function indexBrackets(scan: ReferenceScan): BracketIndex {
  const { source, maskText } = scan
  const boundarySet = new Set(scan.boundaries)
  const escaped = new Uint8Array(source.length)
  const closers = new Map<number, number>()
  const brackets: number[] = []
  let slashes = 0
  for (let at = 0; at < source.length; at++) {
    if (boundarySet.has(at)) brackets.length = 0
    escaped[at] = slashes % 2
    slashes = source[at] === '\\' ? slashes + 1 : 0
    if (isTablePipe(scan, escaped, at)) brackets.length = 0
    if (maskText[at] !== source[at] || escaped[at]) continue
    if (source[at] === '[') brackets.push(at)
    else if (source[at] === ']') {
      const open = brackets.pop()
      if (open !== undefined) closers.set(open, at)
    }
  }
  const nextCloser = new Int32Array(source.length + 1).fill(-1)
  const nextPipe = source.includes('|') ? new Int32Array(source.length + 1).fill(-1) : undefined
  let pipe = -1, next = -1
  for (let at = source.length - 1; at >= 0; at--) {
    if (source[at] === '[' && maskText[at] === '[' && !escaped[at]) next = -1
    else if (source[at] === ']' && !escaped[at]) next = at
    nextCloser[at] = next
    if (nextPipe) {
      if (isTablePipe(scan, escaped, at)) pipe = at
      nextPipe[at] = pipe
    }
  }
  return { escaped, closers, nextCloser, nextPipe }
}

/** Collapsed label text, sharing one value across `[[x][y]][z]` wrappers when scanning nested aliases. */
function aliasLabelReader(
  scan: ReferenceScan,
  index: BracketIndex,
  quoteDepths: readonly number[],
  scanNestedAliases: boolean,
  collapsedReferenceText: CollapsedReferenceText,
): (open: number, close: number) => string {
  const { source, rowAt } = scan
  const { escaped, closers, nextCloser } = index
  const wrapperText = new Map<number, string>()
  return (open: number, close: number): string => {
    if (!scanNestedAliases || rowAt[open] !== rowAt[close])
      return collapsedReferenceText(source.slice(open + 1, close), quoteDepths[rowAt[open]!]!, source[open - 1] === '!' && !escaped[open - 1])
    const wrappers: number[] = []
    let current = open, end = close
    while (!wrapperText.has(current)) {
      wrappers.push(current)
      const child = source[current + 1] === '!' ? current + 2 : current + 1
      const childClose = closers.get(child)
      if (source[child] !== '[' || escaped[child] || childClose === undefined || source[childClose + 1] !== '[' || nextCloser[childClose + 2] !== end - 1 || source[child + 1] === '^') {
        wrapperText.set(current, collapsedReferenceText(source.slice(current + 1, end), quoteDepths[rowAt[current]!]!, source[current - 1] === '!' && !escaped[current - 1]))
        break
      }
      current = child
      end = childClose
    }
    const value = wrapperText.get(current)!
    for (const wrapper of wrappers) wrapperText.set(wrapper, value)
    return value
  }
}

function trailingReferenceAttributes(source: string, end: number): { end: number; own: string } {
  let own = ''
  while (source[end] === '{') {
    const attrs = readAttributes(source, end)
    if (!attrs) break
    own += source.slice(end, attrs.end)
    end = attrs.end
  }
  return { end, own }
}

/** Find the full reference `[label][key]` opening at `open`, or undefined. */
function readReferenceUse(
  scan: ReferenceScan,
  index: BracketIndex,
  open: number,
  boundary: number | undefined,
  aliasLabelText: (open: number, close: number) => string,
): { use: ReferenceUse; close: number; explicit: string } | undefined {
  const { source, maskText } = scan
  const { escaped, closers, nextCloser, nextPipe } = index
  if (source[open] !== '[' || maskText[open] !== '[' || escaped[open]) return undefined
  const close = closers.get(open)
  if (close === undefined || source[close + 1] !== '[') return undefined
  const labelEnd = nextCloser[close + 2]!
  if (labelEnd < 0 || (nextPipe && nextPipe[open]! >= 0 && nextPipe[open]! < labelEnd)) return undefined
  if (boundary !== undefined && labelEnd >= boundary) return undefined
  const at = source[open - 1] === '!' && !escaped[open - 1] ? open - 1 : open
  const content = source.slice(open + 1, close),
    explicit = source.slice(close + 2, labelEnd)
  if (content.startsWith('^') && content.length > 1) return undefined
  const key = explicit ? referenceKey(explicit) : definitionKey(
    aliasLabelText(open, close),
  )
  const { end, own } = trailingReferenceAttributes(source, labelEnd + 1)
  const use: ReferenceUse = {
    at,
    end,
    key,
    rawKey: (explicit || content).includes('\\') ? definitionKey(explicit || content) : key,
    label: source.slice(at, close + 1),
    own,
    ownSlots: referenceAttributeSlots(own),
    formatted: !explicit && /[_*`{^~"']/.test(content),
  }
  return { use, close, explicit }
}

function collectReferenceUses(
  scan: ReferenceScan,
  references: ReferenceUse[][],
  definitionLines: ReadonlySet<number>,
  definitions: ReadonlyMap<string, ReferenceDefinition>,
  nativeDefinitions: ReadonlyMap<string, unknown>,
  scanNestedAliases: boolean,
  aliasLabelText: (open: number, close: number) => string,
  index: BracketIndex,
): void {
  const { source, rowAt, boundaries } = scan
  const referenceLabels = new Set<number>()
  let boundaryIndex = 0
  for (let open = 0; open < source.length; open++) {
    while (boundaryIndex < boundaries.length && boundaries[boundaryIndex]! <= open) boundaryIndex++
    const n = rowAt[open]!
    if (definitionLines.has(n)) continue
    if (referenceLabels.has(open)) continue
    const found = readReferenceUse(scan, index, open, boundaries[boundaryIndex], aliasLabelText)
    if (!found) continue
    const { use, close, explicit } = found
    references[n]!.push(use)
    referenceLabels.add(close + 1)
    if (!scanNestedAliases || !nativeDefinitions.has(use.key) || explicit && !definitions.has(use.key)) open = use.end - 1
  }
}

/** Remove definition attributes that every use overrides; return per-key override counts. */
function pruneSharedOverrides(
  definitions: ReadonlyMap<string, ReferenceDefinition>,
  references: readonly ReferenceUse[][],
): Map<string, Map<string, number>> {
  const useCounts = new Map<string, number>()
  const overrideCounts = new Map<string, Map<string, number>>()
  for (const uses of references) for (const use of uses) {
    if (!definitions.get(use.key)?.target) continue
    useCounts.set(use.key, (useCounts.get(use.key) ?? 0) + 1)
    let counts = overrideCounts.get(use.key)
    if (!counts) overrideCounts.set(use.key, counts = new Map())
    for (const key of use.ownSlots.keys()) counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  for (const [key, definition] of definitions) {
    for (const [attribute, count] of overrideCounts.get(key) ?? [])
      if (count === useCounts.get(key)) definition.slots.delete(attribute)
  }
  return overrideCounts
}

function aliasAllocator(occupied: Set<string>): () => string {
  let serial = 0
  return (): string => {
    let alias: string
    do { alias = `carve-djot-reference-${++serial}` } while (occupied.has(alias))
    occupied.add(alias)
    return alias
  }
}

/** Alias every definition whose label Carve cannot spell as a key. */
function unspellableKeyAliases(
  source: string,
  definitions: ReadonlyMap<string, ReferenceDefinition>,
  references: readonly ReferenceUse[][],
  aliasNulKeys: boolean,
  nextAlias: () => string,
): Map<string, string> {
  const aliases = new Map<string, string>()
  if (!(source.includes('\\') || source.includes('|') || source.includes('[') || source.includes('\0'))) return aliases
  const aliasKeys = new Set([...definitions.keys()].filter(key => key.startsWith('^') || key.includes('\\') || key.includes('|') || key.includes('[') || key.includes('`') || key.includes('\0') || aliasNulKeys && key.includes('�')))
  for (const uses of references) for (const use of uses)
    if (use.rawKey !== use.key && definitions.has(use.key)) aliasKeys.add(use.key)
  if (aliasKeys.size) {
    for (const key of definitions.keys()) {
      if (!aliasKeys.has(key)) continue
      aliases.set(key, nextAlias())
    }
  }
  return aliases
}

/** Escape a reference no definition or heading resolves, so Carve reads it literally. */
function literalReferenceEdits(source: string, use: ReferenceUse, quoteDepth: number, edits: Array<[number, number, string]>): void {
  const at = use.at + (use.label.startsWith('!') ? 1 : 0)
  edits.push([at, at, '\\'])
  const referenceAt = use.at + use.label.length
  edits.push([referenceAt, referenceAt, '\\'])
  let attributeAt = use.end - use.own.length
  while (attributeAt < use.end) {
    const attributes = readAttributes(source, attributeAt)
    if (!attributes) break
    const literal = referenceAttributeSlots(attributes.source).size
      ? literalReferenceAttributes(source.slice(attributeAt, attributes.end), quoteDepth)
      : ''
    edits.push([attributeAt, attributes.end, literal])
    attributeAt = attributes.end
  }
}

function rewriteReferenceAliases(
  ref: ReferenceLines,
  scan: DefinitionScan,
  references: readonly ReferenceUse[][],
  aliases: ReadonlyMap<string, string>,
  headingTargets: ReadonlyMap<string, string>,
  actualHeadingTargets: ReadonlyMap<string, string> | undefined,
  quoteDepths: readonly number[],
): string {
  const { source, lines, offsets, contentStart } = ref
  const { definitions } = scan
  const edits: Array<[number, number, string]> = []
  for (const n of scan.definitionLines) {
    const start = contentStart(lines[n]!)
    const definition = /^\[([^\]\n]+)\]:/.exec(lines[n]!.slice(start))!
    const alias = aliases.get(definitionKey(definition[1]!))
    if (alias) edits.push([offsets[n]! + start + 1, offsets[n]! + start + 1 + definition[1]!.length, alias])
  }
  for (const [n, uses] of references.entries()) for (const use of uses) {
    const headingTarget = headingTargets.get(use.key)
    if (actualHeadingTargets && !definitions.has(use.key) && headingTarget === undefined &&
        (use.key.includes('\0U\0') || use.key.includes('�')) &&
        !actualHeadingTargets.has(use.key.replaceAll('\0U\0', '\0'))) {
      literalReferenceEdits(source, use, quoteDepths[n]!, edits)
    } else if (headingTarget !== undefined) {
      const target = headingTarget.replace(/[\\()]/g, char => '\\' + char)
      edits.push([use.at + use.label.length, use.end - use.own.length, '(' + target + ')'])
    } else {
      const alias = aliases.get(use.key)
      if (alias) edits.push([use.at + use.label.length + 1, use.end - use.own.length - 1, alias])
    }
  }
  edits.sort((a, b) => a[0] - b[0])
  const parts: string[] = []
  let cursor = 0
  for (const [start, end, value] of edits) { parts.push(source.slice(cursor, start), value); cursor = end }
  return parts.join('') + source.slice(cursor)
}

interface DefinitionMoves {
  movedDefinitions: string[]
  renamedLines: Map<number, string>
  classAliases: Map<string, string>
}

/** Move definitions out of containers and alias class overrides; rename the source lines left behind. */
function relocateDefinitions(
  ref: ReferenceLines,
  scan: DefinitionScan,
  aliases: Map<string, string>,
  overrideCounts: ReadonlyMap<string, ReadonlyMap<string, number>>,
  nextAlias: () => string,
): DefinitionMoves {
  const { lines, contentStart } = ref
  const { definitions } = scan
  const movedDefinitions: string[] = []
  const liftedAttributes = new Set<string>()
  for (const [key, definition] of definitions) {
    const line = lines[definition.line]!, start = contentStart(line)
    if (!definition.target || !definition.slots.size || !start || /^\s*$/.test(line.slice(0, start))) continue
    const alias = aliases.get(key) ?? nextAlias()
    aliases.set(key, alias)
    liftedAttributes.add(key)
    movedDefinitions.push(`[${alias}]: ${definition.target} ${mergedReferenceAttrs(definition.slots, '')}`)
  }
  const classAliases = new Map<string, string>()
  for (const [key, definition] of definitions) {
    if (!definition.target || !definition.slots.has('class') || !overrideCounts.get(key)?.has('class')) continue
    const alias = nextAlias()
    classAliases.set(key, alias)
    const slots = new Map(definition.slots)
    slots.delete('class')
    const attrs = mergedReferenceAttrs(slots, '')
    movedDefinitions.push(`[${alias}]: ${definition.target}${attrs ? ' ' + attrs : ''}`)
  }
  const renamedLines = renameDefinitionLines(ref, scan, aliases, liftedAttributes, movedDefinitions)
  return { movedDefinitions, renamedLines, classAliases }
}

function renameDefinitionLines(
  { lines, contentStart }: ReferenceLines,
  { definitions, definitionLines }: DefinitionScan,
  aliases: ReadonlyMap<string, string>,
  liftedAttributes: ReadonlySet<string>,
  movedDefinitions: string[],
): Map<number, string> {
  const renamedLines = new Map<number, string>()
  for (const n of definitionLines) {
    const line = lines[n]!, start = contentStart(line)
    const definition = /^\[([^\]\n]+)\]:/.exec(line.slice(start))
    if (!definition) continue
    const key = definitionKey(definition[1]!), alias = aliases.get(key)
    const close = line.indexOf(']:', start), prefix = line.slice(0, start)
    if (definitions.get(key)!.line !== n) {
      renamedLines.set(n, prefix + '{%%}')
      continue
    }
    if (liftedAttributes.has(key)) continue
    const attrs = definitions.get(key)!.target ? mergedReferenceAttrs(definitions.get(key)!.slots, '') : ''
    const target = '[' + (alias ?? definition[1]!) + line.slice(close) + (attrs ? ' ' + attrs : '')
    if (start > 0 && /^\s*$/.test(prefix)) {
      renamedLines.set(n, prefix + '{%%}')
      movedDefinitions.push(target)
    } else if (alias || attrs) {
      const first = definitions.get(key)!.first
      const before = lines[first - 1] ?? ''
      const separate = prefix === '' && attrs !== '' && before.slice(contentStart(before)).trim() !== '' && !definitionLines.has(first - 1)
      renamedLines.set(n, (separate ? '\n' : '') + prefix + target)
    }
  }
  return renamedLines
}

/** Replacement text for one use, or undefined when it stays as written. */
function referenceUseText(
  definition: ReferenceDefinition,
  use: ReferenceUse,
  name: string,
  caretOnly: boolean,
  aliased: boolean,
  table: boolean,
): string | undefined {
  if (caretOnly) return `${use.label}[${name}]${use.own}`
  if (!definition.attrs) {
    if (!(aliased || use.formatted || definition.target && use.own)) return undefined
    let attrs = definition.target ? mergedReferenceAttrs(use.ownSlots, '') : use.own
    if (table) attrs = attrs.replace(/\\*\|/g, (value) => (value.length % 2 ? '\\' + value : value))
    return `${use.label}[${name}]${attrs}`
  }
  let attrs = definition.target
    ? mergedReferenceAttrs(use.ownSlots, '')
    : mergedReferenceAttrs(definition.slots, use.own)
  if (table)
    attrs = attrs.replace(/\\*\|/g, (value) => (value.length % 2 ? '\\' + value : value))
  return `${use.label}[${name}]${attrs}`
}

function layoutEdits(
  ref: ReferenceLines,
  scan: DefinitionScan,
  references: readonly ReferenceUse[][],
  aliases: ReadonlyMap<string, string>,
  moves: DefinitionMoves,
  caretOnly: boolean,
): { at: number; end: number; text: string }[] {
  const { lines, offsets, contentStart } = ref
  const edits: { at: number; end: number; text: string }[] = []
  for (const [n, line] of lines.entries()) {
    const start = contentStart(line), at = offsets[n]!
    if (scan.removed.has(n)) {
      edits.push({ at, end: at + line.length + (start === 0 && n + 1 < lines.length ? 1 : 0), text: start > 0 ? line.slice(0, start) + '{%%}' : '' })
      continue
    }
    if (moves.renamedLines.has(n)) edits.push({ at, end: at + line.length, text: moves.renamedLines.get(n)! })
    const table = line.slice(start).startsWith('|')
    for (const use of references[n]!) {
      const definition = scan.definitions.get(use.key)
      if (!definition) continue
      const name = (use.ownSlots.has('class') ? moves.classAliases.get(use.key) : undefined)
        ?? aliases.get(use.key) ?? use.key
      const text = referenceUseText(definition, use, name, caretOnly, aliases.has(use.key), table)
      if (text !== undefined) edits.push({ at: use.at, end: use.end, text })
    }
  }
  return edits
}

function applyLayoutEdits(source: string, edits: readonly { at: number; end: number; text: string }[], trimBlankEdges: boolean): string {
  let body = '', copied = 0
  for (const edit of edits) {
    if (edit.at < copied) continue
    body += source.slice(copied, edit.at) + edit.text
    copied = edit.end
  }
  body += source.slice(copied)
  if (trimBlankEdges) {
    let start = 0, end = body.length
    while (body[start] === '\n') start++
    while (end > start && body[end - 1] === '\n') end--
    body = body.slice(start, end) + (end < body.length ? '\n' : '')
  }
  return body
}

/** Normalize reference labels and share definition attributes. */
export function djotReferenceLayout(source: string, contentStart: (line: string) => number, caretOnly = false, accepted?: ReadonlyMap<number, { label: string; target: string; end: number }>, imageChildText = false, aliasesOnly = false, actualHeadingTargets?: ReadonlyMap<string, string>): string {
  let mask: string
  if (!caretOnly && !aliasesOnly) ({ source, mask } = foldReferenceLabels(source, contentStart, imageChildText))
  else mask = referenceMask(source)
  const collapsedReferenceText = djotCollapsedReferenceCache()
  const ref = readReferenceLines(source, contentStart)
  const { lines } = ref
  const definitionMask = referenceMask(source).split('\n')
  const pipeMask = source.includes('|') ? maskDjotCodeAndDestinations(source, false, true, false, undefined, [], { destinations: false, autolinks: false, attributeValues: false, comments: false }).split('\n') : []
  const tableRows = source.includes('|') ? djotTableRows(source, pipeMask.join('\n')) : []
  const scan = collectReferenceDefinitions(ref, definitionMask, caretOnly, aliasesOnly, accepted)
  const { definitions } = scan
  const headingTargets = aliasesOnly && actualHeadingTargets && source.includes('\0U\0') && source.includes('#')
    ? headingAliasTargets(source, mask, contentStart, accepted, definitions, actualHeadingTargets)
    : new Map<string, string>()
  if (!definitions.size && !headingTargets.size && !actualHeadingTargets?.size) return source
  const hasSourceNuls = source.includes('\0U\0')
  const scanNestedAliases = aliasesOnly && hasSourceNuls && [...definitions.keys()].some(key => key.includes('�'))
  let nativeDefinitions: ReadonlyMap<string, unknown> = definitions
  if (scanNestedAliases && source.includes('#')) {
    const targets = new Map<string, string>()
    djotImportLosses(source, djotTableRows(source, mask), contentStart, [], accepted ?? new Map(), targets)
    nativeDefinitions = targets
  }
  const references = lines.map((): ReferenceUse[] => [])
  const quoteDepths = lines.map(line => (line.slice(0, contentStart(line)).match(/>/g) ?? []).length)
  if (source.includes('][')) {
    if (quoteDepths.some(depth => depth > 0))
      djotBlockLayout(source, djotTableRows(source, mask), undefined, undefined, undefined, undefined, (line, depth) => { quoteDepths[line] = depth })
    const maskText = definitionMask.join('\n')
    const referenceScan: ReferenceScan = {
      source,
      maskText,
      pipeMaskText: pipeMask.join('\n'),
      tableRows,
      rowAt: lineRows(lines, source.length),
      boundaries: djotInlineBoundaries(source, maskText),
    }
    const index = indexBrackets(referenceScan)
    const aliasLabelText = aliasLabelReader(referenceScan, index, quoteDepths, scanNestedAliases, collapsedReferenceText)
    collectReferenceUses(referenceScan, references, scan.definitionLines, definitions, nativeDefinitions, scanNestedAliases, aliasLabelText, index)
  }
  const overrideCounts = pruneSharedOverrides(definitions, references)
  const occupied = new Set(definitions.keys())
  if (caretOnly) for (const decision of accepted?.values() ?? []) occupied.add(definitionKey(decision.label))
  for (const uses of references) for (const use of uses) occupied.add(use.key)
  const nextAlias = aliasAllocator(occupied)
  const aliases = unspellableKeyAliases(source, definitions, references, aliasesOnly && hasSourceNuls, nextAlias)
  if (aliasesOnly) return rewriteReferenceAliases(ref, scan, references, aliases, headingTargets, actualHeadingTargets, quoteDepths)
  const moves = relocateDefinitions(ref, scan, aliases, overrideCounts, nextAlias)
  const body = applyLayoutEdits(source, layoutEdits(ref, scan, references, aliases, moves, caretOnly), scan.removed.size > 0)
  return moves.movedDefinitions.length ? moves.movedDefinitions.join('\n') + '\n\n' + body : body
}

function referenceAttributeSlots(source: string): Map<string, string[]> {
  const result = new Map<string, string[]>()
  for (let at = 0; at < source.length;) {
    const attrs = readAttributes(source, at)
    if (!attrs) break
    const group = new Map<string, string[]>()
    for (const token of attrs.tokens) {
      if (token.append) {
        const values = group.get(token.key)
        if (values) {
          if (token.key === 'class' && values.length === 1 && values[0] === 'class=""') values.length = 0
          values.push(token.source)
        } else group.set(token.key, [token.source])
      } else group.set(token.key, [token.source])
    }
    for (const [key, values] of group) {
      const previous = result.get(key)
      if (key === 'class' && previous && !(previous.length === 1 && previous[0] === 'class=""')) {
        for (const value of values) previous.push(value)
      } else result.set(key, values)
    }
    at = attrs.end
  }
  return result
}

function mergedReferenceAttrs(base: ReadonlyMap<string, string[]>, own: string): string {
  const merged = new Map(base)
  for (const [key, value] of referenceAttributeSlots(own)) merged.set(key, value)
  const values = [...merged].flatMap(([key, tokens]) => {
    if (key !== 'class') return tokens
    const classes = (parseAttrs(tokens.join(' ')).classes ?? []).join(' ')
    return [`class="${classes.replace(/[\\"]/g, char => '\\' + char)}"`]
  }).join(' ')
  return values ? `{${values}}` : ''
}
