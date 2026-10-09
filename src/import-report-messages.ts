/**
 * Import report messages the contract pins, shared by the entry points that
 * reach the same loss.
 *
 * One copy per loss, not one per importer: the HTML and Markdown sides wrote two
 * sentences for the ordered task item's checkbox, each agreed across the three
 * engines on its own surface, until carve-js#2062 ruled one for both.
 */

/**
 * A checkbox read on an ordered list item, kept as the item's bracket text.
 *
 * The rule behind the loss stays in the contract's prose rather than in the row:
 * `task_marker` hangs off `unordered_item` alone in
 * `resources/spec/03-blocks-core.ebnf`, so no Carve source spells a box on an
 * ordered item. See "A lost checkbox on an ordered task item says it one way" in
 * `docs/html-import-contract.md`.
 */
export const ORDERED_TASK_ITEM_UNSPELLABLE =
  'An ordered task item is not spellable as a Carve task item; the checkbox marker was kept as text'

/**
 * Whitespace an entity decode put at the start of a line, which Carve does not
 * spell there.
 *
 * Dropped rather than substituted: `\\ ` reads as U+00A0, and a non-breaking
 * space is not the tab or space the author wrote (markup-carve/carve#2595).
 */
export const LEADING_WHITESPACE_UNSPELLABLE =
  'Dropped whitespace a decoded reference put at the start of a line; Carve spells no leading whitespace on a paragraph'

/**
 * A leading `---` pair whose content is shaped like a mapping, carried over as
 * Carve front matter rather than read as a thematic break over setext headings
 * (markup-carve/carve#2799).
 *
 * Reported on every conversion, not only the ambiguous ones: the two readings
 * differ in whether a heading survives, so a reader checking an import needs to
 * know which one the importer took.
 */
export const FRONTMATTER_SYNTHESIZED =
  'A leading --- block with mapping-shaped content was carried over as Carve front matter'
