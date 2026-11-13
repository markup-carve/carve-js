// The reader side of contract 2.0 (C2-A-167 to C2-A-171): a tree that the tree document refuses
// fails with a typed error that names what was wrong and the path of the node.
import { AST_VERSION, type AstNode } from './ast.ts'
import { MAX_DEPTH } from './state.ts'
import { TASK_STATUS } from './tree-tables.ts'

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
type Content = 'blocks' | 'inlines' | 'none' | readonly string[]

/** The row of one node type in the table of C2-A-050: its children, its required and its optional fields. */
type Rule = readonly [Content, readonly string[], readonly string[]]

const REFERENCE = ['key', 'namespace']
const EXTENSION = ['version', 'props', 'slots', 'payload', 'resourceIds']

const RULES = new Map<string, Rule>([
  ['abbreviation', ['none', REFERENCE, ['expansion']]],
  ['abbreviation_def', ['none', ['expansion', ...REFERENCE], []]],
  ['admonition', ['blocks', ['kind'], ['title', 'groupLabel']]],
  ['autolink', ['none', ['href'], ['text']]],
  ['block_extension', ['blocks', ['name', 'fallback'], EXTENSION]],
  ['block_quote', ['blocks', [], []]],
  ['caption', ['blocks', [], ['short']]],
  ['caption_number', ['none', [], ['n']]],
  ['cell_paragraph', ['inlines', [], ['blockImage']]],
  ['citation', ['none', ['key', 'suppressAuthor', 'namespace'], ['prefix', 'locator', 'locatorLabel', 'locatorValue', 'suffix', 'mode', 'number', 'useIndex']]],
  ['citation_definition', ['inlines', REFERENCE, []]],
  ['citation_group', [['citation'], ['raw'], ['mode']]],
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
  ['document', [[...BLOCKS, 'footnote', 'link_reference_definition', 'abbreviation_def', 'citation_definition', 'frontmatter'], ['astVersion'], ['srcByteLength', 'extensions', 'stages', 'resources']]],
  ['emphasis', ['inlines', [], []]],
  ['figure', ['blocks', [], ['caption', 'kind']]],
  ['figure_group', ['blocks', [], ['caption']]],
  ['footnote', ['blocks', REFERENCE, []]],
  ['footnote_ref', ['none', REFERENCE, ['number']]],
  ['frontmatter', ['none', ['format', 'value'], []]],
  ['hard_break', ['none', [], []]],
  ['heading', ['inlines', ['level'], ['generatedId']]],
  ['highlight', ['inlines', [], []]],
  ['image', ['none', [], ['src', 'alt', 'decorative', 'tooltip', 'targetKind', 'key', 'namespace', 'resourceId', 'form']]],
  ['include', ['none', ['path'], ['section', 'options']]],
  ['inline_extension', ['inlines', ['name'], [...EXTENSION, 'fallback']]],
  ['inline_footnote', ['inlines', [], ['number']]],
  ['insert', ['inlines', [], []]],
  ['line', ['inlines', [], []]],
  ['line_block', [['line'], [], []]],
  ['link', ['inlines', [], ['href', 'tooltip', 'targetKind', 'key', 'namespace', 'form']]],
  ['link_reference_definition', ['none', ['href', ...REFERENCE], ['title']]],
  ['list', [['list_item'], ['marker', 'spacing'], []]],
  ['list_item', ['blocks', [], ['task']]],
  ['literal_inline', ['none', ['value'], []]],
  ['math', ['none', ['display', 'value'], ['number', 'numberPrefix']]],
  ['mention', ['none', ['target', 'kind'], ['label']]],
  ['non_breaking_space', ['none', [], []]],
  ['paragraph', ['inlines', [], ['blockImage', 'blockMath']]],
  ['raw_block', ['none', ['format', 'value'], []]],
  ['raw_inline', ['none', ['format', 'value'], []]],
  ['ruby', ['none', ['pairs'], []]],
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
  ['table_cell', [[...BLOCKS, 'cell_paragraph'], ['header'], ['span', 'colspan', 'rowspan', 'align', 'valign']]],
  ['table_column', ['none', [], ['align', 'valign', 'width', 'resolvedAlign', 'authored']]],
  ['table_foot', [['table_row', 'comment'], [], []]],
  ['table_head', [['table_row', 'comment'], [], []]],
  ['table_row', [['table_cell'], [], []]],
  ['tag', ['none', ['name'], []]],
  ['text', ['none', ['value'], []]],
  ['thematic_break', ['none', [], []]],
  ['underline', ['inlines', [], []]],
  ['xref', ['none', REFERENCE, ['href', 'form']]],
])

