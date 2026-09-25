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
