// Typed reads of tree nodes for tests: a test states the type it expects a node to have, and a
// node of another type fails the test there instead of reading a field the node does not have.
import { type Block, type Inline, isBlockParent, isInlineParent, type Node, type NodeOfType } from '../../src/ast.ts'

/** Whether `node` is of type `type`. */
export function isType<T extends keyof NodeOfType>(node: Node | undefined, type: T): node is NodeOfType[T] {
  return node?.type === type
}

/** `node`, which the test expects to be of type `type`. */
export function ofType<T extends keyof NodeOfType>(node: Node | undefined, type: T): NodeOfType[T] {
  if (!isType(node, type)) throw new Error(`expected a node of type ${type}, got ${node?.type ?? 'none'}`)
  return node
}

/** The children of `node`, which the test expects to have children. */
export function childrenOf(node: Node | undefined): readonly Node[] {
  if (node === undefined || !('children' in node)) throw new Error(`expected a node with children, got ${node?.type ?? 'none'}`)
  return node.children
}

/** The inline children of `node`, which the test expects to hold inline content. */
export function inlinesOf(node: Node | undefined): Inline[] {
  if (node === undefined || !isInlineParent(node)) throw new Error(`expected inline content, got ${node?.type ?? 'none'}`)
  return node.children
}

/** The block children of `node`, which the test expects to hold blocks. */
export function blocksOf(node: Node | undefined): Block[] {
  if (node === undefined || !isBlockParent(node)) throw new Error(`expected block content, got ${node?.type ?? 'none'}`)
  return node.children
}

/** Whether `value`, read from a path into a tree, is a node. */
export function isNode(value: unknown): value is Node {
  return typeof value === 'object' && value !== null && 'type' in value && typeof value.type === 'string'
}

/** `value`, which the test expects to be a node. */
export function asNode(value: unknown): Node {
  if (!isNode(value)) throw new Error('expected a node')
  return value
}

/** The field `name` of `node`, or undefined where the node has no such field: for lists of nodes of several types. */
export function fieldOf(node: Node, name: string): unknown {
  return name in node ? Reflect.get(node, name) : undefined
}
