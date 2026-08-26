import type { Paragraph } from './ast.js'

/**
 * The paragraphs whose first source line sat ABOVE their container's content
 * column (carve-js#1552).
 *
 * PART 9 §15's strict column-0 rule reaches a block image, so an image indented
 * above its container's content column is a paragraph holding an inline image
 * and takes no caption. `parseParagraph` strips a paragraph's leading
 * indentation, so the AST text cannot tell an indented image from a flush one -
 * and the image's own `pos.startColumn` cannot either: a list item's content
 * column is 3, and so is the column of a two-space-indented image at top level.
 * One of those must promote and the other must not, and the absolute column
 * gives the same answer for both. Reading it is what dropped the caption from a
 * reference image inside a container while the inline form in the same position
 * kept it (carve-js#1553).
 *
 * PARSER-LOCAL, AND DELIBERATELY NOT A PROPERTY ON THE NODE. This records a fact
 * about SOURCE INDENTATION, which the schema does not name, so §11 would refuse
 * a payload carrying it. Carrying it on the node anyway and stripping it at the
 * encoder does not work either: §6's round trip compares `parse(x)` against
 * `fromAstJson(toAstJson(parse(x)))`, and a runtime-only own property makes the
 * two trees structurally unequal - the parsed one has it and the round-tripped
 * one cannot. carve-php keeps the same answer in the same shape, and its own
 * note gives the same reason.
 *
 * A `WeakSet` rather than a `Set`: entries are keyed by node identity and go
 * away with the document, so a long-lived process parsing many documents does
 * not accumulate them.
 *
 * RECORDS THE EXCEPTION, NOT THE RULE. Membership means "indented above the
 * content column", so a paragraph nobody registered promotes - the HTML
 * importer builds one per `<p>` with no source column to report, and such a
 * paragraph is at its container's content column by construction. A missing
 * entry can therefore never silently DISABLE the promotion, which is the
 * failure carve-rs recorded when a hand-built list lead paragraph left its
 * equivalent flag at the conservative default and blocked promotion for every
 * list item in every document.
 */
const aboveContentColumn = new WeakSet<Paragraph>()

/** Record that `para`'s first line sat above its container's content column. */
export function markAboveContentColumn(para: Paragraph): void {
  aboveContentColumn.add(para)
}

/** Whether `para` began at its container's content column. */
export function isAtContentColumn(para: Paragraph): boolean {
  return !aboveContentColumn.has(para)
}
