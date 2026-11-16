// The tree facts a `roundtrip` render does not write, each by the clause that drops it. The harness applies them to the
// parsed tree before it compares, so a difference that remains is a defect of the importer or of the renderer.
import { isUrlAllowed, type DocumentNode, type IncludeNode } from '../../v2/src/index.ts'
import { includeSource } from '../../v2/src/include.ts'
import { keyValue } from '../../v2/src/html-attributes.ts'
import { DROPPED_NAMES, DROPPED_PREFIXES } from '../../v2/src/render-tables.ts'

type Fields = Record<string, unknown>
type Loss = (node: Fields, list: Fields[], at: number, found: Set<string>) => Fields[] | undefined

function isFields(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function text(value: string): Fields { return { type: 'text', value } }

const INVISIBLE = ['comment', 'frontmatter', 'citation_definition']
const BIDI = new Set([0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069])

const ALLOWED_CONTROLS = [9, 10, 12, 13]

function isNoncharacter(code: number): boolean {
  return (code >= 127 && code <= 159) || (code >= 0xfdd0 && code <= 0xfdef) || code === 0xfffe || code === 0xffff
}

function surrogateWidth(value: string, at: number, code: number): number {
  if (code >= 0xdc00) {
    const before = value.charCodeAt(at - 1)
    return before >= 0xd800 && before <= 0xdbff ? 0 : 1
  }
  const next = value.charCodeAt(at + 1)
  if (!(next >= 0xdc00 && next <= 0xdfff)) return 1
  return (code & 0x3f) === 0x3f && (next === 0xdffe || next === 0xdfff) ? 2 : 0
}

function invalidWidth(value: string, at: number): number {
  const code = value.charCodeAt(at)
  if (code < 32) return ALLOWED_CONTROLS.includes(code) ? 0 : 1
  if (isNoncharacter(code)) return 1
  return code >= 0xd800 && code <= 0xdfff ? surrogateWidth(value, at, code) : 0
}

/** C2-H-176: characters HTML rejects become U+FFFD; C2-H-172: bidirectional controls are not written between tags. */
export function htmlText(value: string, bidi: boolean): string {
  let out = ''
  for (let at = 0; at < value.length; at++) {
    const width = invalidWidth(value, at)
    if (width > 0) { out += '\ufffd'; at += width - 1 }
    else if (!(bidi && BIDI.has(value.charCodeAt(at)))) out += value[at] ?? ''
  }
  return out
}

function isBreak(node: Fields | undefined): boolean {
  return node?.['type'] === 'soft_break' || node?.['type'] === 'hard_break'
}

function blankText(node: Fields): boolean {
  if (node['type'] !== 'text') return false
  for (const char of str(node['value'])) if (char !== ' ' && char !== '\t') return false
  return true
}

function commentOnlyLine(nodes: Fields[], from: number, step: number, atEnd: boolean, nested: boolean): boolean {
  let comment = false
  for (let at = from; at >= 0 && at < nodes.length; at += step) {
    const node = nodes[at]
    if (node === undefined) break
    if (node['type'] === 'comment') comment = true
    else if (isBreak(node)) return comment && !atEnd
    else if (!blankText(node)) return false
  }
  return comment && !nested
}

/** C2-H-069: the comments of an inline list, and the line break a comment-only line takes with it. */
function withoutComments(nodes: Fields[], nested: boolean, found: Set<string>): Fields[] {
  if (!nodes.some(node => node['type'] === 'comment')) return nodes
  found.add('C2-H-069 comment')
  return nodes.filter((node, at) => node['type'] !== 'comment' && !(isBreak(node) &&
    (commentOnlyLine(nodes, at - 1, -1, false, nested) || commentOnlyLine(nodes, at + 1, 1, true, nested))))
}

function refLabel(node: Fields): string {
  const form = node['refForm']
  return form === 'shortcut' ? '' : form === 'collapsed' ? '[]' : `[${str(node['key'])}]`
}

function attributeText(node: Fields): string {
  const attrs = isFields(node['attrs']) ? node['attrs'] : {}
  const parts: string[] = []
  if (typeof attrs['id'] === 'string') parts.push(`#${attrs['id']}`)
  for (const name of Array.isArray(attrs['classes']) ? attrs['classes'] : []) parts.push(`.${str(name)}`)
  if (typeof node['lang'] === 'string') parts.push(`:${node['lang']}`)
  for (const pair of Array.isArray(attrs['keyValues']) ? attrs['keyValues'] : []) {
    const [key, value] = Array.isArray(pair) ? pair.map(str) : ['', '']
    const plain = !/[\s"'\\|}]/u.test(value ?? '')
    parts.push(value === '' ? str(key) : plain ? `${str(key)}=${value ?? ''}`
      : `${str(key)}="${(value ?? '').replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`)
  }
  return parts.length === 0 ? '' : `{${parts.join(' ')}}`
}

function children(node: Fields): Fields[] {
  const list = node['children']
  return Array.isArray(list) ? list.filter(isFields) : []
}

/** C2-H-085, C2-H-086: an unresolved reference, footnote reference or cross-reference is its text. */
const unresolved: Loss = (node, _list, _at, found) => {
  const type = node['type']
  if ((type === 'link' || type === 'image') && node['key'] !== undefined && node[type === 'link' ? 'href' : 'src'] === undefined) {
    found.add('C2-H-085 unresolved reference')
    const label = text(`]${refLabel(node)}${attributeText(node)}`)
    return type === 'link' ? [text('['), ...children(node), label] : [text(`![${str(node['alt'])}`), label]
  }
  if (type === 'footnote_ref' && node['number'] === undefined) {
    found.add('C2-H-086 unresolved footnote reference')
    return [text(`[^${str(node['key'])}]`)]
  }
  if (type === 'xref' && node['href'] === undefined) {
    found.add('C2-H-086 unresolved cross-reference')
    return [text(`</#${str(node['key'])}>`)]
  }
  return undefined
}

function hasAttrs(node: Fields): boolean {
  return node['attrs'] !== undefined || node['lang'] !== undefined
}

/** Nodes a render writes as text: C2-H-078, C2-H-049, C2-H-101, C2-A-119, C2-H-098. */
const asText: Loss = (node, _list, _at, found) => {
  if (node['type'] === 'raw_inline' && node['format'] !== 'html') {
    found.add('C2-H-054 raw format dropped')
    return []
  }
  switch (node['type']) {
    case 'smart_punctuation': found.add('C2-H-078 smart punctuation'); return [text(str(node['glyph'] ?? node['source']))]
    case 'literal_inline': found.add('C2-H-049 literal text')
      return hasAttrs(node) ? [{ type: 'span', children: [text(str(node['value']))], ...attrsOf(node) }] : [text(str(node['value']))]
    case 'symbol': found.add('C2-H-101 symbol')
      return hasAttrs(node) ? [{ type: 'span', children: [text(`:${str(node['name'])}:`)], ...attrsOf(node) }]
        : [text(`:${str(node['name'])}:`)]
    case 'citation_group': found.add('C2-A-119 citation'); return [text(str(node['raw']))]
    case 'abbreviation': if (node['expansion'] !== undefined) return undefined
      found.add('C2-H-098 abbreviation without expansion'); return [text(str(node['key']))]
    default: return undefined
  }
}

function attrsOf(node: Fields): Fields {
  const result: Fields = {}
  if (node['attrs'] !== undefined) result['attrs'] = node['attrs']
  if (node['lang'] !== undefined) result['lang'] = node['lang']
  return result
}

/** G1: the HTML input stream reads a carriage return in a destination as a line feed too. */
const destinations: Loss = (node, _list, _at, found) => {
  if (node['type'] !== 'link' && node['type'] !== 'image') return undefined
  const name = node['type'] === 'link' ? 'href' : 'src'
  const value = node[name]
  if (typeof value !== 'string' || !value.includes('\r')) return undefined
  found.add('G1 carriage return')
  return [{ ...node, [name]: value.replaceAll('\r\n', '\n').replaceAll('\r', '\n') }]
}

/** C2-H-176, C2-H-172: the characters of text and code; C2-H-114 carrier text keeps its bidirectional controls. */
const characters: Loss = (node, _list, _at, found) => {
  const type = node['type']
  if (type !== 'text' && type !== 'code' && type !== 'critic_comment' && type !== 'math') return undefined
  const value = str(node['value'])
  let written = type === 'math' ? value : htmlText(value, true)
  if (written !== value) found.add('C2-H-176 C2-H-172 characters')
  if (written === '' && type === 'text') return []
  const feed = type === 'text' && written.includes('\n')
  if (!written.includes('\r') && !feed) return written === value ? undefined : [{ ...node, value: written }]
  // The HTML input stream reads a carriage return as a line feed (_SPEC_GAPS.md G1).
  if (written.includes('\r')) found.add('G1 carriage return')
  // A text value that holds a line feed, as a CSV cell can, reads back as a soft break (_SPEC_GAPS.md G7).
  if (feed) found.add('G7 line feed in text')
  return lineEnds(node, written.replaceAll('\r\n', '\n').replaceAll('\r', '\n'))
}

/** A value whose line endings HTML reads back: as they stand in code and math, as soft breaks in text. */
function lineEnds(node: Fields, written: string): Fields[] {
  if (node['type'] !== 'text') return [{ ...node, value: written }]
  const lines = written.split('\n')
  // C2-I-002, C2-I-103: the importer reads the spaces and tabs around a line ending as part of it.
  const parts = lines.map((line, at) => at === 0 ? line : line.replace(/^[ \t]+/u, ''))
    .map((line, at) => at === lines.length - 1 ? line : line.replace(/[ \t]+$/u, ''))
    .flatMap((part, at) => [...(at > 0 ? [{ type: 'soft_break' }] : []), ...(part === '' ? [] : [text(part)])])
  // The importer reads a run of line endings as one soft break.
  return parts.filter((part, at) => part['type'] !== 'soft_break' || parts[at - 1]?.['type'] !== 'soft_break')
}

/** Applies the first loss that fires on `list[at]`, and the losses behind it to what that loss gave. */
function applyLosses(list: Fields[], at: number, losses: Loss[], all: Loss[], found: Set<string>): Fields[] {
  const node = list[at]
  if (node === undefined) return []
  for (const [index, loss] of losses.entries()) {
    const replaced = loss(node, list, at, found)
    if (replaced === undefined) continue
    const rest = losses.slice(index + 1)
    // What a loss gave is new, so every loss applies to it; the losses behind this one apply to its own node again.
    return replaced.flatMap((entry, position) => entry === node ? [entry]
      : applyLosses(replaced, position, entry['type'] === node['type'] ? rest : all, all, found))
  }
  return [walk(node, all, found)]
}

function walkList(list: Fields[], losses: Loss[], found: Set<string>): Fields[] {
  return list.flatMap((_, at) => applyLosses(list, at, losses, losses, found))
}

function walk(node: Fields, losses: Loss[], found: Set<string>): Fields {
  const result: Fields = { ...node }
  for (const [name, value] of Object.entries(node)) {
    if (Array.isArray(value) && value.every(isFields)) {
      const inline = ['children', 'title', 'base', 'annotation', 'prefix', 'suffix', 'short'].includes(name)
      const kept = value.filter(entry => !INVISIBLE.includes(str(entry['type'])) || inlineComment(entry, inline))
      if (kept.length !== value.length) found.add('C2-H-019 C2-H-070 invisible block')
      const lines = inline ? withoutComments(kept, node['type'] !== 'paragraph', found) : kept
      result[name] = walkList(lines, losses, found)
    } else if (isFields(value) && typeof value['type'] === 'string') result[name] = walk(value, losses, found)
  }
  return result
}

function inlineComment(entry: Fields, inline: boolean): boolean {
  return inline && entry['type'] === 'comment'
}

/** C2-H-019: a paragraph that holds only comments, or nothing after them, writes nothing. */
function emptyParagraphs(node: Fields, found: Set<string>): Fields {
  const result: Fields = { ...node }
  for (const [name, value] of Object.entries(node)) {
    if (Array.isArray(value) && value.every(isFields)) {
      result[name] = value.filter(entry => {
        const drop = entry['type'] === 'paragraph' && children(entry).length === 0 && Array.isArray(entry['children'])
          && wasComments(entry)
        if (drop) found.add('C2-H-019 comment paragraph')
        return !drop
      }).map(entry => emptyParagraphs(entry, found))
    } else if (isFields(value) && typeof value['type'] === 'string') result[name] = emptyParagraphs(value, found)
  }
  return result
}

const COMMENT_ONLY = Symbol('comment-only')

function markCommentParagraphs(tree: Fields): void {
  eachNode(tree, entry => {
    if (entry['type'] === 'paragraph' && children(entry).every(child => child['type'] === 'comment')) Reflect.set(entry, COMMENT_ONLY, true)
  })
}

function wasComments(entry: Fields): boolean {
  return Reflect.get(entry, COMMENT_ONLY) === true
}

const DESTINATIONS: Readonly<Record<string, string>> = { image: 'src', link: 'href', autolink: 'href', link_reference_definition: 'href' }

/** C2-H-160: a denied destination is written as the empty string. */
function deniedDestinations(tree: Fields, found: Set<string>): void {
  eachNode(tree, entry => {
    const field = DESTINATIONS[str(entry['type'])]
    const url = field === undefined ? undefined : entry[field]
    if (field !== undefined && typeof url === 'string' && !isUrlAllowed(url)) {
      entry[field] = ''
      if (entry['type'] === 'autolink' && entry['text'] === undefined) entry['text'] = url
      found.add('C2-H-160 denied destination')
    }
    filteredStyle(entry, found)
  })
}

/** C2-H-153: the table keys a table kept in `attrs` (C2-B-227) are never written. */
const TABLE_KEYS = ['aligns', 'widths', 'header-rows', 'footer-rows']

/** C2-H-161, C2-H-162: a key the policy drops is not written, and a value that fails its test is written empty. */
function filteredStyle(node: Fields, found: Set<string>): void {
  const attrs = node['attrs']
  if (!isFields(attrs) || !Array.isArray(attrs['keyValues'])) return
  const kept: unknown[] = []
  for (const pair of attrs['keyValues']) {
    if (!Array.isArray(pair)) continue
    const name = str(pair[0]).toLowerCase()
    if (DROPPED_NAMES.includes(name) || DROPPED_PREFIXES.some(prefix => name.startsWith(prefix))) {
      found.add('C2-H-161 dropped attribute')
      continue
    }
    if (node['type'] === 'table' && TABLE_KEYS.includes(name)) {
      found.add('C2-H-153 table key')
      continue
    }
    const value = keyValue(name, str(pair[1]))
    if (value !== pair[1]) found.add('C2-H-161 C2-H-162 filtered value')
    kept.push([pair[0], value])
  }
  if (kept.length > 0) attrs['keyValues'] = kept
  else delete attrs['keyValues']
  if (Object.keys(attrs).length === 0) delete node['attrs']
}

/** C2-H-043: a line block writes its stanzas, so an empty line at either end and a run of them collapse. */
function lineBlocks(tree: Fields, found: Set<string>): void {
  eachNode(tree, node => {
    if (node['type'] !== 'line_block') return
    const lines = children(node)
    const kept = lines.filter((line, at) => children(line).length > 0 || (at > 0 && children(lines[at - 1] ?? {}).length > 0 &&
      lines.slice(at + 1).some(next => children(next).length > 0)))
    if (kept.length === lines.length) return
    found.add('C2-H-043 empty line')
    node['children'] = kept
  })
}

/** C2-A-093: an imported span is a count; the mark cells of the source have no element. */
function spanMarks(tree: Fields, found: Set<string>): void {
  eachNode(tree, node => {
    if (node['type'] !== 'table_row') return
    const cells = children(node)
    const kept = cells.filter(cell => cell['span'] === undefined)
    if (kept.length === cells.length) return
    found.add('C2-A-093 span marks')
    node['children'] = kept
  })
}

/** C2-H-089, C2-H-093: the notes that references name stand at the end of the document, in number order. */
function footnotesAtEnd(document: Fields, found: Set<string>): void {
  const list = children(document)
  const notes = list.filter(node => node['type'] === 'footnote')
  if (notes.length === 0) return
  const order = new Map<string, number>()
  const visit = (node: Fields): void => {
    if (node['type'] === 'footnote_ref' && typeof node['number'] === 'number' && !order.has(str(node['key']))) {
      order.set(str(node['key']), node['number'])
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) for (const entry of value) { if (isFields(entry)) visit(entry) }
      else if (isFields(value)) visit(value)
    }
  }
  visit(document)
  // C2-H-089: one note per number, so a later definition of a key writes nothing.
  const placed = notes.filter((note, at) => order.has(str(note['key'])) &&
    notes.findIndex(other => other['key'] === note['key']) === at)
    .sort((a, b) => (order.get(str(a['key'])) ?? 0) - (order.get(str(b['key'])) ?? 0))
  const rest = list.filter(node => node['type'] !== 'footnote')
  const moved = [...rest, ...placed]
  if (moved.some((node, at) => node !== list[at]) || moved.length !== list.length) found.add('C2-H-093 footnote placement')
  document['children'] = moved
}

function eachNode(node: Fields, visit: (node: Fields) => void): void {
  visit(node)
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) for (const entry of value) { if (isFields(entry)) eachNode(entry, visit) }
    else if (isFields(value)) eachNode(value, visit)
  }
}

