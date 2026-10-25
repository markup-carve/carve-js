import { NODE_POSITION_KIND, WIRE_FIELDS } from './wire-fields.js'
import { RUNTIME_TYPE_FOR_WIRE, runtimeSlotsForWire, WIRE_ONLY_TYPES } from './contract2-wire.js'

const documentOrder = ['target', 'title', 'children', 'items', 'rows', 'cells', 'blocks',
  'inline', 'content', 'prefix', 'locator', 'suffix', 'old', 'new', 'pairs',
  'base', 'annotation', 'caption', 'shortCaption', 'fallback', 'terms', 'definitions']
const ranks = new Map(documentOrder.map((field, index) => [field, index]))
const rank = (field: string): number => ranks.get(field) ?? documentOrder.length
const inDocumentOrder = (fields: string[]): string[] => fields.sort((a, b) => rank(a) - rank(b))

const runtimeSlots = Object.entries(NODE_POSITION_KIND).flatMap(([slot, kind]) => {
  const dot = slot.indexOf('.')
  const type = slot.slice(0, dot)
  if (WIRE_ONLY_TYPES.has(type)) return []
  return runtimeSlotsForWire(type, slot.slice(dot + 1)).map(field => ({
    type: RUNTIME_TYPE_FOR_WIRE[type] ?? type, field,
    single: kind === 'node' || (type === 'figure' && field === 'target'),
  }))
})

/** Authored node slots derived from the schema, excluding display metadata. */
export const OWNED_CHILD_FIELDS: readonly string[] = inDocumentOrder([...new Set([
  ...runtimeSlots.filter(slot => !slot.single).map(slot => slot.field),
  'terms', 'definitions',
])])

export const OWNED_SINGLE_CHILD_FIELDS: readonly string[] = [...new Set(
  runtimeSlots.filter(slot => slot.single).map(slot => slot.field),
)]

export const ALL_OWNED_CHILD_FIELDS: readonly string[] = inDocumentOrder([
  ...OWNED_SINGLE_CHILD_FIELDS, ...OWNED_CHILD_FIELDS,
])

const fieldsByType = new Map<string, string[]>(Object.keys(WIRE_FIELDS)
  .filter(type => !WIRE_ONLY_TYPES.has(type))
  .map(type => [RUNTIME_TYPE_FOR_WIRE[type] ?? type, []]))
for (const { type, field } of runtimeSlots) {
  fieldsByType.get(type)?.push(field)
}
for (const [type, fields] of fieldsByType) fieldsByType.set(type, inDocumentOrder([...new Set(fields)]))
const recordFields: readonly string[] = ['terms', 'definitions', 'base', 'annotation']

/** Runtime records own matrices and ruby lists; typed nodes use schema slots. */
export function ownedChildFields(node: Readonly<Record<string, unknown>>): readonly string[] {
  return typeof node['type'] === 'string' ? fieldsByType.get(node['type']) ?? ALL_OWNED_CHILD_FIELDS : recordFields
}
