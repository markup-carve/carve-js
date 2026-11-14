// The reader side of contract 2.0 (C2-A-167 to C2-A-171): a tree that the tree document refuses
// fails with a typed error that names what was wrong and the path of the node.
import { AST_VERSION, type DocumentNode, isRecord, pointerKey } from './ast.ts'
import { utf8Length } from './positions.ts'
import { MAX_DEPTH } from './state.ts'
import { TASK_STATUS } from './tree-tables.ts'
import { SMART_KIND_NAMES } from './inline-tables.ts'
import { type ExtensionDefinition, type ExtensionSlot } from './extensions/types.ts'

/** A tree that a reader refuses. `path` is an RFC 6901 pointer to the node or the field. */
export class CarveTreeError extends Error {
  path: string
  reason: string

  constructor(path: string, reason: string) {
    super(`${path === '' ? '/' : path}: ${reason}`)
    this.name = 'CarveTreeError'
    this.path = path
    this.reason = reason
  }
}

// C2-A-171: the deepest tree the parser makes. A list and its item are two nodes per level of the
// cap, and a table, a figure and a caption add their member nodes above a leaf.
export const MAX_TREE_DEPTH = 2 * MAX_DEPTH + 16

const BLOCKS = [
  'admonition', 'block_extension', 'block_quote', 'code_block', 'comment', 'definition_list', 'directive', 'div', 'figure',
  'figure_group', 'heading', 'include', 'line_block', 'list', 'paragraph', 'raw_block', 'section', 'table', 'thematic_break',
]
const INLINES = [
  'abbreviation', 'autolink', 'caption_number', 'citation_group', 'code', 'comment', 'critic_comment', 'delete', 'emphasis',
  'footnote_ref', 'hard_break', 'highlight', 'image', 'inline_extension', 'inline_footnote', 'insert', 'link',
  'literal_inline', 'math', 'mention', 'non_breaking_space', 'raw_inline', 'ruby', 'small_caps', 'smart_punctuation',
  'soft_break', 'span', 'strike', 'strong', 'subscript', 'superscript', 'symbol', 'tag', 'text', 'underline', 'xref',
]
const TABLE_GROUPS = ['table_head', 'table_body', 'table_foot']
const COMMON = ['type', 'attrs', 'data', 'pos', 'segments', 'metadata', 'dir', 'lang']

/** What the `children` of a node type hold: `blocks`, `inlines`, `none`, or the member types by name. */
export type Content = 'blocks' | 'inlines' | 'none' | readonly string[]

/** The row of one node type in the table of C2-A-050: its children, its required and its optional fields. */
export type Rule = readonly [Content, readonly string[], readonly string[]]

const REFERENCE = ['key', 'namespace']
const EXTENSION = ['props', 'slots', 'payload', 'resourceIds', 'source']

const RULES = new Map<string, Rule>([
  ['abbreviation', ['none', REFERENCE, ['expansion']]],
  ['abbreviation_def', ['none', ['expansion', ...REFERENCE], []]],
  ['admonition', ['blocks', ['kind'], ['title', 'groupLabel']]],
  ['autolink', ['none', ['href'], ['text']]],
  ['block_extension', ['blocks', ['name', 'version', 'fallback'], EXTENSION]],
  ['block_quote', ['blocks', [], []]],
  ['caption', ['blocks', [], ['short']]],
  ['caption_number', ['none', [], ['n']]],
  ['cell_paragraph', ['inlines', [], []]],
  ['citation', [
    'none', ['key', 'namespace'], ['prefix', 'locator', 'suffix', 'mode', 'number', 'useIndex'],
  ]],
  ['citation_definition', ['inlines', REFERENCE, []]],
  ['citation_group', [['citation'], ['raw'], []]],
  ['code', ['none', ['value'], []]],
  ['code_block', ['none', ['value'], ['syntax', 'title', 'groupLabel']]],
  ['comment', ['none', ['form', 'value'], []]],
  ['critic_comment', ['none', ['value'], []]],
  ['definition_description', ['blocks', [], []]],
  ['definition_list', [['definition_term', 'definition_description', 'comment'], [], []]],
  ['definition_term', ['inlines', [], []]],
  ['delete', ['inlines', [], []]],
  ['directive', ['blocks', ['kind'], ['title', 'groupLabel', 'tocTarget']]],
  ['div', ['blocks', [], ['title', 'groupLabel']]],
  ['document', [
    [...BLOCKS, 'footnote', 'link_reference_definition', 'abbreviation_def', 'citation_definition', 'frontmatter'],
    ['astVersion'], ['srcByteLength', 'extensions', 'stages', 'resources'],
  ]],
  ['emphasis', ['inlines', [], []]],
  ['figure', ['blocks', [], ['caption', 'kind']]],
  ['figure_group', ['blocks', [], ['caption']]],
  ['footnote', ['blocks', REFERENCE, []]],
  ['footnote_ref', ['none', REFERENCE, ['number']]],
  ['frontmatter', ['none', ['format', 'value'], []]],
  ['hard_break', ['none', [], []]],
  ['heading', ['inlines', ['level'], ['generatedId']]],
  ['highlight', ['inlines', [], []]],
  ['image', ['none', [], [
    'src', 'alt', 'decorative', 'tooltip', 'targetKind', 'key', 'namespace', 'resourceId', 'refForm', 'longDescription',
  ]]],
  ['include', ['none', ['path'], ['section', 'options']]],
  ['inline_extension', ['inlines', ['name'], [...EXTENSION, 'version', 'fallback']]],
  ['inline_footnote', ['inlines', [], ['number']]],
  ['insert', ['inlines', [], []]],
  ['line', ['inlines', [], []]],
  ['line_block', [['line'], [], []]],
  ['link', ['inlines', [], ['href', 'tooltip', 'targetKind', 'key', 'namespace', 'refForm']]],
  ['link_reference_definition', ['none', ['href', ...REFERENCE], ['tooltip']]],
  ['list', [['list_item'], ['marker', 'spacing'], []]],
  ['list_item', ['blocks', [], ['task']]],
  ['literal_inline', ['none', ['value'], []]],
  ['math', ['none', ['display', 'value'], ['number', 'numberPrefix']]],
  ['mention', ['none', ['target', 'kind'], ['label']]],
  ['non_breaking_space', ['none', [], []]],
  ['paragraph', ['inlines', [], ['role']]],
  ['raw_block', ['none', ['format', 'value'], []]],
  ['raw_inline', ['none', ['format', 'value'], []]],
  ['ruby', ['none', ['pairs'], []]],
  ['ruby_pair', ['none', ['base', 'annotation'], []]],
  ['section', ['blocks', [], ['level']]],
  ['small_caps', ['inlines', [], []]],
  ['smart_punctuation', ['none', ['kind', 'source'], ['glyph']]],
  ['soft_break', ['none', [], []]],
  ['span', ['inlines', [], []]],
  ['strike', ['inlines', [], []]],
  ['strong', ['inlines', [], []]],
  ['subscript', ['inlines', [], []]],
  ['superscript', ['inlines', [], []]],
  ['symbol', ['none', ['name'], []]],
  ['table', [[...TABLE_GROUPS, 'comment'], ['columns'], ['caption']]],
  ['table_body', [['table_row', 'comment'], [], ['headRows', 'rowHeadColumns']]],
  ['table_cell', [[...BLOCKS, 'cell_paragraph'], ['header'], ['span', 'colspan', 'rowspan', 'align', 'valign', 'scope', 'headerIds']]],
  ['table_column', ['none', [], ['align', 'valign', 'width', 'resolvedAlign', 'authored']]],
  ['table_foot', [['table_row', 'comment'], [], []]],
  ['table_head', [['table_row', 'comment'], [], []]],
  ['table_row', [['table_cell'], [], []]],
  ['tag', ['none', ['name'], []]],
  ['text', ['none', ['value'], []]],
  ['thematic_break', ['none', [], []]],
  ['underline', ['inlines', [], []]],
  ['xref', ['none', REFERENCE, ['href', 'display']]],
])