/** A note mark the render writes as a mark; an unresolved reference is text where it stands (C2-H-086). */
function isNote(node: Fields): boolean {
  return (node['type'] === 'footnote_ref' && node['number'] !== undefined) || node['type'] === 'inline_footnote'
}

/** C2-H-088: a note mark inside link text is written behind the link; C2-H-081: a link inside link text is its content. */
const linkText: Loss = (node, _list, _at, found) => {
  if (node['type'] !== 'link' || node['href'] === undefined) return undefined
  const notes: Fields[] = []
  let changed = false
  const unwrap = (list: Fields[]): Fields[] => list.flatMap(child => {
    if (isNote(child)) { notes.push(child); changed = true; return [] }
    if ((child['type'] === 'link' && child['href'] !== undefined) || child['type'] === 'autolink') {
      changed = true
      return child['type'] === 'autolink' ? [text(str(child['text'] ?? child['href']))] : unwrap(children(child))
    }
    return Array.isArray(child['children']) && child['type'] !== 'link' ? [{ ...child, children: unwrap(children(child)) }] : [child]
  })
  const inner = unwrap(children(node))
  if (!changed) return undefined
  found.add('C2-H-081 C2-H-088 link text')
  return [{ ...node, children: inner }, ...notes]
}

/** C2-H-012: a class that occurs twice is written once. */
function uniqueClasses(tree: Fields, found: Set<string>): void {
  eachNode(tree, node => {
    const attrs = node['attrs']
    if (!isFields(attrs) || !Array.isArray(attrs['classes'])) return
    const unique = [...new Set(attrs['classes'])]
    if (unique.length === attrs['classes'].length) return
    found.add('C2-H-012 repeated class')
    attrs['classes'] = unique
  })
}

