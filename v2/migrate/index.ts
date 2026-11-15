// C2-A-176 to C2-A-180: stored 1.x and retired draft trees are upgraded outside the reader.
import { type DocumentNode, type Envelope, type ExtensionDeclaration } from '../src/ast.ts'
import { parseWithLayout } from '../src/api.ts'
import { validateTree } from '../src/ast-validate.ts'
import { type Diagnostic } from '../src/diagnostics.ts'
import { type SourceLayout } from '../src/layout.ts'
import { fieldRules, renamedType, ruleExists } from './rules.ts'
import { coalesceText, fact, list, loss, makeLayout, nodeList, object, record, string, type Fields,
  type MigrationState } from './shared.ts'
import { shape } from './shapes.ts'

export interface MigrateOptions {
  source?: string
}

export interface MigrationResult {
  document: DocumentNode
  envelope?: Envelope
  layout: SourceLayout
  diagnostics: Diagnostic[]
}

function envelopeExtensions(value: unknown): ExtensionDeclaration[] | undefined {
  if (!Array.isArray(value)) return undefined
  const result: ExtensionDeclaration[] = []
  for (const entry of value) {
    if (!object(entry) || typeof entry['name'] !== 'string' || typeof entry['version'] !== 'string' ||
      typeof entry['required'] !== 'boolean' || !Array.isArray(entry['slots']) ||
      !entry['slots'].every((slot) => typeof slot === 'string')) return undefined
    result.push({ name: entry['name'], version: entry['version'], required: entry['required'], slots: entry['slots'] })
  }
  return result
}

function outputEnvelope(input: Fields, document: DocumentNode): Envelope {
  const vocabulary = string(input['vocabulary'])
  const extensions = document.extensions ?? envelopeExtensions(input['extensions'])
  return { astVersion: '2.0', document,
    ...(vocabulary === undefined ? {} : { vocabulary }),
    ...(extensions === undefined ? {} : { extensions }) }
}

const SLOTS = ['children', 'items', 'rows', 'cells', 'old', 'new', 'prefix', 'suffix', 'inline', 'title', 'shortCaption',
  'base', 'annotation', 'pairs', 'content']

function migrateList(values: unknown, path: string, state: MigrationState): Fields[] {
  const result: Fields[] = []
  list(values).forEach((value, index) => {
    if (!object(value)) return
    result.push(...migrateNode(value, `${path}/${index}`, state))
  })
  return result
}

function migrateSlots(node: Fields, old: Fields, path: string, state: MigrationState): void {
  for (const name of SLOTS) {
    if (!Array.isArray(old[name])) continue
    node[name] = migrateList(old[name], `${path}/${name}`, state)
  }
  if (object(old['caption'])) {
    const migrated = migrateNode(old['caption'], `${path}/caption`, state)[0]
    if (migrated !== undefined) node['caption'] = migrated
  } else if (Array.isArray(old['caption'])) node['caption'] = migrateList(old['caption'], `${path}/caption`, state)
  if (object(old['target']) && old['type'] === 'figure') {
    node['target'] = migrateNode(old['target'], `${path}/target`, state)[0]
  }
  if (object(old['locator'])) {
    const locator = { ...old['locator'] }
    if (Array.isArray(locator['children'])) locator['children'] = migrateList(locator['children'], `${path}/locator/children`, state)
    node['locator'] = locator
  }
}

function mechanical(node: Fields, type: string): void {
  for (const rule of fieldRules(type)) {
    if (!ruleExists(rule.id)) throw new Error(`missing tree upgrade rule ${rule.id}`)
    if (node[rule.from] === undefined) continue
    if (rule.to !== undefined && node[rule.to] === undefined) node[rule.to] = node[rule.from]
    delete node[rule.from]
  }
}

function substitution(old: Fields, path: string, state: MigrationState): Fields[] {
  const previous = Array.isArray(old['old']) ? migrateList(old['old'], `${path}/old`, state) :
    [{ type: 'text', value: string(old['old']) ?? '' }]
  const next = Array.isArray(old['new']) ? migrateList(old['new'], `${path}/new`, state) :
    [{ type: 'text', value: string(old['new']) ?? '' }]
  const fields = old['pos'] === undefined ? {} : { pos: old['pos'] }
  return [{ type: 'delete', children: previous, ...fields }, { type: 'insert', children: next, ...fields }]
}

