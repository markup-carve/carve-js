import { SMART_GLYPHS, SMART_KIND_NAMES } from '../src/inline-tables.ts'
import { fact, folded, integer, list, object, string, type Fields, type MigrationState } from './shared.ts'
import { migrateCell, migrateRow, migrateTable } from './table.ts'

function listStart(node: Fields, marker: Fields): void {
  if (!object(node['attrs']) || !Array.isArray(node['attrs']['keyValues'])) return
  const pairs = node['attrs']['keyValues'].filter((pair) => Array.isArray(pair))
  const startPair = pairs.find((pair) => pair[0] === 'start')
  if (startPair === undefined) return
  const start = Number(startPair[1])
  if (Number.isInteger(start) && start >= 0) marker['start'] = start
  const remaining = pairs.filter((pair) => pair !== startPair)
  if (remaining.length === 0) delete node['attrs']['keyValues']
  else node['attrs']['keyValues'] = remaining
  if (Object.keys(node['attrs']).length === 0) delete node['attrs']
}

function markerOf(old: Fields): Fields {
  if (old['ordered'] !== true) return { kind: 'bullet', char: string(old['bulletChar']) ?? '-' }
  const marker: Fields = { kind: 'ordered', style: string(old['olType']) ?? '1', delimiter: string(old['delim']) ?? '.' }
  const start = integer(old['start'])
  if (start !== undefined && start !== 1) marker['start'] = start
  return marker
}

function listMarker(node: Fields, old: Fields, state: MigrationState): void {
  if (object(node['marker'])) {
    fact(state, node, 'bare', node['marker']['bare'])
    delete node['marker']['bare']
    return
  }
  const marker = markerOf(old)
  node['marker'] = marker
  node['spacing'] = old['tight'] === false ? 'loose' : 'tight'
  if (marker['kind'] === 'ordered') listStart(node, marker)
  fact(state, node, 'bare', old['bareMarker'])
  for (const field of ['ordered', 'tight', 'olType', 'delim', 'start', 'bulletChar', 'bareMarker']) delete node[field]
}

function task(node: Fields, old: Fields): void {
  const taskValue = object(node['task']) ? { ...node['task'] } : undefined
  if (taskValue !== undefined) {
    delete taskValue['status']
    node['task'] = taskValue
  } else if (old['checked'] !== undefined || old['taskState'] !== undefined) {
    const mark = string(old['taskState']) ?? (old['checked'] === true ? 'x' : ' ')
    node['task'] = { mark }
  }
  delete node['checked']
  delete node['taskState']
}

function rawReference(node: Fields, old: Fields): string | undefined {
  const sourceRaw = string(old['rawRef'])
  return node['type'] === 'image' && sourceRaw?.startsWith('!') ? sourceRaw.slice(1) : sourceRaw
}

function linkReference(node: Fields, old: Fields, state: MigrationState): void {
  const raw = rawReference(node, old)
  const collapsed = raw?.endsWith('][]') ?? false
  const closing = raw?.lastIndexOf('][]') ?? -1
  const key = collapsed && closing > 0 ? folded(raw?.slice(1, closing)) : folded(old['ref'] ?? old['key'])
  if (key !== undefined) {
    node['key'] = key
    node['namespace'] = 'link'
    if (node['refForm'] === undefined) node['refForm'] = collapsed ? 'collapsed' : 'full'
    fact(state, node, 'rawRef', raw)
    delete node['tooltip']
    if (node['src'] === '') delete node['src']
  }
  delete node['ref']
  delete node['rawRef']
  delete node['resolved']
}

function reference(node: Fields, old: Fields, state: MigrationState): void {
  const type = string(node['type']) ?? ''
  if (type === 'xref' && old['target'] !== undefined) {
    node['key'] = folded(old['target'])
    node['namespace'] = 'heading'
    delete node['target']
  }
  if (type === 'link' || type === 'image') linkReference(node, old, state)
  if (!['footnote', 'footnote_ref', 'link_reference_definition', 'citation_definition', 'abbreviation',
    'abbreviation_def', 'citation'].includes(type)) return
  node['key'] = folded(node['key'] ?? old['label'] ?? old['abbr'])
  node['namespace'] = type.startsWith('abbreviation') ? 'abbr' : type.startsWith('footnote') ? 'footnote'
    : type.startsWith('citation') ? 'citation' : 'link'
}

