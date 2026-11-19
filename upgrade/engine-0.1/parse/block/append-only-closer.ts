/** Finds the first closer in an append-only body, excluding its lead line. */
export class AppendOnlyCloser {
  private next = 1
  private closed = false

  constructor(private readonly matches?: (line: string) => boolean) {}

  get active(): boolean { return this.matches !== undefined }

  closedIn(lines: readonly string[]): boolean {
    if (!this.matches || this.closed) return this.closed
    for (; this.next < lines.length; this.next++) {
      if (this.matches(lines[this.next]!)) {
        this.closed = true
        break
      }
    }
    return this.closed
  }
}
