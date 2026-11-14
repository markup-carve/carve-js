// Writes src/ast-nodes.ts, one interface per node type of the tree document, from the node table
// the validator reads (src/ast-validate.ts), so the two cannot name different fields.
//   node v2/scripts/generate-ast-nodes.ts
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { type Content, NODE_TABLE } from '../src/ast-validate.ts'

const { BLOCKS, INLINES, RULES, STRINGS, INTEGERS, BOOLEANS, TRUE_ONLY, INLINE_SLOTS, ENUMS, STAGES } = NODE_TABLE

/** `table_cell` is `TableCellNode`. */
export function interfaceName(type: string): string {
  return `${type.split('_').map((part) => part[0]!.toUpperCase() + part.slice(1)).join('')}Node`
}

function literals(values: readonly string[]): string {
  return values.map((value) => JSON.stringify(value)).join(' | ')
}

/** A union type alias, one member per line. */
function unionLines(name: string, types: readonly string[]): string[] {
  return [`export type ${name} =`, ...types.map((type) => `  | ${interfaceName(type)}`)]
}

function childrenType(content: Content): string {
  if (content === 'blocks') return 'Block[]'
  if (content === 'inlines') return 'Inline[]'
  // A list that holds every block type names them as `Block`.
  const named = content as readonly string[]
  const blocks = BLOCKS.every((type) => named.includes(type))
  const rest = blocks ? named.filter((type) => !BLOCKS.includes(type)) : named
  const members = [...(blocks ? ['Block'] : []), ...rest.map(interfaceName)]
  return members.length === 1 ? `${members[0]!}[]` : `(${members.join(' | ')})[]`
}

const SPECIAL = new Map<string, (type: string) => string>([
  ['marker', () => 'Marker'],
  ['task', () => 'Task'],
  ['options', () => '[string, string][]'],
  ['title', (type) => (type === 'link_reference_definition' ? 'string' : 'Inline[]')],
  ['caption', () => 'CaptionNode'],
  ['fallback', (type) => (type === 'block_extension' ? 'Block[]' : 'Inline[]')],
  ['columns', () => 'TableColumnNode[]'],
  ['pairs', () => 'RubyPair[]'],
  ['slots', () => 'Record<string, Node[]>'],
  ['stages', () => `(${literals(STAGES)})[]`],
  ['resources', () => 'Resource[]'],
  ['extensions', () => 'ExtensionDeclaration[]'],
  ['payload', () => '{ format: string, value: string }[]'],
  ['resourceIds', () => 'string[]'],
  ['props', () => 'Record<string, unknown>'],
  ['width', () => 'number'],
])

function fieldType(type: string, name: string): string {
  const values = ENUMS.get(`${type}.${name}`) ?? ENUMS.get(`*.${name}`)
  if (values !== undefined) return literals(values)
  const special = SPECIAL.get(name)
  if (special !== undefined) return special(type)
  if (STRINGS.includes(name)) return 'string'
  if (INTEGERS.includes(name)) return 'number'
  if (BOOLEANS.includes(name)) return 'boolean'
  if (TRUE_ONLY.includes(name)) return 'true'
  if (INLINE_SLOTS.includes(name)) return 'Inline[]'
  throw new Error(`no type for ${type}.${name}`)
}

/** The text of src/ast-nodes.ts. */
export function generateAstNodes(): string {
  const types = [...RULES.keys()]
  const lines = [
    '// Generated from the node table of src/ast-validate.ts by scripts/generate-ast-nodes.ts. Do not edit.',
    "import { type Attrs, type ExtensionDeclaration, type Marker, type Position, type Resource, type RubyPair, type Task } from './ast.ts'",
    '',
    '/** C2-A-027: the fields every node may carry. */',
    'export interface NodeBase {',
    '  attrs?: Attrs',
    '  data?: Record<string, unknown>',
    '  pos?: Position',
    '  segments?: Position[]',
    '  metadata?: Record<string, unknown>',
    `  dir?: ${fieldType('*', 'dir')}`,
    '  lang?: string',
    '}',
  ]
  for (const type of types) {
    const [content, required, optional] = RULES.get(type)!
    lines.push('', `export interface ${interfaceName(type)} extends NodeBase {`, `  type: ${JSON.stringify(type)}`)
    if (content !== 'none') lines.push(`  children: ${childrenType(content)}`)
    for (const name of required) lines.push(`  ${name}: ${fieldType(type, name)}`)
    for (const name of optional) lines.push(`  ${name}?: ${fieldType(type, name)}`)
    lines.push('}')
  }
  lines.push(
    '', '/** The node types that stand in a list of blocks. */', ...unionLines('Block', BLOCKS),
    '', '/** The node types that stand in a list of inlines. */', ...unionLines('Inline', INLINES),
    '', '/** Every node of the tree document, told apart by `type`. */', ...unionLines('Node', types),
    '', '/** The node of each type. */', 'export interface NodeOfType {',
    ...types.map((type) => `  ${type}: ${interfaceName(type)}`), '}',
    '', '/** A function per node type, each of which reads a node of its own type. */',
    'export type NodeHandlers<R> = { [T in keyof NodeOfType]?: (node: NodeOfType[T]) => R }',
    '', '/** The result of the handler of the type of `node`, or undefined where `handlers` has none. */',
    'export function handle<R, T extends keyof NodeOfType>(handlers: NodeHandlers<R>, type: T, node: NodeOfType[T]): R | undefined {',
    '  return handlers[type]?.(node)', '}', '',
  )
  return lines.join('\n')
}

if (import.meta.main) writeFileSync(join(import.meta.dirname, '../src/ast-nodes.ts'), generateAstNodes())
