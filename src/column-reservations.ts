/** Rowspan occupancy with logarithmic free-column and row-width queries. */
export class ColumnReservations {
  private minimum: Float64Array | undefined
  private maximum: Float64Array | undefined
  private readonly limit: number

  constructor(limit: number) {
    this.limit = Math.max(1, limit)
  }

  hold(column: number, until: number): void {
    this.minimum ??= new Float64Array(4 * this.limit)
    this.maximum ??= new Float64Array(4 * this.limit)
    this.set(1, 0, this.limit, column, until)
  }

  nextFree(from: number, row: number): number {
    if (!this.maximum || this.maximum[1]! <= row || from >= this.limit) return from
    return this.findFree(1, 0, this.limit, from, row)
  }

  reach(row: number): number {
    if (!this.maximum || this.maximum[1]! <= row) return 0
    let node = 1, left = 0, right = this.limit
    while (right - left > 1) {
      const middle = Math.floor((left + right) / 2)
      if (this.maximum[2 * node + 1]! > row) {
        node = 2 * node + 1
        left = middle
      } else {
        node *= 2
        right = middle
      }
    }
    return right
  }

  private set(node: number, left: number, right: number, column: number, until: number): void {
    const minimum = this.minimum!, maximum = this.maximum!
    if (right - left === 1) {
      minimum[node] = maximum[node] = Math.max(maximum[node]!, until)
      return
    }
    const middle = Math.floor((left + right) / 2)
    if (column < middle) this.set(2 * node, left, middle, column, until)
    else this.set(2 * node + 1, middle, right, column, until)
    minimum[node] = Math.min(minimum[2 * node]!, minimum[2 * node + 1]!)
    maximum[node] = Math.max(maximum[2 * node]!, maximum[2 * node + 1]!)
  }

  private findFree(node: number, left: number, right: number, from: number, row: number): number {
    if (right <= from || this.minimum![node]! > row) return this.limit
    if (this.maximum![node]! <= row) return Math.max(left, from)
    const middle = Math.floor((left + right) / 2)
    const found = this.findFree(2 * node, left, middle, from, row)
    return found < this.limit ? found : this.findFree(2 * node + 1, middle, right, from, row)
  }
}