function definitionsOf(tree: Fields): Map<string, Fields> {
  const map = new Map<string, Fields>()
  for (const node of children(tree)) {
    if (node['type'] === 'link_reference_definition' && !map.has(str(node['key']))) map.set(str(node['key']), node)
  }
  return map
}

/** C2-H-141: the attributes of a definition merge into each reference that resolves through it. */
function mergedDefinitions(tree: Fields, found: Set<string>): void {
  const definitions = definitionsOf(tree)
  eachNode(tree, node => {
    if ((node['type'] !== 'link' && node['type'] !== 'image') || node['key'] === undefined) return
    const definition = definitions.get(str(node['key']))
    if (definition === undefined || (definition['attrs'] === undefined && definition['lang'] === undefined)) return
    found.add('C2-H-141 definition attributes')
    const merged = mergedAttrs(isFields(node['attrs']) ? node['attrs'] : {}, isFields(definition['attrs']) ? definition['attrs'] : {})
    if (Object.keys(merged).length > 0) node['attrs'] = merged
    const lang = node['lang'] ?? definition['lang']
    if (lang !== undefined) node['lang'] = lang
  })
}

function pairs(value: unknown): unknown[] { return Array.isArray(value) ? value : [] }

/** C2-H-141: the reference decides a key; the classes of both carry, the definition's first. */
function mergedAttrs(own: Fields, from: Fields): Fields {
  const names = new Set(pairs(own['keyValues']).map(pair => Array.isArray(pair) ? str(pair[0]).toLowerCase() : ''))
  const keyValues = [...pairs(from['keyValues']).filter(pair => !(Array.isArray(pair) && names.has(str(pair[0]).toLowerCase()))),
    ...pairs(own['keyValues'])]
  const classes = [...new Set([...pairs(from['classes']), ...pairs(own['classes'])])]
  const merged: Fields = {}
  const id = own['id'] ?? from['id']
  if (id !== undefined) merged['id'] = id
  if (classes.length > 0) merged['classes'] = classes
  if (keyValues.length > 0) merged['keyValues'] = keyValues
  return merged
}

