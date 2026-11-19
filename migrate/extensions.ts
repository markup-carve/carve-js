// T-041, T-050 (C2-A-017, C2-A-122, C2-A-123): 0.1 extension nodes and envelope declarations in their 2.0 shape.
import { type ExtensionDeclaration } from '../src/ast.ts'
import { list, loss, object, string, type Fields, type MigrationState } from './shared.ts'

const QUALIFIED = /^[A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z][A-Za-z0-9_-]*)+$/
// C2-A-012: 0.1 read an absent vocabulary as this one, so dropping it loses nothing.
const CORE_VOCABULARY = 'https://markup-carve.org/ast/core'

/** The 0.1 `{id, version, required}` entries that name a qualified extension; an absent `required` meant true in 0.1. */
export function oldDeclarations(envelope: Fields | undefined, state: MigrationState): void {
  if (envelope === undefined) return
  const vocabulary = envelope['vocabulary']
  if (vocabulary !== undefined && !object(vocabulary) && vocabulary !== CORE_VOCABULARY) {
    loss(state, '/vocabulary', '0.2 has no vocabulary other than the core one in this form')
  }
  list(envelope['extensions']).forEach((entry, index) => {
    if (!object(entry)) return
    const name = string(entry['id']) ?? string(entry['name'])
    const version = string(entry['version'])
    if (name === undefined || !QUALIFIED.test(name) || version === undefined || version === '') {
      loss(state, `/extensions/${index}`, 'an extension declaration without a qualified name and a version')
      return
    }
    state.declared.set(name, { name, version, required: entry['required'] !== false,
      slots: list(entry['slots']).filter((slot): slot is string => typeof slot === 'string') })
  })
}

export function outputVocabulary(value: unknown): Fields | undefined {
  return object(value) ? value : undefined
}

function payload(node: Fields, path: string, state: MigrationState): void {
  const value = node['payload']
  if (value === undefined) return
  const entries = (Array.isArray(value) ? value : [value]).filter((entry): entry is Fields => object(entry) &&
    typeof entry['format'] === 'string' && entry['format'] !== '' && entry['value'] !== undefined && entry['value'] !== null)
  if (entries.length === (Array.isArray(value) ? value.length : 1) && entries.length > 0) {
    node['payload'] = entries.map((entry) => ({ format: entry['format'], value: entry['value'] }))
    return
  }
  loss(state, `${path}/payload`, 'a payload without format and value')
  if (entries.length > 0) node['payload'] = entries.map((entry) => ({ format: entry['format'], value: entry['value'] }))
  else delete node['payload']
}

/** The node itself, or its fallback content with a loss when 2.0 cannot hold it. */
export function extension(node: Fields, fallback: Fields[], path: string, state: MigrationState): Fields[] {
  const name = string(node['name']) ?? ''
  const block = node['type'] === 'block_extension'
  if (!block && !name.includes('.')) { delete node['version']; return [node] }
  const declared = state.declared.get(name)
  const version = declared?.version ?? string(node['version'])
  const own = string(node['version'])
  if (!QUALIFIED.test(name) || version === undefined || version === '' || (own !== undefined && own !== version)) {
    loss(state, path, 'an extension node without a qualified name and one version; its fallback was kept')
    return fallback
  }
  node['version'] = version
  node['fallback'] = fallback
  if (block && !Array.isArray(node['children'])) node['children'] = []
  payload(node, path, state)
  state.used.set(name, declared ?? { name, version, required: false, slots: [] })
  return [node]
}

export function rootDeclarations(state: MigrationState): ExtensionDeclaration[] | undefined {
  if (state.used.size === 0) return undefined
  return [...state.used.values()].sort((left, right) => left.name.localeCompare(right.name))
}

export function envelopeDeclarations(state: MigrationState): ExtensionDeclaration[] | undefined {
  return state.declared.size === 0 ? undefined : [...state.declared.values()]
}