function before(node: Fields, old: Fields, state: MigrationState): void {
  const type = string(node['type']) ?? ''
  if (type === 'block_quote') { fact(state, node, 'fenced', old['fenced']); delete node['fenced'] }
  if (type === 'line_block') delete node['lines']
  if (type === 'table_row') fact(state, node, 'continuationLines', old['continuationLines'])
  if (type === 'document') {
    node['astVersion'] = '2.0'
    if (Array.isArray(node['stages'])) node['stages'] = node['stages'].filter((entry) => entry !== 'blockImagePromotion')
  }
}

function arrangeDefinitions(node: Fields): void {
  if (node['type'] !== 'document') return
  const children = nodeList(node['children'])
  if (children.every((child) => object(child['pos']))) {
    children.sort((left, right) => Number(object(left['pos']) ? left['pos']['startOffset'] : 0) -
      Number(object(right['pos']) ? right['pos']['startOffset'] : 0))
    node['children'] = children
  }
}

function promoteImages(node: Fields): void {
  const type = string(node['type'])
  if (type === undefined || !['document', 'block_quote', 'div', 'admonition', 'directive', 'section', 'figure',
    'figure_group', 'list_item', 'definition_description', 'caption'].includes(type)) return
  node['children'] = nodeList(node['children']).map((child) => child['type'] === 'image' ?
    { type: 'paragraph', role: 'image', children: [child],
      ...(child['pos'] === undefined ? {} : { pos: child['pos'] }) } : child)
}

function migrateNode(old: Fields, path: string, state: MigrationState): Fields[] {
  const oldType = string(old['type'])
  if (oldType === undefined) { loss(state, path, 'a node has no type'); return [] }
  if (oldType === 'critic_substitution' || oldType === 'substitution') return substitution(old, path, state)
  if (oldType === 'cell_wrap') return [{ type: 'text', value: ' ', ...(old['pos'] === undefined ? {} : { pos: old['pos'] }) }]
  const node: Fields = { ...old, type: renamedType(oldType) }
  migrateSlots(node, old, path, state)
  if (oldType === 'escaped_text') node['type'] = 'text'
  mechanical(node, oldType)
  before(node, old, state)
  shape(node, old, state)
  coalesceText(node)
  promoteImages(node)
  arrangeDefinitions(node)
  return [node]
}

function version(value: Fields, envelope: Fields | undefined): void {
  const versionValue = string(value['astVersion']) ?? string(envelope?.['astVersion'])
  if (versionValue !== undefined && !['0.2', '1.0', '1.1', '1.2', '2.0'].includes(versionValue)) {
    throw new Error(`unsupported AST version ${versionValue}`)
  }
}

export function migrateTree(json: unknown, options: MigrateOptions = {}): MigrationResult {
  const input: unknown = typeof json === 'string' ? JSON.parse(json) : json
  const envelope = object(input) && input['type'] === undefined ? input : undefined
  const value = envelope === undefined ? input : envelope['document']
  const old = record(value)
  if (old === undefined || old['type'] !== 'document') throw new Error('migration input is not a document')
  version(old, envelope)
  const state: MigrationState = { source: options.source, draft: old['astVersion'] === '2.0' || old['astVersion'] === '0.2',
    diagnostics: [], facts: new Map() }
  const layout = (document: unknown): SourceLayout => options.source === undefined ? makeLayout(state, document) :
    parseWithLayout(options.source).layout
  if (old['astVersion'] === '2.0') {
    try {
      validateTree(value)
      return { document: value, ...(envelope === undefined ? {} : { envelope: outputEnvelope(envelope, value) }),
        layout: layout(value), diagnostics: [] }
    } catch { /* C2-A-177: an earlier draft also claimed 2.0. */ }
  }
  const document = migrateNode(old, envelope === undefined ? '' : '/document', state)[0]
  validateTree(document)
  return { document, ...(envelope === undefined ? {} : { envelope: outputEnvelope(envelope, document) }),
    layout: layout(document), diagnostics: state.diagnostics }
}