const STRINGS = [
  'key', 'namespace', 'expansion', 'kind', 'groupLabel', 'href', 'text', 'name', 'version', 'raw', 'syntax', 'form',
  'tocTarget', 'generatedId', 'src', 'alt', 'tooltip', 'targetKind', 'resourceId', 'path', 'section', 'spacing',
  'numberPrefix', 'target', 'label', 'format', 'glyph', 'source', 'span', 'align', 'valign', 'resolvedAlign',
  'mode', 'locatorLabel', 'locatorValue', 'value', 'astVersion', 'lang',
]
const INTEGERS = ['n', 'number', 'level', 'headRows', 'rowHeadColumns', 'colspan', 'rowspan', 'srcByteLength']
const BOOLEANS = ['display', 'header', 'decorative', 'suppressAuthor', 'useIndex']
const TRUE_ONLY = ['blockImage', 'blockMath', 'authored']
const INLINE_SLOTS = ['short', 'prefix', 'locator', 'suffix']
const POSITION_FIELDS = ['startLine', 'endLine', 'startColumn', 'endColumn', 'startOffset', 'endOffset']

// The values of the fields that take one of a fixed set, by node type and field; `*` is every type.
const ENUMS = new Map<string, readonly string[]>([
  ['*.dir', ['ltr', 'rtl', 'auto']],
  ['comment.form', ['block', 'line', 'braced']],
  ['link.form', ['full', 'collapsed']],
  ['image.form', ['full', 'collapsed']],
  ['xref.form', ['number', 'page', 'title', 'full']],
  ['list.spacing', ['tight', 'loose']],
  ['table_cell.span', ['rowspan', 'colspan']],
  ['table_cell.align', ['left', 'right', 'center']],
  ['table_column.align', ['left', 'right', 'center']],
  ['table_column.resolvedAlign', ['left', 'right', 'center']],
  ['link.targetKind', ['url', 'wiki', 'doc', 'xref']],
  ['image.targetKind', ['url', 'wiki', 'doc', 'xref']],
  ['directive.tocTarget', ['headings', 'figures', 'tables', 'listings']],
  ['directive.kind', ['bibliography', 'footnotes', 'glossary', 'index', 'references', 'toc']],
  ['figure.kind', ['image', 'table', 'listing', 'equation', 'other']],
  ['admonition.kind', ['note', 'tip', 'warning', 'danger', 'info', 'success', 'example', 'quote']],
  ['*.namespace', ['link', 'footnote', 'citation', 'abbr', 'heading']],
])
const STAGES = ['referenceResolution', 'tableAlignment']
const ORDERED_STYLES = ['1', 'a', 'A', 'i', 'I']

type Value = unknown
type Fields = Record<string, Value>

function fail(path: string, reason: string): never {
  throw new CarveTreeError(path, reason)
}

function isObject(value: Value): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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

/** C2-A-032, C2-A-034: an optional id, a list of classes and a list of pairs; `id` and `class` are no keys. */
function checkAttrs(value: Value, path: string): void {
  if (!isObject(value)) fail(path, 'attrs is not an object')
  for (const name of Object.keys(value)) {
    if (name !== 'id' && name !== 'classes' && name !== 'keyValues') fail(`${path}/${name}`, 'unknown field of attrs')
  }
  if (value['id'] !== undefined) requireString(value['id'], `${path}/id`)
  if (value['classes'] !== undefined) requireArray(value['classes'], `${path}/classes`).forEach((name, index) => requireString(name, `${path}/classes/${index}`))
  if (value['keyValues'] === undefined) return
  checkPairs(value['keyValues'], `${path}/keyValues`)
  for (const [key] of value['keyValues'] as [string, string][]) {
    const name = key.toLowerCase()
    if (name === 'id' || name === 'class') fail(`${path}/keyValues`, `the key ${key} folds into the id or the classes`)
  }
}

