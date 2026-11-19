export class ScopedFenceClosers {
  private readonly leaves: number
  private readonly code: [Uint32Array, Uint32Array]
  private readonly comment = new Map<number, number[]>()
  private readonly colon = new Map<number, number[]>()

  constructor(lines: readonly string[], codePattern: RegExp, commentPattern: RegExp, colonPattern: RegExp) {
    let leaves = 1
    while (leaves < lines.length) leaves *= 2
    this.leaves = leaves
    this.code = [new Uint32Array(leaves * 2), new Uint32Array(leaves * 2)]
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!
      const code = codePattern.exec(line)
      if (code) this.code[code[1]![0] === '~' ? 1 : 0][leaves + i] = code[1]!.length
      for (const [index, match] of [[this.comment, commentPattern.exec(line)], [this.colon, colonPattern.exec(line)]] as const) {
        if (match) {
          const width = match[1]!.length
          const positions = index.get(width) ?? []
          positions.push(i)
          index.set(width, positions)
        }
      }
    }
    for (const tree of this.code) {
      for (let i = leaves - 1; i > 0; i--) tree[i] = Math.max(tree[i * 2]!, tree[i * 2 + 1]!)
    }
  }

  last(kind: 'comment' | 'colon', width: number, start: number, end: number): number | undefined {
    const positions = this[kind].get(width)
    if (!positions) return undefined
    let left = 0
    let right = positions.length
    while (left < right) {
      const mid = Math.floor((left + right) / 2)
      if (positions[mid]! < end) left = mid + 1
      else right = mid
    }
    const last = positions[left - 1]
    return last !== undefined && last >= start ? last : undefined
  }

  codeIn(marker: string, start: number, end: number): boolean {
    if (start >= end || (marker[0] !== '`' && marker[0] !== '~')) return false
    const tree = this.code[marker[0] === '~' ? 1 : 0]
    if (tree[1]! < marker.length) return false
    let left = this.leaves + start
    let right = this.leaves + end
    while (left < right) {
      if (left % 2 === 1) {
        if (tree[left]! >= marker.length) return true
        left++
      }
      if (right % 2 === 1) {
        right--
        if (tree[right]! >= marker.length) return true
      }
      left = Math.floor(left / 2)
      right = Math.floor(right / 2)
    }
    return false
  }
}