function linePosition(children: Fields[]): unknown {
  const first = children[0]
  const last = children[children.length - 1]
  if (!object(first?.['pos']) || !object(last?.['pos'])) return undefined
  return { ...first['pos'], endLine: last['pos']['endLine'], endColumn: last['pos']['endColumn'],
    endOffset: last['pos']['endOffset'] }
}

function lineContents(children: Fields[]): Fields[] {
  let count = 0
  while (children[count]?.['type'] === 'non_breaking_space') count++
  if (count === 0) return children
  const next = children[count]
  const value = ' '.repeat(count) + (next?.['type'] === 'text' ? string(next['value']) ?? '' : '')
  const end = next?.['type'] === 'text' ? count + 1 : count
  const startPos = children[0]?.['pos']
  const endPos = children[end - 1]?.['pos']
  const pos = object(startPos) && object(endPos) ? { ...startPos, endLine: endPos['endLine'],
    endColumn: endPos['endColumn'], endOffset: endPos['endOffset'] } : undefined
  const text: Fields = { type: 'text', value }
  if (pos !== undefined) text['pos'] = pos
  return [text, ...children.slice(end)]
}

function lineNode(children: Fields[]): Fields {
  const node: Fields = { type: 'line', children: lineContents(children) }
  const pos = linePosition(children)
  if (pos !== undefined) node['pos'] = pos
  return node
}

function lineBlock(node: Fields): void {
  const result: Fields[] = []
  for (const block of list(node['children'])) {
    if (!object(block) || block['type'] !== 'paragraph') continue
    if (result.length > 0) result.push({ type: 'line', children: [] })
    let current: Fields[] = []
    const contents = list(block['children'])
    for (let at = 0; at < contents.length; at++) {
      const child = contents[at]
      if (!object(child)) continue
      if ((child['type'] === 'hard_break' || child['type'] === 'soft_break') && at < contents.length - 1) {
        result.push(lineNode(current))
        current = []
      } else current.push(child)
    }
    result.push(lineNode(current))
  }
  node['children'] = result
}

function shorthandLanguage(node: Fields, value: string, state: MigrationState): boolean {
  if (state.source === undefined || !object(node['pos'])) return false
  const start = integer(node['pos']['startOffset']) ?? 0
  const end = integer(node['pos']['endOffset']) ?? start
  const opening = state.source.lastIndexOf('{', start)
  return state.source.slice(Math.max(0, opening), end).includes(`:${value}`)
}

function placePair(pairs: [string, string][], index: Map<string, number>, name: string, value: string): void {
  const found = index.get(name.toLowerCase())
  if (found === undefined) { index.set(name.toLowerCase(), pairs.length); pairs.push([name, value]) }
  else if (pairs[found] !== undefined) pairs[found][1] = value
}

function attributePairs(node: Fields, source: Fields, output: Fields, state: MigrationState): void {
  const values = source['keyValues']
  if (Array.isArray(values)) { output['keyValues'] = values; return }
  if (!object(values)) return
  const order = list(source['order']).filter((name): name is string => typeof name === 'string')
  const names = [...order, ...Object.keys(values)].filter((name, index, all) => all.indexOf(name) === index)
  const pairs: [string, string][] = []
  const index = new Map<string, number>()
  for (const name of names) {
    const value = string(values[name])
    if (value === undefined) continue
    if (name.toLowerCase() === 'id') output['id'] = value
    else if (name.toLowerCase() === 'class') output['classes'] = [value]
    else if (name === 'lang' && shorthandLanguage(node, value, state)) node['lang'] = value
    else placePair(pairs, index, name, value)
  }
  if (pairs.length > 0) output['keyValues'] = pairs
}