/** C2-H-133: an include that was not expanded is a paragraph of its directive; C2-H-050: a raw HTML block a code block. */
const blockForms: Loss = (node, _list, _at, found) => {
  if (node['type'] === 'include') {
    found.add('C2-H-133 include')
    // The harness reads a parsed tree, so the node has the fields of an include.
    return [{ type: 'paragraph', children: [text(includeSource(node as unknown as IncludeNode))] }]
  }
  if (node['type'] === 'raw_block' && node['format'] !== 'html') {
    found.add('C2-H-054 raw format dropped')
    return []
  }
  if (node['type'] === 'raw_block') {
    found.add('G3 raw block')
    return [{ type: 'code_block', value: node['value'], syntax: 'html', ...attrsOf(node) }]
  }
  if (node['type'] === 'paragraph' && node['role'] === 'image' && children(node).some(child => child['type'] === 'image' &&
    child['key'] !== undefined && child['src'] === undefined)) {
    found.add('C2-H-020 unresolved block image')
    const { role: _role, ...rest } = node
    return [rest]
  }
  return undefined
}

const EDGE_BLOCKS = ['paragraph', 'heading', 'cell_paragraph', 'definition_term', 'caption']

/** G1: a line feed that a carriage return became sits at a block edge, where the importer omits it. */
function edgeBreaks(tree: Fields): void {
  eachNode(tree, node => {
    if (!EDGE_BLOCKS.includes(str(node['type'])) || !Array.isArray(node['children'])) return
    const list = children(node)
    let start = 0
    let end = list.length
    while (start < end && list[start]?.['type'] === 'soft_break') start++
    while (end > start && list[end - 1]?.['type'] === 'soft_break') end--
    // The importer reads a run of line endings as one soft break, also across the nodes a line ending split.
    node['children'] = list.slice(start, end).filter((entry, at, kept) => entry['type'] !== 'soft_break' ||
      kept[at - 1]?.['type'] !== 'soft_break')
  })
}

