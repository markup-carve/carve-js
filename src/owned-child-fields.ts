import { NODE_POSITION_KIND, WIRE_FIELDS } from './wire-fields.js'

const documentOrder = ['target', 'title', 'children', 'items', 'rows', 'cells', 'blocks',
  'inline', 'content', 'prefix', 'locator', 'suffix', 'old', 'new', 'pairs',
  'base', 'annotation', 'caption', 'shortCaption', 'fallback', 'terms', 'definitions']
const ranks = new Map(documentOrder.map((field, index) => [field, index]))
const rank = (field: string): number => ranks.get(field) ?? documentOrder.length
const inDocumentOrder = (fields: string[]): string[] => fields.sort((a, b) => rank(a) - rank(b))

/** Authored node slots derived from the schema, excluding display metadata. */
export const OWNED_CHILD_FIELDS: readonly string[] = inDocumentOrder([...new Set([
  ...Object.entries(NODE_POSITION_KIND)
    .filter(([, kind]) => kind !== 'node')
    .map(([slot]) => slot.slice(slot.indexOf('.') + 1)),
  'terms', 'definitions',
])])

export const OWNED_SINGLE_CHILD_FIELDS: readonly string[] = [...new Set(
  Object.entries(NODE_POSITION_KIND)
    .filter(([, kind]) => kind === 'node')
    .map(([slot]) => slot.slice(slot.indexOf('.') + 1)),
)]

export const ALL_OWNED_CHILD_FIELDS: readonly string[] = inDocumentOrder([
  ...OWNED_SINGLE_CHILD_FIELDS, ...OWNED_CHILD_FIELDS,
])

const fieldsByType = new Map<string, string[]>(Object.keys(WIRE_FIELDS).map((type) => [type, []]))
for (const slot of Object.keys(NODE_POSITION_KIND)) {
  const dot = slot.indexOf('.')
  const type = slot.slice(0, dot)
  const fields = fieldsByType.get(type) ?? []
  fields.push(slot.slice(dot + 1))
  fieldsByType.set(type, inDocumentOrder(fields))
}
const recordFields: readonly string[] = ['terms', 'definitions', ...fieldsByType.get('rubyPair') ?? []]

/** Runtime records own matrices and ruby lists; typed nodes use schema slots. */
export function ownedChildFields(node: Readonly<Record<string, unknown>>): readonly string[] {
  return typeof node['type'] === 'string' ? fieldsByType.get(node['type']) ?? ALL_OWNED_CHILD_FIELDS : recordFields
}