const STRINGS = [
  'key', 'namespace', 'expansion', 'kind', 'groupLabel', 'href', 'text', 'name', 'version', 'raw', 'syntax', 'form',
  'tocTarget', 'generatedId', 'src', 'alt', 'tooltip', 'targetKind', 'resourceId', 'path', 'section', 'spacing',
  'numberPrefix', 'target', 'label', 'format', 'glyph', 'source', 'span', 'align', 'valign', 'resolvedAlign',
  'mode', 'value', 'astVersion', 'lang', 'refForm', 'role', 'scope',
]
const INTEGERS = ['n', 'number', 'level', 'headRows', 'rowHeadColumns', 'colspan', 'rowspan', 'srcByteLength']
const BOOLEANS = ['display', 'header', 'decorative', 'useIndex']
const TRUE_ONLY = ['authored']
const INLINE_SLOTS = ['short', 'prefix', 'suffix', 'base', 'annotation']
const POSITION_FIELDS = ['startLine', 'endLine', 'startColumn', 'endColumn', 'startOffset', 'endOffset']

// The values of the fields that take one of a fixed set, by node type and field; `*` is every type.
const ENUMS = new Map<string, readonly string[]>([
  ['*.dir', ['ltr', 'rtl', 'auto']],
  ['comment.form', ['block', 'line', 'braced']],
  ['link.refForm', ['full', 'collapsed']],
  ['image.refForm', ['full', 'collapsed']],
  ['xref.display', ['number', 'page', 'title', 'full']],
  ['paragraph.role', ['image', 'math']],
  ['citation.mode', ['normal', 'author-in-text', 'suppress-author']],
  ['table_cell.scope', ['row', 'col', 'rowgroup', 'colgroup']],
  ['list.spacing', ['tight', 'loose']],
  ['table_cell.span', ['rowspan', 'colspan']],
  ['table_cell.align', ['left', 'right', 'center']],
  ['table_column.align', ['left', 'right', 'center']],
  ['table_column.resolvedAlign', ['left', 'right', 'center']],
  ['table_cell.valign', ['top', 'middle', 'bottom', 'baseline']],
  ['table_column.valign', ['top', 'middle', 'bottom', 'baseline']],
  ['smart_punctuation.kind', SMART_KIND_NAMES],
  ['link.targetKind', ['url', 'wiki', 'doc', 'xref']],
  ['image.targetKind', ['url', 'wiki', 'doc', 'xref']],
  ['directive.tocTarget', ['headings', 'figures', 'tables', 'listings']],
  ['directive.kind', ['bibliography', 'footnotes', 'glossary', 'index', 'references', 'toc']],
  ['figure.kind', ['image', 'table', 'listing', 'equation', 'other']],
  ['admonition.kind', ['note', 'tip', 'warning', 'danger', 'info', 'success', 'example', 'quote']],
  ['*.namespace', ['link', 'footnote', 'citation', 'abbr', 'heading']],
  // C2-A-077 to C2-A-079, C2-A-103, C2-A-117, C2-A-121: the namespace of each reference and definition.
  ['link.namespace', ['link']],
  ['image.namespace', ['link']],
  ['link_reference_definition.namespace', ['link']],
  ['footnote_ref.namespace', ['footnote']],
  ['footnote.namespace', ['footnote']],
  ['abbreviation.namespace', ['abbr']],
  ['abbreviation_def.namespace', ['abbr']],
  ['citation.namespace', ['citation']],
  ['citation_definition.namespace', ['citation']],
])
const STAGES = ['referenceResolution', 'tableAlignment']
const ORDERED_STYLES = ['1', 'a', 'A', 'i', 'I']

/** The node table and the field kinds, which scripts/generate-ast-nodes.ts writes the node interfaces from. */
export const NODE_TABLE = { BLOCKS, INLINES, RULES, STRINGS, INTEGERS, BOOLEANS, TRUE_ONLY, INLINE_SLOTS, ENUMS, STAGES }

type Value = unknown
type Fields = Record<string, Value>

function fail(path: string, reason: string): never {
  throw new CarveTreeError(path, reason)
}

function requireString(value: Value, path: string): string {
  return typeof value === 'string' ? value : fail(path, 'not a string')
}

function requireArray(value: Value, path: string): Value[] {
  return Array.isArray(value) ? value : fail(path, 'not a list')
}

function isPair(value: Value): boolean {
  return Array.isArray(value) && value.length === 2 && typeof value[0] === 'string' && typeof value[1] === 'string'
}

function checkPairs(value: Value, path: string): void {
  requireArray(value, path).forEach((pair, index) => {
    if (!isPair(pair)) fail(`${path}/${index}`, 'not a pair of two strings')
  })
}

/** C2-A-181: decoded values under the six include option names. */
function checkOption(name: string, item: Value, path: string): void {
  if (name === 'lines' || name === 'region' || name === 'rows') requireString(item, path)
  else if (name === 'cols') {
    if (typeof item !== 'string') checkStrings(item, path)
  } else if (name === 'shift') {
    if (item !== 'auto' && !Number.isInteger(item)) fail(path, 'not an integer or auto')
  } else if (name === 'code') {
    if (item !== true) requireString(item, path)
  } else fail(path, 'not an include option')
}

function checkOptions(value: Value, path: string): void {
  if (!isRecord(value)) fail(path, 'options is not an object')
  for (const [name, item] of Object.entries(value)) checkOption(name, item, `${path}/${name}`)
}

/** C2-A-032, C2-A-034: an optional id, a list of classes and a list of pairs; `id` and `class` are no keys. */
function checkAttrs(value: Value, path: string): void {
  if (!isRecord(value)) fail(path, 'attrs is not an object')
  for (const name of Object.keys(value)) {
    if (name !== 'id' && name !== 'classes' && name !== 'keyValues') fail(`${path}/${name}`, 'unknown field of attrs')
  }
  if (value['id'] !== undefined) requireString(value['id'], `${path}/id`)
  if (value['classes'] !== undefined) {
    requireArray(value['classes'], `${path}/classes`).forEach((name, index) => requireString(name, `${path}/classes/${index}`))
  }
  if (value['keyValues'] === undefined) return
  checkPairs(value['keyValues'], `${path}/keyValues`)
  for (const [key] of value['keyValues'] as [string, string][]) {
    const name = key.toLowerCase()
    if (name === 'id' || name === 'class') fail(`${path}/keyValues`, `the key ${key} folds into the id or the classes`)
  }
}

/** C2-A-139, C2-A-140: six integers, never null, with the start not behind the end. */
function checkPosition(value: Value, path: string, walk?: Walk): void {
  if (!isRecord(value)) fail(path, 'pos is not an object')
  checkPositionFields(value, path)
  if (value['file'] !== undefined) requireString(value['file'], `${path}/file`)
  if ((value['startOffset'] as number) > (value['endOffset'] as number)) fail(path, 'the start lies behind the end')
  if (walk?.tree.sourcePositions !== undefined && value['file'] === undefined) {
    checkPositionSource(value, path, walk.tree.sourcePositions)
  }
}