function attrs(node: Fields, state: MigrationState): void {
  const source = node['attrs']
  if (!object(source)) return
  const output: Fields = {}
  if (string(source['id']) !== undefined) output['id'] = source['id']
  if (Array.isArray(source['classes']) && source['classes'].length > 0) output['classes'] = source['classes']
  attributePairs(node, source, output, state)
  if (Object.keys(output).length > 0) node['attrs'] = output
  else delete node['attrs']
}

function paragraph(node: Fields, old: Fields): void {
  if (old['blockImage'] === true) node['role'] = 'image'
  if (old['blockMath'] === true) node['role'] = 'math'
  const children = list(node['children'])
  if (node['role'] === undefined && children.length === 1 && object(children[0]) && children[0]['type'] === 'math'
    && children[0]['display'] === true && children[0]['value'] !== '') node['role'] = 'math'
  if (node['role'] === undefined && children.length === 1 && object(children[0]) && children[0]['type'] === 'image'
    && (!object(children[0]['pos']) || children[0]['pos']['startLine'] === children[0]['pos']['endLine'])) {
    node['role'] = 'image'
  }
  delete node['blockImage']
  delete node['blockMath']
}

function comment(node: Fields, old: Fields): void {
  node['value'] = string(old['content']) ?? string(old['value']) ?? ''
  node['form'] = old['block'] === true ? 'block' : old['delimited'] === true ? 'braced' : 'line'
  delete node['content']
  delete node['block']
  delete node['delimited']
}

function citation(node: Fields, old: Fields): void {
  if (old['suppressAuthor'] === true) node['mode'] = 'suppress-author'
  delete node['suppressAuthor']
  const label = string(old['locatorLabel'])
  const value = old['locatorValue']
  if (label !== undefined || value !== undefined) {
    const children = Array.isArray(value) ? value : typeof value === 'string' ? [{ type: 'text', value }] : []
    node['locator'] = label === undefined ? { children } : { label, children }
  }
  delete node['locatorLabel']
  delete node['locatorValue']
}

function figure(node: Fields, old: Fields): void {
  const caption = node['caption']
  if (Array.isArray(caption)) node['caption'] = { type: 'caption', children: [{ type: 'paragraph', children: caption }] }
  if (Array.isArray(old['shortCaption']) && object(node['caption'])) node['caption']['short'] = old['shortCaption']
  delete node['shortCaption']
}

function figureTarget(node: Fields): void {
  if (!object(node['kind'])) return
  node['children'] = [node['kind']]
  delete node['kind']
}

function admonition(node: Fields): void {
  const kind = string(node['kind'])
  if (kind === undefined || ['note', 'tip', 'warning', 'danger', 'info', 'success', 'example', 'quote'].includes(kind)) return
  node['type'] = 'div'
  const attrs = object(node['attrs']) ? node['attrs'] : {}
  const classes = list(attrs['classes']).filter((value): value is string => typeof value === 'string')
  node['attrs'] = { ...attrs, classes: [kind, ...classes] }
  delete node['kind']
}

function inlineTitle(node: Fields): void {
  const title = string(node['title'])
  if (title !== undefined) node['title'] = [{ type: 'text', value: title }]
}

function codeBlock(node: Fields, state: MigrationState): void {
  inlineTitle(node)
  if (!object(node['attrs']) || !Array.isArray(node['attrs']['keyValues'])) return
  const start = object(node['pos']) ? integer(node['pos']['startOffset']) ?? 0 : 0
  const prefix = state.source?.slice(0, start).trimEnd() ?? ''
  const previous = prefix.slice(prefix.lastIndexOf('\n') + 1)
  const authored = previous.startsWith('{') && previous.includes('title=')
  const pairs = node['attrs']['keyValues'].filter((pair) => Array.isArray(pair) && (pair[0] !== 'title' || authored))
  if (pairs.length > 0) node['attrs']['keyValues'] = pairs
  else delete node['attrs']['keyValues']
  if (Object.keys(node['attrs']).length === 0) delete node['attrs']
}