/** C2-A-139, C2-A-140: six integers, never null, with the start not behind the end. */
function checkPosition(value: Value, path: string): void {
  if (!isObject(value)) fail(path, 'pos is not an object')
  for (const name of POSITION_FIELDS) {
    if (!Number.isInteger(value[name])) fail(`${path}/${name}`, 'not an integer')
  }
  for (const name of Object.keys(value)) {
    if (!POSITION_FIELDS.includes(name) && name !== 'file') fail(`${path}/${name}`, 'unknown field of pos')
  }
  if ((value['startOffset'] as number) > (value['endOffset'] as number)) fail(path, 'the start lies behind the end')
}

/** C2-A-054 to C2-A-058. */
function checkMarker(value: Value, path: string): void {
  if (!isObject(value)) fail(path, 'marker is not an object')
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
  if (value['delimiter'] !== undefined && value['delimiter'] !== '.' && value['delimiter'] !== ')') fail(`${path}/delimiter`, 'unknown delimiter')
  if (value['start'] !== undefined && !Number.isInteger(value['start'])) fail(`${path}/start`, 'not an integer')
}

/** C2-A-060, C2-A-061: the status follows from the mark. */
function checkTask(value: Value, path: string): void {
  if (!isObject(value)) fail(path, 'task is not an object')
  const status = TASK_STATUS.get(value['mark'] as string)
  if (status === undefined) fail(`${path}/mark`, 'unknown task mark')
  if (value['status'] !== status) fail(`${path}/status`, 'the status does not follow from the mark')
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
  if (name === 'width') return isWidth(value) || fail(path, 'not a fraction above 0 and at most 1')
  if (TRUE_ONLY.includes(name)) return value === true || fail(path, 'not true')
  if (BOOLEANS.includes(name)) return typeof value === 'boolean' || fail(path, 'not a boolean')
  if (INTEGERS.includes(name)) return (Number.isInteger(value) && (value as number) >= 0) || fail(path, 'not a count')
  if (!STRINGS.includes(name) && name !== 'dir') return false
  requireString(value, path)
  checkEnum(type, name, value, path)
  return true
}

type FieldCheck = (value: Value, path: string, depth: number, node: Fields) => void

function nodeList(content: Content): FieldCheck {
  return (value, path, depth) => checkList(value, path, content, depth)
}

function checkTitle(value: Value, path: string, depth: number, node: Fields): void {
  // C2-A-077: the title of a link definition is a string; every other title is a list of inlines.
  if (node['type'] === 'link_reference_definition') requireString(value, path)
  else checkList(value, path, 'inlines', depth)
}

function checkStages(value: Value, path: string): void {
  requireArray(value, path).forEach((stage, index) => {
    if (!STAGES.includes(stage as string)) fail(`${path}/${index}`, 'unknown stage')
  })
}

function checkPairsOfRuby(value: Value, path: string, depth: number): void {
  requireArray(value, path).forEach((pair, index) => {
    if (!isObject(pair) || pair['type'] !== 'rubyPair') fail(`${path}/${index}`, 'not a rubyPair')
    checkList(pair['base'], `${path}/${index}/base`, 'inlines', depth)
    checkList(pair['annotation'], `${path}/${index}/annotation`, 'inlines', depth)
  })
}

function checkSlots(value: Value, path: string, depth: number, node: Fields): void {
  if (!isObject(value)) fail(path, 'slots is not an object')
  const content = node['type'] === 'block_extension' ? 'blocks' : 'inlines'
  for (const [name, slot] of Object.entries(value)) checkList(slot, `${path}/${name}`, content, depth)
}

/** C2-A-131: every entry has an id, a media type and a digest, and no id occurs twice. */
function checkResources(value: Value, path: string): void {
  const seen = new Set<string>()
  requireArray(value, path).forEach((entry, index) => {
    if (!isObject(entry)) fail(`${path}/${index}`, 'not a resource')
    const id = requireString(entry['id'], `${path}/${index}/id`)
    requireString(entry['mediaType'], `${path}/${index}/mediaType`)
    if (!/^sha256:[0-9a-f]{64}$/.test(requireString(entry['digest'], `${path}/${index}/digest`))) fail(`${path}/${index}/digest`, 'not a sha256 digest')
    if (seen.has(id)) fail(`${path}/${index}/id`, 'a duplicate resource id')
    seen.add(id)
  })
}

