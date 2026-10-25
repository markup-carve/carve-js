import type { Document, Position } from '../ast.js'
import { positionToBytes } from './source-bytes.js'
import { entriesToWire, isRuntimeEntry } from './definition-list-wire.js'
import type { DefinitionItem } from '../ast.js'

type Item = Record<string, unknown>
const originalExtension = Symbol('ast extension wire node')

/** Wire type names 2.0 renamed; the runtime tree keeps the old names. */
export const RUNTIME_TYPE_FOR_WIRE: Readonly<Record<string, string>> = {
  xref: 'heading_ref',
  critic_substitution: 'substitution',
}

/** Wire node types with no runtime node: the boundary builds and dissolves them. */
export const WIRE_ONLY_TYPES: ReadonlySet<string> = new Set([
  'caption', 'cell_paragraph', 'ruby_pair', 'table_body', 'table_column', 'table_foot', 'table_head',
])

/** Runtime owners for wire child slots that change shape at the boundary. */
export const RUNTIME_SLOTS_FOR_WIRE: Readonly<Record<string, readonly string[]>> = {
  'block_extension.children': [], 'block_extension.slots': [],
  'code_block.title': [],
  'citation_group.children': ['items'],
  'definition_list.children': ['items'],
  'figure.caption': ['caption', 'shortCaption'], 'figure.children': ['target'],
  'inline_extension.children': ['content'], 'inline_extension.fallback': [],
  'inline_extension.slots': [],
  'inline_footnote.children': ['inline'],
  'list.children': ['items'],
  'table.caption': ['caption', 'shortCaption'], 'table.children': ['rows'],
  'table.columns': [],
  'table_cell.children': ['blocks', 'children'],
  'table_row.children': ['cells'],
}

export function runtimeSlotsForWire(type: string, field: string): readonly string[] {
  return RUNTIME_SLOTS_FOR_WIRE[`${type}.${field}`] ?? [field]
}

function relocateSlot(node: Item, type: string, wireField: string, toWire: boolean): void {
  const [runtimeField] = runtimeSlotsForWire(type, wireField)
  if (runtimeField !== undefined) relocate(node, toWire ? runtimeField : wireField,
    toWire ? wireField : runtimeField)
}

export function savedExtension(node: object): Item | undefined {
  return (node as Item & { [originalExtension]?: Item })[originalExtension]
}

export function saveExtension(node: object, value: Item): void {
  Object.defineProperty(node, originalExtension, { value, configurable: true })
}

const referenceFields: Record<string, [string, string]> = {
  abbreviation: ['abbr', 'abbr'], abbreviation_def: ['abbr', 'abbr'],
  footnote: ['label', 'footnote'], footnote_ref: ['label', 'footnote'],
  link_reference_definition: ['label', 'link'], citation: ['key', 'citation'],
  citation_definition: ['key', 'citation'], link: ['ref', 'link'], image: ['ref', 'link'],
}
const taskStatus: Record<string, string> = {
  ' ': 'todo', x: 'done', '-': 'cancelled', _: 'partial', '>': 'partial', '?': 'other',
}

function relocate(node: Item, previous: string, current: string): void {
  if (previous === current) return
  if (Object.hasOwn(node, previous)) {
    node[current] = node[previous]
    delete node[previous]
  }
}

function caption(children: unknown[], short?: unknown): Item {
  return { type: 'caption', children: [{ type: 'paragraph', children }], ...(short === undefined ? {} : { short }) }
}

