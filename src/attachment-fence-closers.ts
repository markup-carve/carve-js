interface Node {
  maximum: number
  left: Node | undefined
  right: Node | undefined
}

interface Version {
  column: number
  root: Node | undefined
}

class ColumnIndex {
  private readonly groups = new Map<number, { line: number; width: number }[]>()
  private readonly versions: Version[] = []

  constructor(private readonly length: number) {}

  add(column: number, line: number, width: number): void {
    let group = this.groups.get(column)
    if (group === undefined) {
      group = []
      this.groups.set(column, group)
    }
    group.push({ line, width })
  }

  build(): void {
    let root: Node | undefined
    for (const column of [...this.groups.keys()].sort((a, b) => a - b)) {
      const entries = this.groups.get(column)!
      root = this.insert(root, entries, 0, entries.length, 0, this.length)
      this.versions.push({ column, root })
    }
    this.groups.clear()
  }

  private insert(previous: Node | undefined, entries: { line: number; width: number }[], first: number, last: number, start: number, end: number): Node | undefined {
    if (first === last) return previous
    const node: Node = previous === undefined ? { maximum: 0, left: undefined, right: undefined } : { ...previous }
    if (end - start === 1) node.maximum = Math.max(node.maximum, entries[first]!.width)
    else {
      const middle = Math.floor((start + end) / 2)
      let left = first, right = last
      while (left < right) {
        const at = Math.floor((left + right) / 2)
        if (entries[at]!.line < middle) left = at + 1
        else right = at
      }
      node.left = this.insert(node.left, entries, first, left, start, middle)
      node.right = this.insert(node.right, entries, left, last, middle, end)
      node.maximum = Math.max(node.left?.maximum ?? 0, node.right?.maximum ?? 0)
    }
    return node
  }

  find(width: number, start: number, end: number, column: number, backwards = false): number | undefined {
    if (start >= end) return undefined
    let left = 0, right = this.versions.length
    while (left < right) {
      const middle = Math.floor((left + right) / 2)
      if (this.versions[middle]!.column <= column) left = middle + 1
      else right = middle
    }
    const root = this.versions[left - 1]?.root
    const visit = (node: Node | undefined, low: number, high: number): number | undefined => {
      if (node === undefined || node.maximum < width || high <= start || low >= end) return undefined
      if (high - low === 1) return low
      const middle = Math.floor((low + high) / 2)
      return backwards
        ? visit(node.right, middle, high) ?? visit(node.left, low, middle)
        : visit(node.left, low, middle) ?? visit(node.right, middle, high)
    }
    return visit(root, 0, this.length)
  }
}

/** Minimum dedent column that consumes the whole prefix, including a straddled tab. */
function flushColumn(line: string): number {
  let column = 0, minimum = 0
  for (const character of line) {
    if (character !== ' ' && character !== '\t') break
    minimum = column + 1
    column += character === '\t' ? 4 - column % 4 : 1
  }
  return minimum
}

/** Source-line closer indices shared by every attachment indentation view. */
export class AttachmentFenceClosers {
  private readonly code: [ColumnIndex, ColumnIndex]
  private readonly colon = new Map<number, ColumnIndex>()
  private readonly comments = new Map<number, number[]>()

  constructor(lines: { length: number; lineAt: (index: number) => string }, codePattern: RegExp, commentPattern: RegExp, colonPattern: RegExp) {
    this.code = [new ColumnIndex(lines.length), new ColumnIndex(lines.length)]
    for (let position = 0; position < lines.length; position++) {
      const line = lines.lineAt(position)
      const code = codePattern.exec(line)?.[1]
      const colon = colonPattern.exec(line)?.[1]
      if (code !== undefined || colon !== undefined) {
        const column = flushColumn(line)
        if (code !== undefined) this.code[code[0] === '~' ? 1 : 0].add(column, position, code.length)
        if (colon !== undefined) {
          let index = this.colon.get(colon.length)
          if (index === undefined) {
            index = new ColumnIndex(lines.length)
            this.colon.set(colon.length, index)
          }
          index.add(column, position, 1)
        }
      }
      const comment = commentPattern.exec(line)?.[1]
      if (comment !== undefined) {
        let positions = this.comments.get(comment.length)
        if (positions === undefined) {
          positions = []
          this.comments.set(comment.length, positions)
        }
        positions.push(position)
      }
    }
    for (const index of this.code) index.build()
    for (const index of this.colon.values()) index.build()
  }