/** C2-H-195 rows 3 and 5: a no-break space is the character, and a line ending before `<br>` is layout. */
function plainSpaces(tree: Fields, found: Set<string>): Fields {
  return walk(tree, [(node) => {
    if (node['type'] !== 'non_breaking_space') return undefined
    found.add('G2 no-break space')
    return [text('\u00a0')]
  }, (node, list, at) => {
    if (node['type'] !== 'soft_break' || list[at + 1]?.['type'] !== 'hard_break') return undefined
    found.add('G2 line ending before a hard break')
    return []
  }], found)
}

/** C2-H-195 row 7: a line break in a cell reads as a space. */
function cellBreaks(tree: Fields, found: Set<string>): void {
  eachNode(tree, node => {
    if (node['type'] === 'cell_paragraph' && flattenBreaks(node)) found.add('G2 cell line break')
  })
}

function flattenBreaks(node: Fields): boolean {
  let changed = false
  for (const name of ['children', 'base', 'annotation', 'pairs']) {
    const list = node[name]
    if (!Array.isArray(list) || node['type'] === 'citation_group') continue
    const flat: Fields[] = []
    for (const entry of list.filter(isFields)) {
      const isBreak = entry['type'] === 'soft_break' || entry['type'] === 'hard_break'
      changed = isBreak || flattenBreaks(entry) || changed
      const next = isBreak ? text(' ') : entry
      const last = flat.at(-1)
      if (last?.['type'] === 'text' && next['type'] === 'text' && last['attrs'] === undefined && next['attrs'] === undefined) {
        flat[flat.length - 1] = text(str(last['value']) + str(next['value']))
      } else flat.push(next)
    }
    node[name] = flat
  }
  return changed
}

