import { type BlockSink, isLeaf } from './kinds.ts'

/** One field layout for every block. A container has `children`, a leaf has `spans` (start, end pairs). */
export class BlockNode {
  kind: number
  start: number
  end: number
  aux: number
  children: BlockNode[] | null
  spans: number[] | null

  constructor(kind: number, start: number, aux: number) {
    this.kind = kind
    this.start = start
    this.end = start
    this.aux = aux
    this.children = isLeaf(kind) ? null : []
    this.spans = isLeaf(kind) ? [] : null
  }
}

/** Builds the tree from enter, span and exit calls. Both variants end here. */
export class TreeBuilder implements BlockSink {
  root: BlockNode | null = null
  private readonly open: BlockNode[] = []
  private top: BlockNode | null = null

  enter(kind: number, pos: number, aux: number): void {
    const node = new BlockNode(kind, pos, aux)
    if (this.top === null) this.root = node
    else this.top.children!.push(node)
    this.open.push(node)
    this.top = node
  }

  span(start: number, end: number): void {
    this.top!.spans!.push(start, end)
  }

  exit(_kind: number, pos: number): void {
    const open = this.open
    open.pop()!.end = pos
    this.top = open.length > 0 ? open[open.length - 1]! : null
  }
}