  nextCode(marker: string, start: number, end: number, column: number): number | undefined {
    if (marker[0] !== '`' && marker[0] !== '~') return undefined
    return this.code[marker[0] === '~' ? 1 : 0].find(marker.length, start, end, column)
  }

  lastColon(width: number, start: number, end: number, column: number): number | undefined {
    return this.colon.get(width)?.find(1, start, end, column, true)
  }

  nextComment(width: number, start: number, end: number): number | undefined {
    const positions = this.comments.get(width)
    if (positions === undefined) return undefined
    let left = 0, right = positions.length
    while (left < right) {
      const middle = Math.floor((left + right) / 2)
      if (positions[middle]! < start) left = middle + 1
      else right = middle
    }
    const position = positions[left]
    return position !== undefined && position < end ? position : undefined
  }
}

interface RangeNode {
  start: number
  end: number
  height: number
  left: RangeNode | undefined
  right: RangeNode | undefined
}

/** Failed scan positions, stored as disjoint half-open intervals. */
export class FailedScanRanges {
  private root: RangeNode | undefined

  has(position: number): boolean {
    const previous = this.before(position)
    return previous !== undefined && position < previous.end
  }

  add(start: number, end: number): void {
    if (start >= end) return
    const previous = this.before(start)
    if (previous !== undefined && previous.end >= start) {
      start = previous.start
      end = Math.max(end, previous.end)
      this.root = this.remove(this.root, previous.start)
    }
    for (let next = this.after(start); next !== undefined && next.start <= end; next = this.after(start)) {
      end = Math.max(end, next.end)
      this.root = this.remove(this.root, next.start)
    }
    this.root = this.insert(this.root, { start, end, height: 1, left: undefined, right: undefined })
  }

  private before(position: number): RangeNode | undefined {
    let node = this.root, found: RangeNode | undefined
    while (node !== undefined) {
      if (node.start <= position) { found = node; node = node.right }
      else node = node.left
    }
    return found
  }

  private after(position: number): RangeNode | undefined {
    let node = this.root, found: RangeNode | undefined
    while (node !== undefined) {
      if (node.start >= position) { found = node; node = node.left }
      else node = node.right
    }
    return found
  }

  private height(node: RangeNode | undefined): number { return node?.height ?? 0 }
  private update(node: RangeNode): void { node.height = 1 + Math.max(this.height(node.left), this.height(node.right)) }

  private rotateLeft(node: RangeNode): RangeNode {
    const root = node.right!
    node.right = root.left
    root.left = node
    this.update(node)
    this.update(root)
    return root
  }

  private rotateRight(node: RangeNode): RangeNode {
    const root = node.left!
    node.left = root.right
    root.right = node
    this.update(node)
    this.update(root)
    return root
  }

  private balance(node: RangeNode): RangeNode {
    this.update(node)
    const difference = this.height(node.left) - this.height(node.right)
    if (difference > 1) {
      if (this.height(node.left!.left) < this.height(node.left!.right)) node.left = this.rotateLeft(node.left!)
      return this.rotateRight(node)
    }
    if (difference < -1) {
      if (this.height(node.right!.right) < this.height(node.right!.left)) node.right = this.rotateRight(node.right!)
      return this.rotateLeft(node)
    }
    return node
  }

  private insert(node: RangeNode | undefined, added: RangeNode): RangeNode {
    if (node === undefined) return added
    if (added.start < node.start) node.left = this.insert(node.left, added)
    else node.right = this.insert(node.right, added)
    return this.balance(node)
  }

  private remove(node: RangeNode | undefined, start: number): RangeNode | undefined {
    if (node === undefined) return undefined
    if (start < node.start) node.left = this.remove(node.left, start)
    else if (start > node.start) node.right = this.remove(node.right, start)
    else {
      if (node.left === undefined) return node.right
      if (node.right === undefined) return node.left
      let next = node.right
      while (next.left !== undefined) next = next.left
      node.start = next.start
      node.end = next.end
      node.right = this.remove(node.right, next.start)
    }
    return this.balance(node)
  }
}
