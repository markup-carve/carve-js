/** The canonical Carve writer cannot spell an AST node without changing it. */
export class SourceUnspellableError extends Error {
  constructor(
    public readonly nodeType: string,
    public readonly reason: string,
  ) {
    super(`renderCarve cannot spell ${nodeType}: ${reason}`)
    this.name = 'SourceUnspellableError'
  }
}