function tableToContract2(node: Item): void {
  const rows = node.rows as Item[]
  const groups = node.rowGroups as Item | undefined
  const children: Item[] = []
  if (groups) {
    let cursor = 0
    const take = (count: number): Item[] => {
      const part = rows.slice(cursor, cursor + count)
      cursor += count
      return part
    }
    const headRows = Number(groups.headRows ?? 0)
    if (headRows || groups.headAttrs) children.push({ type: 'table_head', children: take(headRows), ...(groups.headAttrs ? { attrs: groups.headAttrs } : {}) })
    for (const body of (groups.bodies as Item[]) ?? []) {
      const count = Number(body.headRows ?? 0) + Number(body.bodyRows ?? 0)
      children.push({ type: 'table_body', children: take(count), headRows: body.headRows ?? 0,
        ...(body.rowHeadColumns === undefined ? {} : { rowHeadColumns: body.rowHeadColumns }),
        ...(body.attrs === undefined ? {} : { attrs: body.attrs }) })
    }
    const footRows = Number(groups.footRows ?? 0)
    if (footRows || groups.footAttrs) children.push({ type: 'table_foot', children: take(footRows), ...(groups.footAttrs ? { attrs: groups.footAttrs } : {}) })
  } else {
    let head = 0
    while (head < rows.length && (rows[head]?.children as Item[] | undefined)?.every(cell => cell.header) && (rows[head]?.children as Item[]).length) head++
    if (head) children.push({ type: 'table_head', children: rows.slice(0, head) })
    children.push({ type: 'table_body', children: rows.slice(head) })
  }
  node.children = children
  delete node.rows
  delete node.rowGroups
  const authored = (node.columns as Item[] | undefined) ?? []
  const width = Math.max(authored.length, ...rows.map(row => (row.children as Item[] | undefined)?.length ?? 0), 0)
  const columns: Item[] = Array.from({ length: width }, (_, index) => ({ type: 'table_column',
    ...(authored[index] ? { authored: true, ...authored[index] } : {}) }))
  const header = rows.find(row => (row.children as Item[] | undefined)?.some(cell => cell.header))
  ;(header?.children as Item[] | undefined)?.forEach((cell, index) => {
    if (cell.header && cell.align && !cell.span && !cell.colspan && columns[index]) columns[index].resolvedAlign = cell.align
  })
  for (const column of columns) if (column.resolvedAlign === undefined && column.align !== undefined) column.resolvedAlign = column.align
  node.columns = columns
  if (node.caption !== undefined || node.shortCaption !== undefined) {
    node.caption = caption((node.caption as unknown[] | undefined) ?? [], node.shortCaption)
    delete node.shortCaption
  }
}