function checkPositionFields(value: Fields, path: string): void {
  for (const name of POSITION_FIELDS) {
    if (!Number.isInteger(value[name])) fail(`${path}/${name}`, 'not an integer')
    const minimum = name.endsWith('Offset') ? 0 : 1
    if ((value[name] as number) < minimum) fail(`${path}/${name}`, `below ${minimum}`)
  }
  for (const name of Object.keys(value)) {
    if (!POSITION_FIELDS.includes(name) && name !== 'file') fail(`${path}/${name}`, 'unknown field of pos')
  }
}

function checkPositionSource(value: Fields, path: string, source: ReadonlyMap<number, readonly [number, number]>): void {
  for (const end of ['start', 'end']) {
    const position = source.get(value[`${end}Offset`] as number)
    if (position === undefined || position[0] !== value[`${end}Line`] || position[1] !== value[`${end}Column`]) {
      fail(path, `${end} coordinates disagree with the source`)
    }
  }
}

/** C2-A-054 to C2-A-058. */
function checkMarker(value: Value, path: string): void {
  if (!isRecord(value)) fail(path, 'marker is not an object')
  const ordered = value['kind'] === 'ordered'
  if (!ordered && value['kind'] !== 'bullet') fail(`${path}/kind`, 'neither bullet nor ordered')
  const allowed = ordered ? ['kind', 'style', 'delimiter', 'start'] : ['kind', 'char']
  for (const name of Object.keys(value)) {
    if (!allowed.includes(name)) fail(`${path}/${name}`, 'a field of the other kind of marker')
  }
  if (ordered) checkOrderedMarker(value, path)
  else if (value['char'] !== '-' && value['char'] !== '*') fail(`${path}/char`, 'not a bullet character')
}

function checkOrderedMarker(value: Fields, path: string): void {
  if (value['style'] !== undefined && !ORDERED_STYLES.includes(value['style'] as string)) fail(`${path}/style`, 'unknown style')
  const delimiter = value['delimiter']
  if (delimiter !== undefined && delimiter !== '.' && delimiter !== ')') fail(`${path}/delimiter`, 'unknown delimiter')
  if (value['start'] !== undefined && !Number.isInteger(value['start'])) fail(`${path}/start`, 'not an integer')
  if (value['start'] === 1) fail(`${path}/start`, 'a start of 1 is omitted')
}

/** C2-A-060, C2-A-061: the status follows from the mark. */
function checkTask(value: Value, path: string): void {
  if (!isRecord(value)) fail(path, 'task is not an object')
  for (const name of Object.keys(value)) if (name !== 'mark') fail(`${path}/${name}`, 'not a field of task')
  if (typeof value['mark'] !== 'string' || !TASK_STATUS.has(value['mark'])) fail(`${path}/mark`, 'unknown task mark')
}

function checkStrings(value: Value, path: string): void {
  requireArray(value, path).forEach((item, index) => requireString(item, `${path}/${index}`))
}

function checkBibliography(value: Value, path: string, walk: Walk): void {
  if (!isRecord(value)) fail(path, 'bibliography is not an object')
  for (const [name, item] of Object.entries(value)) {
    const at = `${path}/${name}`
    if (name === 'title' || name === 'containerTitle') checkList(item, at, 'inlines', walk)
    else if (name === 'authors') checkStrings(item, at)
    else if (name === 'issued' || name === 'doi' || name === 'url') requireString(item, at)
    else fail(at, 'not a field of bibliography')
  }
}

function checkMetadataFields(value: Value, path: string, walk: Walk, depth: number): void {
  if (!isRecord(value)) fail(path, 'metadata fields is not a map')
  for (const [name, item] of Object.entries(value)) {
    const at = `${path}/${pointerKey(name)}`
    if (name === '') fail(at, 'empty metadata field name')
    if (++walk.tree.metadataFields > 256) fail(at, 'more than 256 named metadata fields')
    checkMetadataValue(item, at, walk, depth)
  }
}

function checkMetadataValue(value: Value, path: string, walk: Walk, depth: number): void {
  if (depth > 64) fail(path, 'metadata values are nested deeper than 64 levels')
  if (!isRecord(value)) fail(path, 'not a metadata value')
  for (const name of Object.keys(value)) if (name !== 'kind' && name !== 'value') fail(`${path}/${name}`, 'unknown metadata value field')
  if (value['kind'] === undefined || value['value'] === undefined) fail(path, 'metadata value needs kind and value')
  checkMetadataPayload(value['kind'], value['value'], path, walk, depth)
}

function checkMetadataPayload(kind: Value, item: Value, path: string, walk: Walk, depth: number): void {
  const at = `${path}/value`
  if (typeof kind !== 'string') fail(`${path}/kind`, 'unknown metadata value kind')
  switch (kind) {
    case 'string': requireString(item, at); break
    case 'boolean': if (typeof item !== 'boolean') fail(at, 'not a boolean'); break
    case 'number': if (typeof item !== 'number' || !Number.isFinite(item)) fail(at, 'not a finite number'); break
    case 'inlines': checkList(item, at, 'inlines', walk); break
    case 'blocks': checkList(item, at, 'blocks', walk); break
    case 'list': requireArray(item, at).forEach((entry, index) => checkMetadataValue(entry, `${at}/${index}`, walk, depth + 1)); break
    case 'map': checkMetadataFields(item, at, walk, depth + 1); break
    default: fail(`${path}/kind`, 'unknown metadata value kind')
  }
}

function checkHeaderFooter(value: Value, path: string, walk: Walk): void {
  requireArray(value, path).forEach((entry, index) => {
    const place = `${path}/${index}`
    if (!isRecord(entry)) fail(place, 'not a header or footer')
    for (const key of Object.keys(entry)) if (key !== 'placement' && key !== 'children') fail(`${place}/${key}`, 'unknown field')
    const placement = entry['placement']
    if (placement !== 'default' && placement !== 'first' && placement !== 'even') fail(`${place}/placement`, 'invalid placement')
    checkList(entry['children'], `${place}/children`, 'blocks', walk)
  })
}

function checkRootMetadataField(name: string, item: Value, path: string, walk: Walk): void {
  if (name === 'abstract') checkList(item, path, 'blocks', walk)
  else if (name === 'keywords') checkStrings(item, path)
  else if (name === 'fields') checkMetadataFields(item, path, walk, 1)
  else if (name === 'headers' || name === 'footers') checkHeaderFooter(item, path, walk)
  else fail(path, 'not a field of metadata')
}

/** C2-A-030, C2-A-121: metadata has only its typed fields and node-bearing slots. */
function checkMetadata(value: Value, path: string, walk: Walk): void {
  if (!isRecord(value)) fail(path, 'metadata is not an object')
  for (const [name, item] of Object.entries(value)) {
    const at = `${path}/${name}`
    if (name === 'title' || name === 'subtitle') checkList(item, at, 'inlines', walk)
    else if (name === 'authors') checkStrings(item, at)
    else if (name === 'date') requireString(item, at)
    else if (name === 'bibliography') checkBibliography(item, at, walk)
    else if (path === '/metadata') checkRootMetadataField(name, item, at, walk)
    else fail(at, 'not a field of metadata')
  }
}

function checkLocator(value: Value, path: string, walk: Walk): void {
  if (!isRecord(value)) fail(path, 'locator is not an object')
  for (const name of Object.keys(value)) if (name !== 'label' && name !== 'children') fail(`${path}/${name}`, 'not a field of locator')
  if (value['label'] !== undefined) requireString(value['label'], `${path}/label`)
  checkList(value['children'], `${path}/children`, 'inlines', walk)
}

