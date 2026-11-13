// The public tree of a source for tests, with and without positions, and a reader of paths into it.
import { type AstNode } from '../../src/ast.ts'
import { buildDocument } from '../../src/ast-blocks.ts'
import { parseTree } from '../../src/index.ts'

/** The tree of `src` before resolution, without positions. */
export function tree(src: string): AstNode {
  return buildDocument(src, parseTree(src), false).document
}

/** The tree of `src` before resolution, with positions. */
export function placedTree(src: string): AstNode {
  return buildDocument(src, parseTree(src), true).document
}

/** The blocks of `src`. */
export function blocks(src: string): AstNode[] {
  return tree(src).children!
}

/** The first block of `src`. */
export function block(src: string): AstNode {
  return blocks(src)[0]!
}

/** The inline nodes of the first block of `src`. */
export function inlines(src: string): AstNode[] {
  return block(src).children!
}

/** The value at a path of field names and indexes, as in `children.0.caption`. */
export function at(node: unknown, path: string): unknown {
  let value = node
  for (const step of path.split('.')) value = (value as Record<string, unknown>)[step]
  return value
}

export function text(value: string): AstNode {
  return { type: 'text', value }
}

export function paragraph(...children: (AstNode | string)[]): AstNode {
  return { type: 'paragraph', children: children.map((child) => (typeof child === 'string' ? text(child) : child)) }
}

/** A document that holds `children`. */
export function documentOf(...children: AstNode[]): AstNode {
  return { type: 'document', astVersion: '2.0', children }
}