export function runtimeWireToContract2(input: Item, doc: Document): Item {
  const names = new Set<string>()
  const transform = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(transform)
    if (value === null || typeof value !== 'object') return value
    const saved = savedExtension(value)
    if (saved !== undefined) return saved
    const node: Item = Object.fromEntries(Object.entries(value).map(([key, child]) => [key, transform(child)]))
    if (typeof node.type !== 'string') return node
    if (node.pos !== undefined) node.pos = positionToBytes(doc, node.pos as Position)
    switch (node.type) {
      case 'document':
        node.astVersion = '2.0'
        node.stages ??= ['blockImagePromotion', 'referenceResolution', 'tableAlignment']
        break
      case 'list': {
        node.marker = node.ordered
          ? { kind: 'ordered', ...(node.olType === undefined ? {} : { style: node.olType }),
              ...(node.delim === undefined ? {} : { delimiter: node.delim }),
              ...(node.start === undefined || node.start === 1 ? {} : { start: node.start }),
              ...(node.bareMarker === undefined ? {} : { bare: node.bareMarker }) }
          : { kind: 'bullet', char: node.bulletChar ?? '-' }
        node.spacing = node.tight ? 'tight' : 'loose'
        relocateSlot(node, 'list', 'children', true)
        for (const key of ['ordered', 'tight', 'olType', 'delim', 'start', 'bareMarker', 'bulletChar']) delete node[key]
        break
      }
      case 'definition_list':
        if (Array.isArray(node.items)) {
          node.items = node.items.flatMap(entry => {
            if (!isRuntimeEntry(entry)) return [entry]
            return entriesToWire([entry as DefinitionItem]).map(wire => ({
              ...wire,
              ...(wire.pos === undefined ? {} : { pos: positionToBytes(doc, wire.pos) }),
            }))
          })
        }
        relocateSlot(node, 'definition_list', 'children', true)
        node.spacing = node.loose ? 'loose' : 'tight'
        delete node.loose
        break
      case 'list_item':
        if (node.checked !== undefined || node.taskState !== undefined) {
          const mark = String(node.taskState ?? (node.checked ? 'x' : ' '))
          node.task = { mark, status: taskStatus[mark] ?? 'other' }
        }
        delete node.checked
        delete node.taskState
        break
      case 'table': {
        tableToContract2(node)
        break
      }
      case 'table_row': relocateSlot(node, 'table_row', 'children', true); break
      case 'table_cell':
        if (node.blocks !== undefined) {
          relocate(node, 'blocks', 'children')
          node.sourceContent = 'blocks'
        } else {
          node.children = [{ type: 'cell_paragraph', children: node.children ?? [] }]
          node.sourceContent = 'inline'
        }
        break
      case 'figure':
        node.children = [node.target]
        delete node.target
        if (node.caption !== undefined || node.shortCaption !== undefined) node.caption = caption((node.caption as unknown[] | undefined) ?? [], node.shortCaption)
        delete node.shortCaption
        break
      case 'figure_group':
        if (node.caption !== undefined) node.caption = caption(node.caption as unknown[])
        break
      case 'citation_group': relocateSlot(node, 'citation_group', 'children', true); break
      case 'inline_footnote': relocateSlot(node, 'inline_footnote', 'children', true); break
      case 'comment':
        node.form = node.form ?? (node.block ? 'block' : node.delimited ? 'braced' : 'line')
        delete node.block
        delete node.delimited
        relocate(node, 'content', 'value')
        break
      case 'critic_comment': relocate(node, 'text', 'value'); break
      case 'smart_punctuation': relocate(node, 'value', 'source'); break
      case 'code_block':
        relocate(node, 'content', 'value')
        relocate(node, 'lang', 'syntax')
        if (node.header !== undefined) {
          node.title = [{ type: 'text', value: node.header }]
          delete node.header
        }
        relocate(node, 'label', 'groupLabel')
        break
      case 'math':
        relocate(node, 'content', 'value')
        relocate(node, 'label', 'numberPrefix')
        break
      case 'raw_block': case 'raw_inline': case 'literal_inline': case 'frontmatter':
        relocate(node, 'content', 'value')
        break
      case 'link': case 'image':
        if (node.ref !== undefined && node[node.type === 'link' ? 'href' : 'src'] === '' && node.resolved !== true) delete node[node.type === 'link' ? 'href' : 'src']
        delete node.resolved
        relocate(node, 'title', 'tooltip')
        break
      case 'heading_ref':
        node.type = 'xref'
        relocate(node, 'target', 'key')
        node.namespace = 'heading'
        break
      case 'mention':
        relocate(node, 'user', 'target')
        node.kind = 'user'
        break
      case 'div': case 'admonition': case 'directive':
        relocate(node, 'label', 'groupLabel')
        break
      case 'substitution': node.type = 'critic_substitution'; break
      case 'ruby':
        node.pairs = (node.pairs as Item[]).map(pair => ({ type: 'ruby_pair', ...pair }))
        break
      case 'inline_extension': case 'block_extension': {
        if (String(node.name).includes('.')) names.add(node.name as string)
        if (node.type === 'inline_extension') {
          relocateSlot(node, 'inline_extension', 'children', true)
        } else if (node.payload !== undefined) {
          node.payload = [node.payload]
        }
        break
      }
    }
    const reference = referenceFields[String(node.type)]
    if (reference) {
      relocate(node, reference[0], 'key')
      if (node.key !== undefined) node.namespace = reference[1]
    }
    return node
  }
  const result = transform(input) as Item
  if (names.size) {
    const declared = new Map(((result.extensions as Item[] | undefined) ?? []).map(entry => [String(entry.name), entry]))
    for (const name of names) if (!declared.has(name)) declared.set(name, { name, version: '0', required: false })
    result.extensions = [...declared.values()].sort((left, right) => String(left.name).localeCompare(String(right.name)))
  }
  return result
}