/** C2-A-017: a qualified name, a boolean `required` and an optional version. */
function checkExtensions(value: Value, path: string): void {
  requireArray(value, path).forEach((entry, index) => {
    if (!isObject(entry)) fail(`${path}/${index}`, 'not an extension declaration')
    requireString(entry['name'], `${path}/${index}/name`)
    if (typeof entry['required'] !== 'boolean') fail(`${path}/${index}/required`, 'not a boolean')
    // C2-A-018: this reader knows no extension, so a required one is unknown.
    if (entry['required'] === true) fail(`${path}/${index}`, 'an unknown required extension')
  })
}

function checkObject(value: Value, path: string): void {
  if (!isObject(value)) fail(path, 'not an object')
}

const FIELD_CHECKS = new Map<string, FieldCheck>([
  ['attrs', checkAttrs],
  ['pos', checkPosition],
  ['segments', (value, path) => requireArray(value, path).forEach((range, index) => checkPosition(range, `${path}/${index}`))],
  ['data', checkObject],
  ['metadata', checkObject],
  ['props', checkObject],
  ['marker', checkMarker],
  ['task', checkTask],
  ['options', checkPairs],
  ['title', checkTitle],
  ['caption', (value, path, depth) => checkNode(value, path, ['caption'], depth)],
  ['fallback', (value, path, depth, node) => checkList(value, path, node['type'] === 'block_extension' ? 'blocks' : 'inlines', depth)],
  ['columns', nodeList(['table_column'])],
  ['pairs', checkPairsOfRuby],
  ['slots', checkSlots],
  ['stages', checkStages],
  ['resources', checkResources],
  ['extensions', checkExtensions],
  ['payload', (value, path) => void requireArray(value, path)],
  ['resourceIds', (value, path) => requireArray(value, path).forEach((id, index) => requireString(id, `${path}/${index}`))],
])
for (const name of INLINE_SLOTS) FIELD_CHECKS.set(name, nodeList('inlines'))

function allowedTypes(content: Content): readonly string[] {
  if (content === 'blocks') return BLOCKS
  return content === 'inlines' ? INLINES : content === 'none' ? [] : content
}

function checkList(value: Value, path: string, content: Content, depth: number): void {
  const allowed = allowedTypes(content)
  requireArray(value, path).forEach((child, index) => checkNode(child, `${path}/${index}`, allowed, depth + 1))
}

/** C2-A-105, C2-A-120 and the other rules that tie two fields of one node together. */
function checkDependencies(node: Fields, type: string, path: string): void {
  if (type === 'link' || type === 'image') {
    const present = ['key', 'namespace', 'form'].filter((name) => node[name] !== undefined).length
    if (present !== 0 && present !== 3) fail(path, 'key, namespace and form stand together or not at all')
  }
  if (type === 'citation_group' && node['mode'] !== undefined) {
    const items = node['children'] as Fields[]
    if (items.some((item) => item['mode'] === undefined)) fail(path, 'a group mode needs a mode on every citation')
  }
}

function checkFields(node: Fields, type: string, rule: Rule, path: string, depth: number): void {
  const [content, required, optional] = rule
  for (const name of required) if (node[name] === undefined) fail(`${path}/${name}`, 'a required field is missing')
  for (const [name, value] of Object.entries(node)) {
    if (name === 'type' || name === 'children') continue
    // C2-A-028, C2-A-169: nodes are closed.
    if (!COMMON.includes(name) && !required.includes(name) && !optional.includes(name)) fail(`${path}/${name}`, `not a field of ${type}`)
    // C2-A-139: a field that is absent is left out; it is never null.
    if (value === null || value === undefined) fail(`${path}/${name}`, 'a field without a value')
    if (!checkScalar(type, name, value, `${path}/${name}`)) FIELD_CHECKS.get(name)?.(value, `${path}/${name}`, depth, node)
  }
  if (content === 'none') {
    if (node['children'] !== undefined) fail(`${path}/children`, `${type} holds no children`)
  } else {
    checkList(node['children'], `${path}/children`, content, depth)
  }
}