function checkHeaderIds(value: Value, path: string): void {
  checkStrings(value, path)
}

function checkEnum(type: string, name: string, value: Value, path: string): void {
  const values = ENUMS.get(`${type}.${name}`) ?? ENUMS.get(`*.${name}`)
  if (values !== undefined && !values.includes(value as string)) fail(path, `unknown value ${JSON.stringify(value)}`)
}

/** C2-B-212: a fraction of the table width, above 0 and at most 1. */
function isWidth(value: Value): boolean {
  return typeof value === 'number' && value > 0 && value <= 1
}

function checkScalar(type: string, name: string, value: Value, path: string): boolean {
  if (type === 'xref' && name === 'display') {
    requireString(value, path)
    checkEnum(type, name, value, path)
    return true
  }
  if (name === 'width') return isWidth(value) || fail(path, 'not a fraction above 0 and at most 1')
  if (TRUE_ONLY.includes(name)) return value === true || fail(path, 'not true')
  if (BOOLEANS.includes(name)) return typeof value === 'boolean' || fail(path, 'not a boolean')
  if (INTEGERS.includes(name)) return checkCount(name, value, path)
  if ((name === 'source' && type !== 'smart_punctuation') || (!STRINGS.includes(name) && name !== 'dir')) return false
  requireString(value, path)
  checkEnum(type, name, value, path)
  return true
}

function checkCount(name: string, value: Value, path: string): boolean {
  const minimum = name === 'level' || name === 'colspan' || name === 'rowspan' ? 1 : 0
  return (Number.isInteger(value) && (value as number) >= minimum) || fail(path, `not a count of at least ${minimum}`)
}

/** What the walk counts over the whole tree for the bounds of C2-A-132 and the manifest of C2-A-131. */
interface TreeFacts {
  resourceReferences: number
  metadataFields: number
  annotationIds: Map<string, string>
  declarations: ReadonlyMap<string, { version: string, required: boolean, slots: readonly string[] }>
  registry: ReadonlyMap<string, ExtensionDefinition>
  headerIds: Set<string>
  headerReferences: [string, string][]
  sourcePositions: ReadonlyMap<number, readonly [number, number]> | undefined
  /** Each resource id a node names, and the path of the field that names it. */
  references: [string, string][]
}

function validSegment(value: string): boolean {
  if (value.length === 0) return false
  const first = value.charCodeAt(0)
  if (!((first >= 65 && first <= 90) || (first >= 97 && first <= 122))) return false
  for (let at = 1; at < value.length; at++) {
    const code = value.charCodeAt(at)
    const letter = (code >= 65 && code <= 90) || (code >= 97 && code <= 122)
    if (!letter && !(code >= 48 && code <= 57) && code !== 45 && code !== 95) return false
  }
  return true
}

/** C2-A-123: every segment is an ASCII identifier, and a qualified name has at least two. */
function validName(value: string, qualified: boolean): boolean {
  const parts = value.split('.')
  return (!qualified || parts.length >= 2) && parts.every(validSegment)
}

function declaredNames(value: unknown): [string, { version: string, required: boolean, slots: readonly string[] }][] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => isRecord(entry) && typeof entry['name'] === 'string' &&
    typeof entry['version'] === 'string' && typeof entry['required'] === 'boolean' && Array.isArray(entry['slots'])
    ? [[entry['name'], { version: entry['version'], required: entry['required'], slots: entry['slots'] }]] : [])
}

/** Where the walk stands: the nesting of nodes, the nesting of extension fallbacks, and the facts of the tree. */
interface Walk {
  depth: number
  fallbacks: number
  coreFallback?: boolean
  tree: TreeFacts
  parent?: { name: string, slot: string }
}

type FieldCheck = (value: Value, path: string, walk: Walk, node: Fields) => void

function nodeList(content: Content): FieldCheck {
  return (value, path, walk) => checkList(value, path, content, walk)
}

function checkTitle(value: Value, path: string, walk: Walk): void {
  checkList(value, path, 'inlines', walk)
}

function checkStages(value: Value, path: string): void {
  requireArray(value, path).forEach((stage, index) => {
    if (!STAGES.includes(stage as string)) fail(`${path}/${index}`, 'unknown stage')
  })
}

function checkSlots(value: Value, path: string, walk: Walk, node: Fields): void {
  if (!isRecord(value)) fail(path, 'slots is not an object')
  const name = String(node['name'])
  const definition = walk.tree.registry.get(name)
  const declaration = walk.tree.declarations.get(name)
  for (const slotName of Object.keys(value)) if (validSlotName(slotName) && declaration !== undefined &&
    !declaration.slots.includes(slotName)) {
    fail(`${path}/${pointerKey(slotName)}`, 'slot absent from extension declaration')
  }
  for (const [slotName, slot] of Object.entries(value)) checkSlot(slotName, slot, path, walk, node, definition)
  if (definition !== undefined) checkRequiredSlots(value, path, definition)
}

function checkSlot(name: string, slot: Value, path: string, walk: Walk, node: Fields,
  definition: ExtensionDefinition | undefined): void {
  const at = `${path}/${pointerKey(name)}`
  if (!validSlotName(name)) fail(at, 'not a lowercase slot name')
  const rule = definition?.slots[name]
  if (definition !== undefined && rule === undefined) fail(at, 'unknown extension slot')
  const content = rule === undefined ? unknownSlotContent(node) : slotContent(rule)
  checkList(slot, at, content, walk, { name: String(node['name']), slot: name })
  if (rule?.minItems !== undefined && Array.isArray(slot) && slot.length < rule.minItems) fail(at, 'too few slot items')
  if (rule?.name !== undefined && Array.isArray(slot) && slot.some((item) => !isRecord(item) || item['name'] !== rule.name)) {
    fail(at, 'wrong extension in slot')
  }
}

function unknownSlotContent(node: Fields): Content {
  if (String(node['name']).includes('.')) return [...BLOCKS, ...INLINES]
  return node['type'] === 'block_extension' ? 'blocks' : 'inlines'
}

function checkRequiredSlots(value: Fields, path: string, definition: ExtensionDefinition): void {
  for (const [name, rule] of Object.entries(definition.slots)) {
    if (!rule.optional && value[name] === undefined) fail(`${path}/${name}`, 'a required slot is missing')
  }
}

function validSlotName(value: string): boolean {
  const first = value.charCodeAt(0)
  if (first < 97 || first > 122) return false
  for (let at = 1; at < value.length; at++) {
    const code = value.charCodeAt(at)
    if ((code < 97 || code > 122) && (code < 48 || code > 57) && code !== 95) return false
  }
  return true
}

function slotContent(rule: ExtensionSlot): Content {
  if (rule.kind === 'block') return 'blocks'
  if (rule.kind === 'inline') return 'inlines'
  return [rule.kind]
}

/** C2-A-122: a list of alternatives, each with a media type in `format` and the extension's own data in `value`. */
function checkPayload(value: Value, path: string): void {
  requireArray(value, path).forEach((entry, index) => {
    const at = `${path}/${index}`
    if (!isRecord(entry)) fail(at, 'not a payload alternative')
    for (const name of Object.keys(entry)) {
      if (name !== 'format' && name !== 'value') fail(`${at}/${name}`, 'not a field of a payload alternative')
    }
    if (requireString(entry['format'], `${at}/format`) === '') fail(`${at}/format`, 'an empty media type')
    if (entry['value'] === null || entry['value'] === undefined) fail(`${at}/value`, 'a field without a value')
    checkJson(entry['value'], `${at}/value`)
  })
}

