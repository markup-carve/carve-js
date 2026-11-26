// The public tree of a source for tests, with and without positions, and a reader of paths into it.
import { type DocumentNode, type Inline, type ParagraphNode, type TextNode } from '../../src/ast.ts'
import { buildSource } from '../../src/ast-blocks.ts'
import { type HeadingIds } from '../../src/options.ts'
import { resolve, type Resolution } from '../../src/resolve.ts'
import { inlinesOf } from './nodes.ts'

/** A child of a document: a block, a definition or the frontmatter. */
export type DocumentChild = DocumentNode['children'][number]

/** The tree of `src` before resolution, without positions. */
export function tree(src: string): DocumentNode {
  return buildSource(src, false).document
}

/** The tree of `src` before resolution, with positions. */
export function placedTree(src: string): DocumentNode {
  return buildSource(src, true).document
}

/** The blocks of `src`. */
export function blocks(src: string): DocumentChild[] {
  return tree(src).children
}

/** The first block of `src`. */
export function block(src: string): DocumentChild {
  const first = blocks(src)[0]
  if (first === undefined) throw new Error('the document has no blocks')
  return first
}

/** The inline nodes of the first block of `src`. */
export function inlines(src: string): Inline[] {
  return inlinesOf(block(src))
}

/** The value at a path of field names and indexes, as in `children.0.caption`. */
export function at(node: unknown, path: string): unknown {
  let value = node
  for (const step of path.split('.')) value = (value as Record<string, unknown>)[step]
  return value
}

export function text(value: string): TextNode {
  return { type: 'text', value }
}

export function paragraph(...children: (Inline | string)[]): ParagraphNode {
  return { type: 'paragraph', children: children.map((child) => (typeof child === 'string' ? text(child) : child)) }
}

/** A document that holds `children`. */
export function documentOf(...children: DocumentChild[]): DocumentNode {
  return { type: 'document', astVersion: '2.0', children }
}

/** The resolved tree of `src`, without positions, with what resolution returns beside it. */
export function resolved(src: string, mode: HeadingIds = 'keep-case'): { document: DocumentNode, resolution: Resolution } {
  const built = buildSource(src, false)
  return { document: built.document, resolution: resolve(built.document, mode, built.facts) }
}

/** The inline nodes of block `index` of the resolved tree of `src`. */
export function resolvedInlines(src: string, index = 0): Inline[] {
  return inlinesOf(resolved(src).document.children[index])
}