function checkNode(value: Value, path: string, allowed: readonly string[], depth: number): void {
  if (depth > MAX_TREE_DEPTH) fail(path, 'the tree is nested deeper than a parser can produce')
  if (!isObject(value)) fail(path, 'not a node')
  const type = value['type']
  if (typeof type !== 'string') fail(path, 'a node without a type')
  const rule = RULES.get(type)
  // C2-A-018, C2-A-050: no other core type, the three retired ones included.
  if (rule === undefined) fail(path, `unknown node type ${type}`)
  // C2-A-051, C2-A-052: a type that exists only in its container is refused anywhere else.
  if (!allowed.includes(type)) fail(path, `${type} does not stand here`)
  checkFields(value, type, rule, path, depth)
  checkDependencies(value, type, path)
}

/** C2-A-014: `major.minor` without a leading zero. C2-A-018, C2-A-019: the major is 2; a higher minor is accepted. */
function checkVersion(value: Value, path: string): void {
  const version = requireString(value, path)
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) fail(path, 'not major.minor')
  if (version.split('.')[0] !== AST_VERSION.split('.')[0]) fail(path, `major version ${version.split('.')[0]!} is not read by this engine`)
}

// C2-A-132: the bounds on what a tree may carry besides its nodes.
const MAX_PAYLOAD_BYTES = 8 * 1024 * 1024
const MAX_METADATA_DEPTH = 64
const MAX_RESOURCE_REFERENCES = 4096
const MAX_FALLBACK_DEPTH = 32

/** What the walk for the bounds has counted so far. */
interface Budget {
  resourceReferences: number
}

function metadataDepth(value: Value, path: string, depth: number): void {
  if (typeof value !== 'object' || value === null) return
  if (depth > MAX_METADATA_DEPTH) fail(path, 'metadata is nested deeper than 64 levels')
  for (const [name, inner] of Object.entries(value)) metadataDepth(inner, `${path}/${name}`, depth + 1)
}

function payloadBytes(node: Fields): number {
  const payload = (node['payload'] ?? []) as { value?: unknown }[]
  return payload.reduce((bytes, entry) => bytes + (typeof entry.value === 'string' ? entry.value.length : 0), 0)
}

function checkNodeBounds(node: Fields, path: string, budget: Budget, fallbacks: number): void {
  if (node['metadata'] !== undefined) metadataDepth(node['metadata'], `${path}/metadata`, 1)
  if (payloadBytes(node) > MAX_PAYLOAD_BYTES) fail(`${path}/payload`, 'an extension payload above 8 MiB')
  budget.resourceReferences += (node['resourceId'] === undefined ? 0 : 1) + ((node['resourceIds'] as unknown[] | undefined)?.length ?? 0)
  if (budget.resourceReferences > MAX_RESOURCE_REFERENCES) fail(path, 'more than 4096 resource references')
  if (fallbacks > MAX_FALLBACK_DEPTH) fail(path, 'fallbacks are nested deeper than 32 extension nodes')
}

/** C2-A-132: walks the validated tree once more for the bounds that no single node shows. */
function checkBounds(node: Fields, path: string, budget: Budget, fallbacks: number): void {
  checkNodeBounds(node, path, budget, fallbacks)
  for (const slot of ['children', 'fallback', 'title', 'short']) {
    const list = node[slot]
    if (!Array.isArray(list)) continue
    const inner = slot === 'fallback' ? fallbacks + 1 : fallbacks
    list.forEach((child, index) => checkBounds(child as Fields, `${path}/${slot}/${index}`, budget, inner))
  }
  if (isObject(node['caption'])) checkBounds(node['caption'], `${path}/caption`, budget, fallbacks)
}

/** Refuses `document` unless it is a tree of contract 2.0. */
export function validateTree(document: unknown): asserts document is AstNode {
  // C2-A-168.
  if (!isObject(document)) fail('', 'not a tree')
  if (document['type'] !== 'document') fail('/type', 'the root is not a document')
  if (document['children'] === undefined) fail('/children', 'the root has no children')
  checkVersion(document['astVersion'], '/astVersion')
  checkFields(document, 'document', RULES.get('document')!, '', 0)
  // C2-A-052: definitions and frontmatter are children of the document and of nothing else.
  const children = document['children'] as Fields[]
  children.forEach((child, index) => {
    // C2-A-049.
    if (child['type'] === 'frontmatter' && index > 0) fail(`/children/${index}`, 'frontmatter is not the first child')
  })
  checkBounds(document, '', { resourceReferences: 0 }, 0)
}