/** C2-A-131: a resource id that a node names, checked against the manifest when the walk is done. */
function addReference(id: Value, path: string, walk: Walk): void {
  walk.tree.references.push([requireString(id, path), path])
}

/** C2-A-131: every entry has an id, a media type and a digest, and no id occurs twice. */
function checkResources(value: Value, path: string): void {
  const seen = new Set<string>()
  requireArray(value, path).forEach((entry, index) => {
    if (!isRecord(entry)) fail(`${path}/${index}`, 'not a resource')
    for (const name of Object.keys(entry)) {
      if (!['id', 'mediaType', 'digest', 'href', 'size'].includes(name)) fail(`${path}/${index}/${name}`, 'not a field of resource')
    }
    const id = requireString(entry['id'], `${path}/${index}/id`)
    requireString(entry['mediaType'], `${path}/${index}/mediaType`)
    const digest = requireString(entry['digest'], `${path}/${index}/digest`)
    if (entry['href'] !== undefined) requireString(entry['href'], `${path}/${index}/href`)
    if (entry['size'] !== undefined && (!Number.isInteger(entry['size']) || (entry['size'] as number) < 0)) {
      fail(`${path}/${index}/size`, 'not a non-negative byte count')
    }
    if (!/^sha256:[0-9a-f]{64}$/.test(digest)) fail(`${path}/${index}/digest`, 'not a sha256 digest')
    if (seen.has(id)) fail(`${path}/${index}/id`, 'a duplicate resource id')
    seen.add(id)
  })
}

/** C2-A-017: a qualified name, a boolean `required` and an optional version. */
function checkExtensions(value: Value, path: string, walk: Walk): void {
  const seen = new Set<string>()
  requireArray(value, path).forEach((entry, index) => {
    if (!isRecord(entry)) fail(`${path}/${index}`, 'not an extension declaration')
    for (const name of Object.keys(entry)) {
      if (!['name', 'required', 'version', 'slots'].includes(name)) fail(`${path}/${index}/${name}`, 'not a field of extension declaration')
    }
    const name = requireString(entry['name'], `${path}/${index}/name`)
    if (!validName(name, true)) fail(`${path}/${index}/name`, 'not a qualified name')
    if (typeof entry['required'] !== 'boolean') fail(`${path}/${index}/required`, 'not a boolean')
    const version = requireString(entry['version'], `${path}/${index}/version`)
    if (version === '') fail(`${path}/${index}/version`, 'an empty version')
    const slots = requireArray(entry['slots'], `${path}/${index}/slots`)
    const seenSlots = new Set<string>()
    slots.forEach((slot, at) => {
      if (typeof slot !== 'string' || !validSlotName(slot)) fail(`${path}/${index}/slots/${at}`, 'not a slot name')
      if (seenSlots.has(slot)) fail(`${path}/${index}/slots/${at}`, 'duplicate slot name')
      seenSlots.add(slot)
    })
    if (seen.has(name)) fail(`${path}/${index}/name`, 'a duplicate extension declaration')
    seen.add(name)
    if (entry['required'] === true && walk.tree.registry.get(name)?.version !== version) {
      fail(`${path}/${index}`, 'an unknown required extension')
    }
  })
}

function checkData(value: Value, path: string, walk: Walk, node: Fields): void {
  checkObject(value, path)
  if (!isRecord(value)) return
  for (const name of Object.keys(value)) {
    if (!validName(name, true)) fail(`${path}/${pointerKey(name)}`, 'not a qualified data name')
    if (!walk.tree.declarations.has(name)) fail(`${path}/${pointerKey(name)}`, 'an undeclared data name')
    checkStandardData(name, value[name], `${path}/${pointerKey(name)}`, node, walk)
  }
}

function closedObject(value: Value, path: string, allowed: readonly string[], required: readonly string[] = []): Fields {
  if (!isRecord(value)) fail(path, 'not an object')
  for (const name of Object.keys(value)) if (!allowed.includes(name)) fail(`${path}/${pointerKey(name)}`, 'unknown field')
  for (const name of required) if (value[name] === undefined) fail(`${path}/${name}`, 'required field absent')
  return value
}

function nonempty(value: Value, path: string): string {
  if (typeof value !== 'string' || value.length === 0) fail(path, 'not a nonempty string')
  return value
}

function positiveNumber(value: Value, path: string, zero: boolean): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (!zero && value === 0)) {
    fail(path, zero ? 'not a nonnegative number' : 'not a positive number')
  }
}

const STYLE_DIRECT = ['namedStyle', 'alignment', 'indentPt', 'spacingBeforePt', 'spacingAfterPt',
  'pageBreakBefore', 'keepWithNext', 'language', 'direction']

function checkStyleDirect(value: Value, path: string, node: Fields): void {
  const fields = closedObject(value, path, STYLE_DIRECT)
  for (const [name, item] of Object.entries(fields)) {
    const at = `${path}/${name}`
    if (['namedStyle', 'language'].includes(name)) nonempty(item, at)
    else if (name === 'alignment' && !['start', 'center', 'end', 'justify'].includes(item as string)) fail(at, 'invalid alignment')
    else if (name === 'direction' && !['ltr', 'rtl'].includes(item as string)) fail(at, 'invalid direction')
    else if (name.endsWith('Pt')) positiveNumber(item, at, true)
    else if (['pageBreakBefore', 'keepWithNext'].includes(name) && typeof item !== 'boolean') fail(at, 'not a boolean')
    if ((name === 'language' && node['lang'] !== undefined) || (name === 'direction' && node['dir'] !== undefined)) {
      fail(at, 'the common field already holds this value')
    }
  }
}

function checkStylePage(value: Value, path: string): void {
  const page = closedObject(value, path, ['widthPt', 'heightPt', 'marginsPt'], ['widthPt', 'heightPt', 'marginsPt'])
  positiveNumber(page['widthPt'], `${path}/widthPt`, false)
  positiveNumber(page['heightPt'], `${path}/heightPt`, false)
  const margins = closedObject(page['marginsPt'], `${path}/marginsPt`, ['top', 'right', 'bottom', 'left'],
    ['top', 'right', 'bottom', 'left'])
  for (const [name, amount] of Object.entries(margins)) positiveNumber(amount, `${path}/marginsPt/${name}`, true)
}

function checkStyle(value: Value, path: string, node: Fields): void {
  const style = closedObject(value, path, [...STYLE_DIRECT, 'namedStyles', 'page'])
  checkStyleDirect(Object.fromEntries(Object.entries(style).filter(([name]) => STYLE_DIRECT.includes(name))), path, node)
  if (node['type'] !== 'document' && (style['namedStyles'] !== undefined || style['page'] !== undefined)) {
    fail(path, 'named styles and page stand only on the root')
  }
  if (style['namedStyles'] !== undefined) {
    if (!isRecord(style['namedStyles'])) fail(`${path}/namedStyles`, 'not an object')
    for (const [name, item] of Object.entries(style['namedStyles'])) {
      nonempty(name, `${path}/namedStyles`)
      checkStyleDirect(item, `${path}/namedStyles/${pointerKey(name)}`, {})
    }
  }
  if (style['page'] !== undefined) checkStylePage(style['page'], `${path}/page`)
}