/**
 * C2-H-019: a definition writes nothing; the importer gives back one for each key a resolved reference names, in the
 * order of the first such reference, with its destination and title, behind the blocks and before the notes.
 */
function definitionsAtEnd(tree: Fields, found: Set<string>): void {
  const list = children(tree)
  const definitions = definitionsOf(tree)
  const keys: string[] = []
  eachNode(tree, node => {
    const type = node['type']
    if ((type === 'link' || type === 'image') && node['key'] !== undefined && node[type === 'link' ? 'href' : 'src'] !== undefined &&
      !keys.includes(str(node['key']))) keys.push(str(node['key']))
  })
  const rebuilt = keys.flatMap(key => {
    const definition = definitions.get(key)
    if (definition === undefined) return []
    const result: Fields = { type: 'link_reference_definition', key, namespace: 'link', href: definition['href'] }
    if (definition['tooltip'] !== undefined) result['tooltip'] = definition['tooltip']
    return [result]
  })
  const blocks = list.filter(node => node['type'] !== 'link_reference_definition' && node['type'] !== 'footnote')
  const notes = list.filter(node => node['type'] === 'footnote')
  const next = [...blocks, ...rebuilt, ...notes]
  if (JSON.stringify(next) !== JSON.stringify(list)) found.add('C2-H-019 definition placement')
  tree['children'] = next
}

/** The parsed tree as a `roundtrip` render and an import give it back (C2-H-195, C2-H-197), and the clauses that changed it. */
export function project(document: DocumentNode): { tree: DocumentNode, losses: string[] } {
  const found = new Set<string>()
  const copy: unknown = structuredClone(document)
  if (!isFields(copy)) return { tree: document, losses: [] }
  markCommentParagraphs(copy)
  mergedDefinitions(copy, found)
  let tree = walk(copy, [unresolved, asText, characters, destinations, linkText, blockForms], found)
  tree = emptyParagraphs(tree, found)
  if (['G1 carriage return', 'G7 line feed in text', 'C2-H-176 C2-H-172 characters'].some(loss => found.has(loss))) edgeBreaks(tree)
  tree = plainSpaces(tree, found)
  cellBreaks(tree, found)
  uniqueClasses(tree, found)
  lineBlocks(tree, found)
  spanMarks(tree, found)
  deniedDestinations(tree, found)
  footnotesAtEnd(tree, found)
  definitionsAtEnd(tree, found)
  // The projection keeps the node shapes of the input, so the result is a document again.
  return { tree: tree as unknown as DocumentNode, losses: [...found].sort() }
}