function captionInlines(value: unknown): unknown[] {
  if (!value || typeof value !== 'object') return []
  const children = (value as Item).children
  if (!Array.isArray(children)) return []
  const paragraph = children.find(child => child && typeof child === 'object' && child.type === 'paragraph')
  return Array.isArray(paragraph?.children) ? paragraph.children : []
}

export function contract2WireToRuntime(input: Item): Item {
  const transform = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(transform)
    if (!value || typeof value !== 'object') return value
    const node: Item = Object.fromEntries(Object.entries(value).map(([key, child]) => [key, transform(child)]))
    if (typeof node.type !== 'string') return node
    // Common 2.0 node facts also live on runtime nodes.
    switch (node.type) {
      case 'document':
        delete node.stages
        delete node.extensions
        delete node.astVersion
        break
      case 'list': {
        const marker = node.marker as Item
        node.ordered = marker.kind === 'ordered'
        node.tight = node.spacing === 'tight'
        relocateSlot(node, 'list', 'children', false)
        if (marker.kind === 'ordered') {
          if (marker.style !== undefined) node.olType = marker.style
          if (marker.delimiter !== undefined) node.delim = marker.delimiter
          if (marker.start !== undefined) node.start = marker.start
          if (marker.bare !== undefined) node.bareMarker = marker.bare
        } else if (marker.char !== '-') node.bulletChar = marker.char
        delete node.marker
        delete node.spacing
        break
      }
      case 'definition_list':
        relocateSlot(node, 'definition_list', 'children', false)
        if (node.spacing === 'loose') node.loose = true
        delete node.spacing
        break
      case 'list_item': {
        const task = node.task as Item | undefined
        if (task) {
          node.checked = task.mark === 'x'
          if (task.mark !== (node.checked ? 'x' : ' ')) node.taskState = task.mark
        }
        delete node.task
        break
      }
      case 'table': {
        const groups = (node.children as Item[]) ?? []
        node.rows = groups.flatMap(group => (group.children as Item[]) ?? [])
        const head = groups.find(group => group.type === 'table_head')
        const foot = groups.find(group => group.type === 'table_foot')
        const bodies = groups.filter(group => group.type === 'table_body')
        const inferred = groups.every((group, index) => !group.attrs && group.headRows === undefined && group.rowHeadColumns === undefined &&
          (group.type === 'table_head' ? index === 0 : group.type === 'table_body' && index === groups.length - 1))
        if (!inferred) node.rowGroups = {
          headRows: (head?.children as unknown[] | undefined)?.length ?? 0,
          ...(head?.attrs ? { headAttrs: head.attrs } : {}),
          bodies: bodies.map(body => ({ headRows: body.headRows ?? 0,
            bodyRows: ((body.children as unknown[] | undefined)?.length ?? 0) - Number(body.headRows ?? 0),
            ...(body.rowHeadColumns === undefined ? {} : { rowHeadColumns: body.rowHeadColumns }),
            ...(body.attrs === undefined ? {} : { attrs: body.attrs }) })),
          footRows: (foot?.children as unknown[] | undefined)?.length ?? 0,
          ...(foot?.attrs ? { footAttrs: foot.attrs } : {}),
        }
        delete node.children
        node.columns = ((node.columns as Item[] | undefined) ?? []).filter(column => column.authored).map(column => {
          const { type: _type, resolvedAlign: _resolvedAlign, authored: _authored, ...rest } = column
          return rest
        })
        if (!(node.columns as unknown[]).length) delete node.columns
        if (node.caption !== undefined) {
          const cap = node.caption as Item
          node.shortCaption = cap.short
          node.caption = captionInlines(cap)
          if (node.shortCaption === undefined) delete node.shortCaption
        }
        break
      }
      case 'table_row': relocateSlot(node, 'table_row', 'children', false); break
      case 'table_cell':
        if (node.sourceContent === 'inline') node.children = ((node.children as Item[])[0]?.children as unknown[]) ?? []
        else relocate(node, 'children', 'blocks')
        delete node.sourceContent
        break
      case 'figure':
        node.target = (node.children as Item[])[0]
        delete node.children
        if (node.caption !== undefined) {
          const cap = node.caption as Item
          node.shortCaption = cap.short
          node.caption = captionInlines(cap)
          if (node.shortCaption === undefined) delete node.shortCaption
        } else node.caption = []
        delete node.kind
        break
      case 'figure_group':
        if (node.caption !== undefined) node.caption = captionInlines(node.caption)
        break
      case 'citation_group': relocateSlot(node, 'citation_group', 'children', false); break
      case 'inline_footnote': relocateSlot(node, 'inline_footnote', 'children', false); break
      case 'comment':
        node.block = node.form === 'block'
        if (node.form === 'braced') node.delimited = true
        delete node.form
        relocate(node, 'value', 'content')
        break
      case 'critic_comment': relocate(node, 'value', 'text'); break
      case 'smart_punctuation': relocate(node, 'source', 'value'); break
      case 'code_block':
        relocate(node, 'value', 'content')
        relocate(node, 'syntax', 'lang')
        if (node.title !== undefined) {
          node.header = (node.title as Item[]).map(part => String(part.value ?? '')).join('')
          delete node.title
        }
        relocate(node, 'groupLabel', 'label')
        break
      case 'math':
        relocate(node, 'value', 'content')
        relocate(node, 'numberPrefix', 'label')
        break
      case 'raw_block': case 'raw_inline': case 'literal_inline': case 'frontmatter':
        relocate(node, 'value', 'content')
        break
      case 'link': case 'image':
        relocate(node, 'tooltip', 'title')
        if (node.key !== undefined && node[node.type === 'link' ? 'href' : 'src'] === '') node.resolved = true
        if (node.key !== undefined && node[node.type === 'link' ? 'href' : 'src'] === undefined) {
          node[node.type === 'link' ? 'href' : 'src'] = ''
        }
        delete node.targetKind
        delete node.decorative
        delete node.resourceId
        break
      case 'xref':
        node.type = 'heading_ref'
        relocate(node, 'key', 'target')
        delete node.namespace
        delete node.form
        break
      case 'mention':
        relocate(node, 'target', 'user')
        delete node.kind
        delete node.label
        break
      case 'div': case 'admonition': case 'directive':
        relocate(node, 'groupLabel', 'label')
        delete node.tocTarget
        break
      case 'critic_substitution': node.type = 'substitution'; break
      case 'ruby':
        node.pairs = (node.pairs as Item[]).map(pair => {
          const { type: _type, ...rest } = pair
          return rest
        })
        break
      case 'inline_extension':
        if (String(node.name).includes('.')) {
          const fallback = node.fallback as Item
          saveExtension(fallback, value as Item)
          return fallback
        }
        relocateSlot(node, 'inline_extension', 'children', false)
        delete node.fallback
        delete node.version
        delete node.props
        delete node.slots
        delete node.payload
        delete node.resourceIds
        break
      case 'block_extension':
        const fallback = node.fallback as Item
        saveExtension(fallback, value as Item)
        return fallback
    }
    if (node.type === 'image' && node.alt === undefined) node.alt = ''
    const reference = referenceFields[String(node.type)]
    if (reference) {
      relocate(node, 'key', reference[0])
      delete node.namespace
    }
    return node
  }
  return transform(input) as Item
}