function checkAnnotationData(value: Value, path: string, walk: Walk): void {
    const annotation = closedObject(value, path, ['ids'], ['ids'])
    const ids = requireArray(annotation['ids'], `${path}/ids`)
    const seen = new Set<string>()
    for (const [at, id] of ids.entries()) {
      const name = nonempty(id, `${path}/ids/${at}`)
      if (seen.has(name)) fail(`${path}/ids/${at}`, 'duplicate annotation id')
      if (walk.tree.annotationIds.has(name)) fail(`${path}/ids/${at}`, 'duplicate annotation id across tree')
      seen.add(name)
      walk.tree.annotationIds.set(name, path.slice(0, -'/data/carve.annotation'.length))
    }
}

function checkSourceData(value: Value, path: string): void {
  const source = closedObject(value, path, ['format', 'locator', 'importer'], ['format', 'locator', 'importer'])
  nonempty(source['format'], `${path}/format`)
  const locator = closedObject(source['locator'], `${path}/locator`, ['part', 'path', 'id'])
  if (Object.keys(locator).length === 0) fail(`${path}/locator`, 'empty locator')
  for (const [key, item] of Object.entries(locator)) nonempty(item, `${path}/locator/${key}`)
  const importer = closedObject(source['importer'], `${path}/importer`, ['name', 'version'], ['name', 'version'])
  for (const [key, item] of Object.entries(importer)) nonempty(item, `${path}/importer/${key}`)
}

function checkStandardData(name: string, value: Value, path: string, node: Fields, walk: Walk): void {
  if (name === 'carve.style') checkStyle(value, path, node)
  else if (name === 'carve.source') checkSourceData(value, path)
  else if (name === 'carve.annotation') checkAnnotationData(value, path, walk)
}

function checkObject(value: Value, path: string): void {
  if (!isRecord(value)) fail(path, 'not an object')
  checkJson(value, path)
  const pending: [unknown, string][] = [[value, path]]
  const seen = new WeakSet<object>()
  while (pending.length > 0) {
    const [item, at] = pending.pop()!
    if (typeof item !== 'object' || item === null || seen.has(item)) continue
    seen.add(item)
    if (isRecord(item) && typeof item['type'] === 'string' && RULES.has(item['type'])) fail(at, 'a node in an opaque object')
    for (const [name, child] of Object.entries(item)) pending.push([child, `${at}/${pointerKey(name)}`])
  }
}

function checkJson(value: Value, path: string): void {
  const active = new Set<object>()
  const visit = (item: Value, at: string): void => {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return
    if (typeof item === 'number' && Number.isFinite(item)) return
    if (typeof item !== 'object') fail(at, 'not JSON')
    if (active.has(item)) fail(at, 'a cycle is not JSON')
    active.add(item)
    if (Array.isArray(item)) item.forEach((entry, index) => visit(entry, `${at}/${index}`))
    else for (const [name, entry] of Object.entries(item)) visit(entry, `${at}/${pointerKey(name)}`)
    active.delete(item)
  }
  visit(value, path)
}

function checkSource(value: Value, path: string): void {
  if (!isRecord(value)) fail(path, 'source is not an object')
  for (const name of Object.keys(value)) {
    if (!['form', 'name', 'body', 'title', 'groupLabel'].includes(name)) fail(`${path}/${name}`, 'unknown source field')
    requireString(value[name], `${path}/${name}`)
  }
  if (!['inline', 'div', 'fence'].includes(value['form'] as string)) fail(`${path}/form`, 'unknown source form')
  requireString(value['name'], `${path}/name`)
  const body = requireString(value['body'], `${path}/body`)
  if (utf8Length(body) > MAX_PAYLOAD_BYTES) fail(`${path}/body`, 'source body above 8 MiB')
}

const FIELD_CHECKS = new Map<string, FieldCheck>([
  ['attrs', checkAttrs],
  ['pos', checkPosition],
  ['segments', (value, path, walk) => requireArray(value, path).forEach((range, index) => checkPosition(range, `${path}/${index}`, walk))],
  ['data', checkData],
  ['metadata', checkMetadata],
  ['props', checkObject],
  ['source', checkSource],
  ['marker', checkMarker],
  ['task', checkTask],
  ['options', checkOptions],
  ['locator', checkLocator],
  ['longDescription', nodeList('blocks')],
  ['headerIds', checkHeaderIds],
  ['title', checkTitle],
  ['caption', (value, path, walk) => checkNode(value, path, ['caption'], walk)],
  ['fallback', (value, path, walk, node) => {
    const qualified = typeof node['name'] === 'string' && node['name'].includes('.')
    const inner: Walk = { ...walk, coreFallback: walk.coreFallback || qualified,
      fallbacks: walk.fallbacks + (node['type'] === 'inline_extension' && !qualified ? 1 : 0) }
    const role = node['type'] === 'block_extension' ? BLOCKS : INLINES
    const allowed = qualified
      ? role.filter((type) => type !== 'block_extension' && type !== 'inline_extension') : role
    checkList(value, path, allowed, inner)
  }],
  ['columns', nodeList(['table_column'])],
  ['pairs', nodeList(['ruby_pair'])],
  ['slots', checkSlots],
  ['stages', checkStages],
  ['resources', checkResources],
  ['extensions', checkExtensions],
  ['payload', checkPayload],
  ['resourceIds', (value, path, walk) => requireArray(value, path).forEach((id, index) => addReference(id, `${path}/${index}`, walk))],
])
for (const name of INLINE_SLOTS) FIELD_CHECKS.set(name, nodeList('inlines'))

function allowedTypes(content: Content): readonly string[] {
  if (content === 'blocks') return BLOCKS
  return content === 'inlines' ? INLINES : content === 'none' ? [] : content
}

function checkList(value: Value, path: string, content: Content, walk: Walk, parent?: Walk['parent']): void {
  const allowed = allowedTypes(content)
  const inner: Walk = { depth: walk.depth + 1, fallbacks: walk.fallbacks, tree: walk.tree,
    ...(walk.coreFallback === undefined ? {} : { coreFallback: walk.coreFallback }),
    ...(parent === undefined ? {} : { parent }) }
  requireArray(value, path).forEach((child, index) => checkNode(child, `${path}/${index}`, allowed, inner))
}

/** C2-A-105, C2-A-120 and the other rules that tie two fields of one node together. */
function checkDependencies(node: Fields, type: string, path: string, walk: Walk): void {
  if (type === 'link' || type === 'image') checkLinkFields(node, type, path)
  if (type === 'math' && (node['number'] === undefined) !== (node['numberPrefix'] === undefined)) {
    fail(path, 'number and numberPrefix stand together')
  }
  if (type === 'inline_extension' || type === 'block_extension') checkExtensionName(node, type, path, walk)
}

function checkLinkFields(node: Fields, type: string, path: string): void {
  const present = ['key', 'namespace', 'refForm'].filter((name) => node[name] !== undefined).length
  if (present !== 0 && present !== 3) fail(path, 'key, namespace and refForm stand together or not at all')
  if (type === 'image' && (node['alt'] !== undefined) === (node['decorative'] === true)) {
    fail(path, 'decorative is true exactly when alt is absent')
  }
}

function checkExtensionName(node: Fields, type: string, path: string, walk: Walk): void {
  const name = node['name']
  if (typeof name !== 'string') fail(`${path}/name`, 'not an extension name')
  checkExtensionIdentity(node, type, path, walk, name)
  checkExtensionSource(node, type, path)
  checkExtensionDefinition(node, path, walk, name)
}

