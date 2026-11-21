export class LiteralCommentClosers {
  private readonly length: number
  private readonly leaves: number
  private readonly minimums: Float64Array
  private readonly byWidth = new Map<number, number[]>()

  constructor(columns: readonly number[], runs: readonly (number | undefined)[]) {
    if (columns.length !== runs.length) throw new RangeError('Columns and runs must have the same length')
    this.length = columns.length
    let leaves = 1
    while (leaves < columns.length) leaves *= 2
    this.leaves = leaves
    this.minimums = new Float64Array(leaves * 2).fill(Infinity)
    for (let i = 0; i < columns.length; i++) {
      this.minimums[leaves + i] = columns[i]!
      const width = runs[i]
      if (width === undefined) continue
      let positions = this.byWidth.get(width)
      if (positions === undefined) this.byWidth.set(width, positions = [])
      positions.push(i)
    }
    for (let i = leaves - 1; i > 0; i--) {
      this.minimums[i] = Math.min(this.minimums[i * 2]!, this.minimums[i * 2 + 1]!)
    }
  }

  hasCloser(width: number, openerIndex: number, floor: number): boolean {
    if (!Number.isInteger(openerIndex) || openerIndex < 0 || openerIndex >= this.length) return false
    const positions = this.byWidth.get(width)
    if (positions === undefined) return false
    let low = 0
    let high = positions.length
    while (low < high) {
      const middle = Math.floor((low + high) / 2)
      if (positions[middle]! <= openerIndex) low = middle + 1
      else high = middle
    }
    if (low === positions.length) return false
    let left = this.leaves + openerIndex + 1
    let right = this.leaves + positions[low]!
    while (left < right) {
      if (left % 2 === 1) {
        if (this.minimums[left]! < floor) return false
        left++
      }
      if (right % 2 === 1) {
        right--
        if (this.minimums[right]! < floor) return false
      }
      left = Math.floor(left / 2)
      right = Math.floor(right / 2)
    }
    return true
  }

  reachesEnd(openerIndex: number, floor: number): boolean {
    if (!Number.isInteger(openerIndex) || openerIndex < 0 || openerIndex >= this.length) return false
    let left = this.leaves + openerIndex + 1
    let right = this.leaves + this.length
    while (left < right) {
      if (left % 2 === 1) {
        if (this.minimums[left]! < floor) return false
        left++
      }
      if (right % 2 === 1) {
        right--
        if (this.minimums[right]! < floor) return false
      }
      left = Math.floor(left / 2)
      right = Math.floor(right / 2)
    }
    return true
  }
}
