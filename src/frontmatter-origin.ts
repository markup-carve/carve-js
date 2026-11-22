import { type Node } from './ast.ts'

/** Internal provenance for a line-1 block in an included file when public positions are disabled. */
export const leadingIncludedFrontmatter = new WeakSet<Node>()