function checkExtensionIdentity(node: Fields, type: string, path: string, walk: Walk, name: string): void {
  const qualified = name.includes('.')
  const unqualifiedSource = type === 'inline_extension' && name.startsWith('_') && validSegment(`a${name.slice(1)}`)
  if (!validName(name, type === 'block_extension') && !unqualifiedSource) fail(`${path}/name`, 'not an extension name')
  if (qualified && !walk.tree.declarations.has(name)) fail(`${path}/name`, 'an undeclared extension name')
  if (qualified && node['fallback'] === undefined) fail(`${path}/fallback`, 'a required field is missing')
  if (qualified && node['version'] !== walk.tree.declarations.get(name)?.version) {
    fail(`${path}/version`, 'version differs from declaration')
  }
  if (!qualified && node['version'] !== undefined) fail(`${path}/version`, 'an unqualified extension has no version')
}

function checkExtensionSource(node: Fields, type: string, path: string): void {
  if (node['source'] !== undefined && isRecord(node['source'])) {
    const form = node['source']['form']
    if (form === 'inline' && type !== 'inline_extension') fail(`${path}/source/form`, 'inline source on a block extension')
    if (form !== 'inline' && type !== 'block_extension') fail(`${path}/source/form`, 'block source on an inline extension')
  }
}

function checkExtensionDefinition(node: Fields, path: string, walk: Walk, name: string): void {
  const definition = walk.tree.registry.get(name)
  if (definition?.children === 'none' && Array.isArray(node['children']) && node['children'].length > 0) {
    fail(`${path}/children`, 'extension children must be empty')
  }
  const parent = definition?.parent
  if (parent !== undefined && (parent.name !== walk.parent?.name || parent.slot !== walk.parent.slot)) {
    fail(path, 'extension stands outside its parent slot')
  }
  if (definition !== undefined && node['props'] !== undefined && isRecord(node['props'])) checkProps(node['props'], path, definition)
}

function checkProps(props: Fields, path: string, definition: ExtensionDefinition): void {
  for (const [key, value] of Object.entries(props)) {
    const kind = definition.props[key]
    const valid = kind === 'array' ? Array.isArray(value) : kind === 'object' ? isRecord(value) : typeof value === kind
    if (kind === undefined || !valid) fail(`${path}/props/${pointerKey(key)}`, 'invalid extension prop')
  }
}

function members(node: unknown, field: string): unknown[] {
  if (!isRecord(node)) return []
  const value = node[field]
  return Array.isArray(value) ? value : []
}

function tableRows(group: unknown): [Fields, number][] {
  return members(group, 'children').flatMap((row, index) => isRecord(row) && row['type'] === 'table_row' ? [[row, index]] : [])
}

function markRun(cells: unknown[], index: number, kind: string): number {
  let count = 0
  for (let at = index + 1; at < cells.length; at++) {
    const cell = cells[at]
    if (!isRecord(cell) || cell['span'] !== kind) break
    count++
  }
  return count
}

/** C2-A-093: a count authored alongside a mark agrees with the mark cells it covers. */
function checkSpanCounts(table: Fields, path: string): void {
  const groups = members(table, 'children')
  groups.forEach((group, groupIndex) => {
    const rows = tableRows(group)
    rows.forEach(([row, rowIndex], rowOffset) => {
      const cells = members(row, 'children')
      cells.forEach((cell, cellIndex) => {
        if (!isRecord(cell) || cell['span'] !== undefined) return
        const cellPath = `${path}/children/${groupIndex}/children/${rowIndex}/children/${cellIndex}`
        const cols = markRun(cells, cellIndex, 'colspan')
        if (cols > 0 && cell['colspan'] !== undefined && cell['colspan'] !== cols + 1) {
          fail(`${cellPath}/colspan`, 'a count contradicts its authored span mark')
        }
        let rowsBelow = 0
        for (let at = rowOffset + 1; at < rows.length; at++) {
          const below = members(rows[at]?.[0], 'children')[cellIndex]
          if (!isRecord(below) || below['span'] !== 'rowspan') break
          rowsBelow++
        }
        if (rowsBelow > 0 && cell['rowspan'] !== undefined && cell['rowspan'] !== rowsBelow + 1) {
          fail(`${cellPath}/rowspan`, 'a count contradicts its authored span mark')
        }
      })
    })
  })
}

/** C2-A-028, C2-A-169: nodes are closed. C2-A-139: a field that is absent is left out; it is never null. */
function checkField(node: Fields, type: string, rule: Rule, name: string, path: string, walk: Walk): void {
  const [, required, optional] = rule
  const value = node[name]
  const at = `${path}/${name}`
  if (!COMMON.includes(name) && !required.includes(name) && !optional.includes(name)) fail(at, `not a field of ${type}`)
  if (value === null || value === undefined) fail(at, 'a field without a value')
  if (!checkScalar(type, name, value, at)) FIELD_CHECKS.get(name)?.(value, at, walk, node)
  // C2-A-131: an image names a resource by its id; the string check above holds for it.
  if (name === 'resourceId') addReference(value, at, walk)
}

function checkFields(node: Fields, type: string, rule: Rule, path: string, walk: Walk): void {
  const [content, required] = rule
  for (const name of required) if (node[name] === undefined) fail(`${path}/${name}`, 'a required field is missing')
  for (const name of Object.keys(node)) if (name !== 'type' && name !== 'children') checkField(node, type, rule, name, path, walk)
  if (content !== 'none') checkList(node['children'], `${path}/children`, content, walk)
  else if (node['children'] !== undefined) fail(`${path}/children`, `${type} holds no children`)
}

function checkNode(value: Value, path: string, allowed: readonly string[], walk: Walk): void {
  if (walk.depth > MAX_TREE_DEPTH) fail(path, 'the tree is nested deeper than a parser can produce')
  if (!isRecord(value)) fail(path, 'not a node')
  const type = value['type']
  if (typeof type !== 'string') fail(path, 'a node without a type')
  const rule = RULES.get(type)
  // C2-A-018, C2-A-050: no other core type, the three retired ones included.
  if (rule === undefined) fail(path, `unknown node type ${type}`)
  // C2-A-051, C2-A-052: a type that exists only in its container is refused anywhere else.
  if (!allowed.includes(type)) fail(path, `${type} does not stand here`)
  if (walk.coreFallback && (type === 'inline_extension' || type === 'block_extension')) {
    fail(path, 'qualified fallback contains an extension node')
  }
  const current: Walk = walk
  checkFields(value, type, rule, path, current)
  checkDependencies(value, type, path, current)
  if (type === 'table') checkSpanCounts(value, path)
  if (type === 'table_cell') checkCellReferences(value, path, walk)
  checkNodeBounds(value, path, walk)
}

function checkCellReferences(value: Fields, path: string, walk: Walk): void {
  const attrs = value['attrs']
  if (value['header'] === true && isRecord(attrs) && typeof attrs['id'] === 'string') walk.tree.headerIds.add(attrs['id'])
  if (Array.isArray(value['headerIds'])) {
    value['headerIds'].forEach((id, index) => walk.tree.headerReferences.push([id as string, `${path}/headerIds/${index}`]))
  }
}

/** C2-A-014: `major.minor` without a leading zero. C2-A-018, C2-A-019: the major is 2; a higher minor is accepted. */
function checkVersion(value: Value, path: string): void {
  const version = requireString(value, path)
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) fail(path, 'not major.minor')
  if (version.split('.')[0] !== AST_VERSION.split('.')[0]) fail(path, `major version ${version.split('.')[0]!} is not read by this engine`)
}

// C2-A-132: the bounds on what a tree may carry besides its nodes.
const MAX_PAYLOAD_BYTES = 8 * 1024 * 1024
const MAX_RESOURCE_REFERENCES = 4096
const MAX_FALLBACK_DEPTH = 32

