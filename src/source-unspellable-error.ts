/** The canonical Carve writer cannot spell an AST node without changing it. */
export class SourceUnspellableError extends Error {
  constructor(
    public readonly nodeType: string,
    public readonly reason: string,
    /** The node to unwrap so the tree becomes spellable, where one exists. */
    public readonly node?: object,
  ) {
    super(`renderCarve cannot spell ${nodeType}: ${reason}`)
    this.name = 'SourceUnspellableError'
  }
}
