import { ParseSession } from './parse/parse-session.js'
import { stripPositions } from './parse/parse-core.js'
import type { ParseOptions } from './parse/parse-core.js'
import type { Document, InlineNode } from './ast.js'

export { ParseSession }
export {
  AUTOLINK_BODY_EXCLUDED,
  MAX_NESTING_DEPTH,
  RE_ABBR_DEF,
  RE_AFTER_TERM,
  RE_AUTOLINK,
  RE_ESCAPABLE_PUNCTUATION,
  RE_FOOTNOTE_DEF,
  RE_RAW_INLINE_FORMAT,
  TABLE_ALIGNMENT_MARKERS,
  buildBracketMap,
  cellPayloadIsSpanMarker,
  colonFenceOpenerLen,
  definitionListHelpers,
  forEachCrossrefRun,
  hasInvalidContainerMetadata,
  inlineScannerHelpers,
  isBlankLine,
  isBlockAttributeLine,
  isTableRow,
  layoutWork,
  lineBlockHelpers,
  linkDefinitionHelpers,
  listHelpers,
  listStateHelpers,
  markedDelimitedTable,
  mergeAttrs,
  normalizeRefLabel,
  opensCodeFence,
  opensFrontmatter,
  parseAttrs,
  rawBracketRunCloses,
  rawImageBracketRunCloses,
  readCellAttributeBlock,
  scanCellMarkerRun,
  rowAttrsFromLine,
  splitTableRowSpans,
  stripContainerPrefixes,
  stripContainerPrefixesKeepIndent,
  symbolOpensAt,
  tableBlockHelpers,
} from './parse/parse-core.js'
export type {
  AttachedViewScan,
  BlockQuoteLazyState,
  BracketClose,
  CloserIndex,
  CommentScopeMemo,
  CrossrefMemo,
  DanglingBlockAttributes,
  DescendantOpaque,
  EmphasisMatch,
  EmphasisMemo,
  GroupCloserMemo,
  InlinePairView,
  InlineSource,
  ItemLazyState,
  ItemLineFacts,
  LinkDef,
  LinkDefMatch,
  OlKind,
  OpenContainer,
  ParseOptions,
  PendingAttrCarry,
  PrepassScope,
  QuoteLazyHint,
  QuotedFenceCloserMemo,
  RefusedContinuationMarker,
  OverindentedOpenerReport,
  StrippedLineOrigin,
  UnclosedCodeFence,
  UnclosedContainer,
} from './parse/parse-core.js'

export function parse(source: string, opts: ParseOptions = {}): Document {
  return new ParseSession().parse(source, opts)
}

/**
 * The inline nodes of a REFERENCE LABEL, for PART 9R R1's heading-index lookup.
 *
 * R1 keys the heading index by each heading's RENDERED PLAIN TEXT, and says the
 * LABEL enters that same comparison as its rendered plain text - its inline
 * markup stripped exactly as the heading's was. So the label has to be PARSED
 * to be compared: a fixed-character-list strip gets `*bold* heading` right and
 * `` `code()` heading `` wrong, which is why the corpus pins both.
 *
 * Neither the abbreviation table nor `linkDefs` is applied. The label is being
 * read for its plain text, not published: a nested reference inside it must not
 * resolve, and an abbreviation renders as its own text under `inlineText`
 * anyway.
 */
export function parseRefLabelInlines(label: string): InlineNode[] {
  return new ParseSession().parseRefLabelInlines(label)
}


/**
 * The inline nodes of a CONTAINER LABEL - a div's, an admonition's or a fence's
 * unconsumed `[label]`.
 *
 * `CARVE-P9-041` enumerates a div label among the hosts that HAVE an inline run,
 * so the fallback publishes that run and not the characters the author typed
 * (ruled on markup-carve/carve#2572). The label is held as text here, the way the
 * oracle's own layout tree holds it, so the scan happens where it is rendered.
 *
 * Positions are stripped: the label reaches this from an AST field, which carries
 * no offset of its own, and PART 12 section 4 forbids inventing one.
 */
export function parseContainerLabelInlines(label: string): InlineNode[] {
  return stripPositions(new ParseSession().parseRefLabelInlines(label))
}