function frontmatter(node: Fields): void {
  const value = string(node['value'])
  if (value !== undefined && value !== '' && !value.endsWith('\n')) node['value'] = `${value}\n`
}

function punctuation(node: Fields, old: Fields): void {
  node['source'] = string(old['value']) ?? ''
  const index = SMART_KIND_NAMES.findIndex((name) => name === node['kind'])
  if (index >= 0) node['glyph'] = SMART_GLYPHS[index]
  delete node['value']
}

function optionPair(value: unknown): [string, string] | undefined {
  if (Array.isArray(value) && typeof value[0] === 'string' && typeof value[1] === 'string') return [value[0], value[1]]
  if (object(value) && typeof value['name'] === 'string' && typeof value['value'] === 'string') {
    return [value['name'], value['value']]
  }
  return undefined
}

function decodeOption(raw: string): string {
  if (raw.length < 2) return raw
  if (raw[0] === '"' && raw.endsWith('"')) {
    try {
      const decoded: unknown = JSON.parse(raw)
      if (typeof decoded === 'string') return decoded
    } catch { return raw.slice(1, -1) }
  }
  if (raw[0] === "'" && raw.endsWith("'")) return raw.slice(1, -1)
  return raw
}

function typedOption(name: string, value: string): unknown {
  if (name === 'shift') return value === 'auto' ? 'auto' : Number(value)
  if (name === 'code') return value === '' ? true : value
  if (name === 'cols' && value.includes(',')) return value.split(',').map((part) => part.trim())
  return value
}

function includeOptions(node: Fields, old: Fields, state: MigrationState): void {
  if (!Array.isArray(old['options'])) return
  const options: Fields = {}
  const spelling: Record<string, string> = {}
  for (const value of old['options']) {
    const pair = optionPair(value)
    if (pair === undefined || options[pair[0]] !== undefined) continue
    options[pair[0]] = typedOption(pair[0], decodeOption(pair[1]))
    spelling[pair[0]] = pair[1]
  }
  node['options'] = options
  fact(state, node, 'optionSpelling', spelling)
}

function blockShape(node: Fields, old: Fields, state: MigrationState): void {
  switch (node['type']) {
    case 'list': listMarker(node, old, state); break
    case 'list_item': task(node, old); break
    case 'paragraph': paragraph(node, old); break
    case 'comment': comment(node, old); break
    case 'line_block': lineBlock(node); break
    case 'admonition': if (node['label'] !== undefined) { node['groupLabel'] = node['label']; delete node['label'] }
      admonition(node); inlineTitle(node); break
    case 'code_block': codeBlock(node, state); break
    case 'frontmatter': frontmatter(node); break
    case 'include': includeOptions(node, old, state); break
    case 'directive': inlineTitle(node); break
    case 'div': inlineTitle(node); break
    default: break
  }
}

function tableShape(node: Fields, old: Fields, state: MigrationState): void {
  switch (node['type']) {
    case 'table': migrateTable(node, old, state); figure(node, old); break
    case 'table_cell': migrateCell(node, old, state); break
    case 'table_row': migrateRow(node, old, state); break
    case 'figure': figureTarget(node); figure(node, old); break
    case 'figure_group': figure(node, old); break
    default: break
  }
}

function inlineShape(node: Fields, old: Fields): void {
  switch (node['type']) {
    case 'smart_punctuation': punctuation(node, old); break
    case 'mention': node['kind'] = string(old['kind']) ?? 'user'; break
    case 'math': node['display'] = old['display'] === true; break
    case 'citation': citation(node, old); break
    case 'autolink': if (node['text'] === node['href']) delete node['text']; break
    default: break
  }
}

export function shape(node: Fields, old: Fields, state: MigrationState): void {
  attrs(node, state)
  reference(node, old, state)
  blockShape(node, old, state)
  tableShape(node, old, state)
  inlineShape(node, old)
}