/** The UTF-8 bytes of a payload that `checkPayload` accepted: a string value as it is, any other value as JSON. */
function payloadBytes(node: Fields): number {
  let bytes = 0
  for (const entry of (node['payload'] ?? []) as { value?: unknown }[]) {
    const value = entry.value
    if (value !== undefined) bytes += utf8Length(typeof value === 'string' ? value : JSON.stringify(value))
  }
  return bytes
}

/** C2-A-132: the bounds that one node shows, and its share of the bounds of the whole tree. */
function checkNodeBounds(node: Fields, path: string, walk: Walk): void {
  if (node['payload'] !== undefined && payloadBytes(node) > MAX_PAYLOAD_BYTES) fail(`${path}/payload`, 'an extension payload above 8 MiB')
  const tree = walk.tree
  tree.resourceReferences += (node['resourceId'] === undefined ? 0 : 1) + ((node['resourceIds'] as unknown[] | undefined)?.length ?? 0)
  if (tree.resourceReferences > MAX_RESOURCE_REFERENCES) fail(path, 'more than 4096 resource references')
  if (walk.fallbacks > MAX_FALLBACK_DEPTH) fail(path, 'fallbacks are nested deeper than 32 unqualified inline extension nodes')
}

/** C2-A-131: every id a node names is that of an entry of the manifest. */
function checkReferences(document: Fields, tree: TreeFacts): void {
  const ids = new Set(((document['resources'] ?? []) as Fields[]).map((entry) => entry['id'] as string))
  for (const [id, path] of tree.references) if (!ids.has(id)) fail(path, `no resource has the id ${JSON.stringify(id)}`)
  for (const [id, path] of tree.headerReferences) {
    if (!tree.headerIds.has(id)) fail(path, `no header cell has the id ${JSON.stringify(id)}`)
  }
}

/** C2-A-203: ranges for an unchanged tree, addressed by node pointer and code point offset. */
export interface AnnotationRangeSidecar {
  ranges: { id: string, start: { path: string, offset: number }, end: { path: string, offset: number } }[]
}

function checkAnnotations(sidecar: AnnotationRangeSidecar, tree: TreeFacts): void {
  const ranges = new Map<string, AnnotationRangeSidecar['ranges'][number]>()
  sidecar.ranges.forEach((range, index) => {
    if (ranges.has(range.id)) fail(`/ranges/${index}/id`, 'duplicate annotation range id')
    ranges.set(range.id, range)
  })
  for (const [id, path] of tree.annotationIds) {
    const range = ranges.get(id)
    if (range === undefined) fail(path, `annotation ${JSON.stringify(id)} has no range`)
    const attached = [range.start.path, range.end.path].some((endpoint) => endpoint === path || endpoint.startsWith(`${path}/`))
    if (!attached) fail(path, `annotation ${JSON.stringify(id)} has no endpoint on this node or its descendants`)
  }
}

const ENVELOPE_FIELDS = ['astVersion', 'document', 'vocabulary', 'extensions']

/**
 * C2-A-012 to C2-A-019: refuses an envelope whose own fields a reader may not accept: a version it does not
 * read, an unknown required extension, or a field the envelope does not have. The tree inside is checked apart.
 */
export function validateEnvelope(envelope: Readonly<Record<string, unknown>>, extensions: readonly ExtensionDefinition[] = []): void {
  for (const name of Object.keys(envelope)) if (!ENVELOPE_FIELDS.includes(name)) fail(`/${name}`, 'not a field of the envelope')
  if (envelope['astVersion'] === undefined) fail('/astVersion', 'a required field is missing')
  checkVersion(envelope['astVersion'], '/astVersion')
  const document = envelope['document']
  if (isRecord(document) && document['astVersion'] !== envelope['astVersion']) {
    fail('/document/astVersion', 'the document and envelope versions differ')
  }
  if (envelope['vocabulary'] !== undefined) checkObject(envelope['vocabulary'], '/vocabulary')
  if (envelope['extensions'] !== undefined) {
    const tree: TreeFacts = { resourceReferences: 0, metadataFields: 0, annotationIds: new Map(), references: [], declarations: new Map(),
      registry: new Map(extensions.map((entry) => [entry.name, entry])), headerIds: new Set(),
      headerReferences: [], sourcePositions: undefined }
    checkExtensions(envelope['extensions'], '/extensions', { depth: 0, fallbacks: 0, tree })
  }
}

function sourcePositions(source: string): ReadonlyMap<number, readonly [number, number]> {
  const positions = new Map<number, readonly [number, number]>([[0, [1, 1]]])
  let offset = 0
  let line = 1
  let column = 1
  for (const char of source) {
    offset += utf8Length(char)
    if (char === '\n') { line++; column = 1 } else column++
    positions.set(offset, [line, column])
  }
  return positions
}

function combinedDeclarations(document: Fields, envelope?: Readonly<Record<string, unknown>>):
  [string, { version: string, required: boolean, slots: readonly string[] }][] {
  const root = declaredNames(document['extensions'])
  const outside = declaredNames(envelope?.['extensions'])
  for (const [name, outer] of outside) {
    const inner = root.find(([candidate]) => candidate === name)?.[1]
    if (inner !== undefined && (inner.version !== outer.version || inner.required !== outer.required ||
      inner.slots.length !== outer.slots.length || inner.slots.some((slot, index) => slot !== outer.slots[index]))) {
      fail('/extensions', `the root and envelope declarations of ${name} differ`)
    }
  }
  return [...root, ...outside]
}

/** Refuses `document` unless it is a tree of contract 2.0. */
export function validateTree(
  document: unknown, envelope?: Readonly<Record<string, unknown>>, source?: string,
  extensions: readonly ExtensionDefinition[] = [],
  annotations?: AnnotationRangeSidecar,
): asserts document is DocumentNode {
  // C2-A-168.
  if (!isRecord(document)) fail('', 'not a tree')
  if (document['type'] !== 'document') fail('/type', 'the root is not a document')
  if (document['children'] === undefined) fail('/children', 'the root has no children')
  checkVersion(document['astVersion'], '/astVersion')
  const declarations = combinedDeclarations(document, envelope)
  const tree: TreeFacts = { resourceReferences: 0, metadataFields: 0, annotationIds: new Map(), references: [],
    declarations: new Map(declarations),
    registry: new Map(extensions.map((entry) => [entry.name, entry])),
    headerIds: new Set(), headerReferences: [], sourcePositions: source === undefined ? undefined : sourcePositions(source) }
  if (source !== undefined && document['srcByteLength'] !== undefined && document['srcByteLength'] !== utf8Length(source)) {
    fail('/srcByteLength', 'the byte count disagrees with the source')
  }
  checkFields(document, 'document', RULES.get('document')!, '', { depth: 0, fallbacks: 0, tree })
  // C2-A-052: definitions and frontmatter are children of the document and of nothing else.
  const children = document['children'] as Fields[]
  children.forEach((child, index) => {
    // C2-A-049.
    if (child['type'] === 'frontmatter' && index > 0) fail(`/children/${index}`, 'frontmatter is not the first child')
  })
  checkNodeBounds(document, '', { depth: 0, fallbacks: 0, tree })
  checkReferences(document, tree)
  if (annotations !== undefined) checkAnnotations(annotations, tree)
}

/** C2-A-203: validates a tree together with its annotation-range sidecar. */
export function validateTreeWithAnnotations(document: unknown, annotations: AnnotationRangeSidecar,
  envelope?: Readonly<Record<string, unknown>>, source?: string,
  extensions: readonly ExtensionDefinition[] = []): asserts document is DocumentNode {
  validateTree(document, envelope, source, extensions, annotations)
}
