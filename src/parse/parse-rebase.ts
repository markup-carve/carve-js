import type { GroupCloserMemo, ItemLazyState } from '../parse.js'
import { Lexer, indentColumns, isBlankLine, sliceColumns } from './parse-lexer.js'
import type { rebaseHelpers } from '../parse.js'

export function createRebasePass(helpers: typeof rebaseHelpers) {
  const {
    FOOTNOTE_BODY_COLUMN,
    LAZY_FRAME,
    RE_ADMONITION_CLOSE,
    RE_ADMONITION_OPEN,
    RE_BLOCKQUOTE,
    RE_CAPTION,
    RE_COMMENT_LINE,
    RE_DEFLIST_DEF,
    RE_DEFLIST_TERM,
    RE_FENCE,
    RE_FOOTNOTE_DEF,
    RE_HEADING,
    RE_HR,
    RE_LINE_BLOCK_OPEN,
    RE_LINK_DEF,
    RE_ORDERED,
    RE_RAW_FENCE,
    RE_TASK,
    RE_UNORDERED,
    blockQuoteParagraphOpen,
    bottomBlockLeavesParagraphOpen,
    collectLiteralColonFenceBody,
    colonBlockOpenerRun,
    colonFenceOpenerLen,
    commentCloserLookup,
    commentFenceRun,
    extractItemAttr,
    fenceCloseRe,
    hostedAuthoredBlockOpener,
    isBlockAttributeLine,
    isContinuationMarker,
    isLinkDefLine,
    isListMarkerLine,
    isParentAuthoredBlock,
    isTableRow,
    leadingWhitespace,
    lineOpensBlock,
    lineOpensItemBlock,
    markerContentColumn,
    markerFreeContent,
    markerLineQuoteState,
    opaqueGroupCloser,
    opaqueGroupCloses,
    opensCodeFence,
    opensWrappedAttributeBlock,
    peekBlockAttributes,
    quotePrefixDepth,
    rebasedCodeFenceEnd,
    rebasedColonGroupEnd,
    rebasedQuoteEnd,
    sourceCodeFenceEnd,
    sourceColumn,
    stripLazyFrame,
    trackBlockQuoteLazyState,
    trackItemLazyState,
    verbatimOnlyLazyState,
  } = helpers
function paragraphTextLine(line: string): boolean {
  const text = line.trimStart()
  return bottomBlockLeavesParagraphOpen(text) && !lineOpensBlock(text)
}

return function rebaseOverindentedBlocks(
  lines: string[],
  eligible?: ReadonlySet<number>,
  leadNestedColumn = -1,
  includeSublists = false,
  // Set only when rebasing a FOOTNOTE body, where a nested note keeps its
  // authored column - see the flatten note at the dedent below. Every other
  // host still rebases an over-indented note so it registers (corpus 447).
  hostIsFootnoteBody = false,
  onFenceBodyLine?: (index: number) => void,
  onUnclosedCodeFence?: () => void,
  // Lines the HOST took from below its own content column. Their leading run is
  // alignment under that host rather than an authored column, so a colon group
  // must not dedent one onto its base - see the dedent below.
  takenBelowColumn?: ReadonlySet<number>,
  markerColonOwnsExtent = false,
  sourceLines?: readonly (string | undefined)[],
  tabFenceColumns?: ReadonlyMap<number, number>,
  noteParagraph?: { markers?: ReadonlySet<number>, markerBody?: boolean },
  itemParagraphFences?: ReadonlySet<number>,
  lazyParagraphFences?: ReadonlySet<number>,
  descriptionItem = false,
  stripLeftCodePrefix = false,
  // A description or footnote body folds a marker into its open paragraph (PART 9 §10 I2).
  foldsMarkers = false,
  authoredOpeners?: ReadonlySet<number>,
  hostOwnedBlockStarts?: ReadonlySet<number>,
  termSourceLines?: readonly (string | undefined)[],
  termHostContentColumn = -1,
): Set<number> {
  const ownedBlanks = new Set<number>()
  const groupCloserMemos = new Map<number, GroupCloserMemo>()
  // One index for the whole pass; a dedent only moves leading whitespace.
  let commentCloser: ((width: number, index: number) => number) | undefined
  let colonCommentCloser: ((width: number, index: number) => number) | undefined
  const firstVisible = lines.find((line) => !isBlankLine(line))
  const firstMarkerColumn = firstVisible === undefined ? -1 : markerContentColumn(firstVisible)
  if (firstMarkerColumn >= 0) {
    const hasParentOwnedCandidate = lines.some((line, index) => {
      if (isBlankLine(line) || (eligible && !eligible.has(index))) return false
      return isParentAuthoredBlock(line, firstMarkerColumn, index > 0 && isBlankLine(lines[index - 1]!))
    })
    if (!hasParentOwnedCandidate) return ownedBlanks
  }
  // A sub-list may open on the item's marker line, which is not part of
  // `lines`. Seed its ownership column so a following line at that child's
  // content column is left for the child's collector (for example
  // `- > - - x` / `  >     # h`).
  //
  // ONE column, not a stack. A line at or past the open child's content column
  // is handed to that child whatever it is, so a deeper marker inside the child
  // could only ever be popped again before it decided anything - the deeper
  // entries were unreachable. Keeping one column is also what makes the scan
  // linear: `cap` below bounds every measurement by the child's column instead
  // of by the line's own indentation, so a ladder does not re-read the same
  // leading run once per level (carve#752's counted bound).
  let ownedColumn = leadNestedColumn
  let ownedMarkerBase = -1
  let ownedParagraphOpen = false
  let quoteProbe: Lexer | undefined
  let markerColonEnd = -1
  let inlineLeadPayload = false
  let childColonWidth: number | null = null
  let leadCommentBase = -1
  const markerColonNestedBody = new Set<number>()
  let absorbingColonParagraph = false
  let footnoteParagraphOpen = false
  const foldedMarkers = new Set<number>()
  const paragraphOwnedNotes = new Map<number, number>()
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (isBlankLine(line)) { absorbingColonParagraph = false; footnoteParagraphOpen = false; ownedParagraphOpen = false; continue }
    if (noteParagraph?.markerBody) {
      const text = line.trimStart()
      if (footnoteParagraphOpen && isListMarkerLine(text)) continue
      footnoteParagraphOpen = !lineOpensItemBlock(text) && !RE_COMMENT_LINE.test(text)
    }
    if (i <= markerColonEnd && takenBelowColumn?.has(i) && opensCodeFence(line.trimStart())) inlineLeadPayload = true
    if (inlineLeadPayload && i <= markerColonEnd) continue
    if (eligible && !eligible.has(i)) continue
    if (authoredOpeners?.has(i)) ownedColumn = -1
    const cap = ownedColumn >= 0 ? ownedColumn + 1 : Infinity
    const base = indentColumns(line, cap)
    if (i <= markerColonEnd && !(ownedColumn >= 0 && base >= ownedColumn)) {
      const childColumn = markerContentColumn(line)
      if (childColumn >= 0) ownedColumn = childColumn
    }
    if (i <= markerColonEnd && RE_COMMENT_LINE.test(line.trimStart()) && base > 0) leadCommentBase = base
    if (i <= markerColonEnd && leadCommentBase >= 0 && base >= leadCommentBase && RE_FOOTNOTE_DEF.test(line.trimStart())) continue
    if (i <= markerColonEnd && ownedColumn >= 0 && base >= ownedColumn) {
      ownedParagraphOpen = false
      continue
    }
    if (i <= markerColonEnd && (RE_ADMONITION_CLOSE.test(line.trimStart()) ||
      (base > 0 && (markerColonNestedBody.has(i) || (!RE_FOOTNOTE_DEF.test(line.trimStart()) && !RE_LINK_DEF.test(line.trimStart())))))) continue
    // A deeper item owns this line. Its own collector will see the line after
    // the intervening marker/content columns have been removed and will apply
    // the authored-base rule in that coordinate system.
    if (ownedColumn >= 0 && base >= ownedColumn) {
      if (lineOpensItemBlock(line.trimStart()) || RE_COMMENT_LINE.test(line.trimStart()) ||
          isBlockAttributeLine(line.trimStart())) {
        const group = opensCodeFence(line.trimStart()) ? opaqueGroupCloser(line.trimStart()) : null
        let memo = groupCloserMemos.get(base)
        if (memo === undefined) groupCloserMemos.set(base, memo = { verbatim: new Map(), comment: new Map() })
        if (group === null || opaqueGroupCloses(group, lines, i + 1, base, takenBelowColumn, memo, ownedColumn)) ownedParagraphOpen = false
      }
      continue
    }
    if (ownedColumn >= 0 && RE_COMMENT_LINE.test(line) && commentFenceRun(line) === undefined) {
      ownedParagraphOpen = false
      continue
    }
    if (childColonWidth !== null && ownedColumn >= 0) {
      const close = RE_ADMONITION_CLOSE.exec(line.trimStart())
      if (close?.[1]?.length === childColonWidth || (lineOpensItemBlock(line.trimStart()) && !opensCodeFence(line.trimStart()) && !RE_COMMENT_LINE.test(line.trimStart()))) childColonWidth = null
      else continue
    }
    // An unmatched fence below a child's column continues its paragraph. Keep
    // the child column so a later line at that column is still the child's.
    if (ownedColumn >= 0 && ownedParagraphOpen && opensCodeFence(line.trimStart())) {
      const group = opaqueGroupCloser(line.trimStart())!
      let memo = groupCloserMemos.get(base)
      if (memo === undefined) groupCloserMemos.set(base, memo = { verbatim: new Map(), comment: new Map() })
      if (!opaqueGroupCloses(group, lines, i + 1, base, takenBelowColumn, memo)) continue
    }
    const belowOwnedChild = ownedColumn >= 0
    if (belowOwnedChild && ownedParagraphOpen && RE_FOOTNOTE_DEF.test(line.trimStart()))
      paragraphOwnedNotes.set(i, ownedMarkerBase)
    ownedColumn = -1
    ownedMarkerBase = -1
    ownedParagraphOpen = false
    // Folded note text owns deeper lines without opening a child list.
    if (noteParagraph?.markers?.has(i)) {
      ownedColumn = base + 1
      continue
    }
    const markerColumn = markerContentColumn(line)
    if (markerColumn >= 0 && foldsMarkers && !belowOwnedChild && i > 0 &&
        (foldedMarkers.has(i - 1) || paragraphTextLine(lines[i - 1]!))) {
      // Folded text opens no item, so a deeper line is read in the body itself.
      foldedMarkers.add(i)
      continue
    }
    if (markerColumn >= 0) {
      ownedColumn = markerColumn
      ownedMarkerBase = base
      const childContent = markerFreeContent(line.trimStart())
      ownedParagraphOpen = bottomBlockLeavesParagraphOpen(childContent) &&
        colonFenceOpenerLen(childContent) === null && !opensCodeFence(childContent)
      childColonWidth = colonFenceOpenerLen(childContent)
      continue
    }
    if (!includeSublists && base === 0 && RE_BLOCKQUOTE.test(line) &&
        blockQuoteParagraphOpen(markerLineQuoteState(line)!)) {
      const quote = quoteProbe ??= new Lexer([])
      quote.lines = lines
      quote.pos = i
      i = rebasedQuoteEnd(lines, i, quote)
      continue
    }
    if (base === 0 && RE_LINE_BLOCK_OPEN.test(line)) {
      const payload = quoteProbe ??= new Lexer([])
      payload.lines = lines
      payload.pos = i + 1
      collectLiteralColonFenceBody(payload, { kind: 'line block', lineIndex: i, fenceWidth: colonFenceOpenerLen(line.replace(/^[ \t]+/, ''))! })
      i = payload.pos - 1
      continue
    }
    // CARVE-P2-017 and section 10 I4: unmatched runs remain paragraph text.
    // Inline code cannot hide later visible block openers in the description.
    let descriptionParagraphFence = false
    if (includeSublists && itemParagraphFences?.has(i) && opensCodeFence(line.trimStart())) {
      const group = opaqueGroupCloser(line.trimStart())!
      const closesAt = (column: number): boolean => {
        let memo = groupCloserMemos.get(column)
        if (memo === undefined) groupCloserMemos.set(column, memo = { verbatim: new Map(), comment: new Map() })
        return opaqueGroupCloses(group, lines, i + 1, column, takenBelowColumn, memo)
      }
      descriptionParagraphFence = !closesAt(base) && !closesAt(0)
    }
    if (base === 0 && !descriptionParagraphFence) {
      // Opaque groups already at the container's minimum column still own
      // their payload. Without advancing past them, a payload line that looks
      // like a block opener is reconsidered as an authored base of its own.
      // `~~~~ / one-space ``` / ~~~~` then loses that content space and the
      // writer is not a fixed point.
      const code = RE_FENCE.exec(line) ?? RE_RAW_FENCE.exec(line)
      const comment = code ? undefined : commentFenceRun(line)
      if (code || comment !== undefined) {
        let end = i
        if (code) {
          const marker = RE_FENCE.test(line) ? code[2]! : code[1]!
          const close = fenceCloseRe(marker)
          for (let j = i + 1; j < lines.length; j++) {
            end = j
            if (close.test(lines[j]!)) break
          }
        } else {
          // An unmatched fence is one comment line and owns no successor (§28).
          const close = (commentCloser ??= commentCloserLookup(lines))(comment!, i)
          if (close < 0) continue
          end = close
        }
        i = end
        continue
      }
    }
    const opener = sliceColumns(line, base, true)
    if (base === 0 && /^:{3,}/.test(opener) && colonBlockOpenerRun(opener) === null) absorbingColonParagraph = true
    else if (base === 0 && hostedAuthoredBlockOpener(opener)) absorbingColonParagraph = false
    if (!lineOpensItemBlock(opener)) continue
    // Sublists already use the containment rule in the item collector. Their
    // residual indentation expresses another nesting level, not an authored
    // base to erase here.
    if (!includeSublists && (
      RE_ORDERED.test(opener) ||
      RE_UNORDERED.test(opener) ||
      RE_TASK.test(opener) ||
      extractItemAttr(opener) !== null
    ))
      continue

    let end = i
    let noteReturnsToParagraphOwner = false
    // Lines this group leaves at the column the host folded them to, so the
    // dedent below skips them as well. See the colon arm.
    const heldFoldedLines = new Set<number>()
    const definitionEntry = RE_DEFLIST_TERM.test(opener) || RE_DEFLIST_DEF.test(opener)
    if (definitionEntry) {
      const authoredBase = sourceLines?.[i] === undefined ? base : sourceColumn(sourceLines[i]!)
      // A definition list is one complete block, including every description
      // body that reaches that description's own content column.  Measuring
      // only to the separating blank made an ancestor claim the next opener as
      // its sibling; measuring every line at the list's base made the opposite
      // mistake and swallowed below-description content.  Ownership belongs to
      // the innermost open body, so keep its exact column band here.
      let descriptionColumn: number | null = null
      let descriptionState: ItemLazyState | undefined
      let descriptionFenceClaimsBelow = false
      const descriptionCloserMemos = new Map<string, GroupCloserMemo>()
      // A term has no content column of its own, so a line past the list's
      // base folds into an open term and is never an authored block
      // (carve#2411). Only a list marker still interrupts it (§24 C4).
      let termOpen = RE_DEFLIST_TERM.test(opener)
      let termFloorText = false
      let foldedSeparator = false
      let returnedSeparator = false
      const sourceTermHostColumn = termSourceLines?.[i] === undefined
        ? authoredBase : sourceColumn(termSourceLines[i]!)
      for (let j = i + 1; j < lines.length; j++) {
        const candidate = lines[j]!
        if (foldedSeparator && RE_DEFLIST_TERM.test(candidate.trimStart()) &&
            (sourceLines?.[j] === undefined || sourceColumn(sourceLines[j]!) >= termHostContentColumn)) break
        if (candidate.startsWith(LAZY_FRAME) && RE_DEFLIST_DEF.test(stripLazyFrame(candidate).trimStart())) {
          returnedSeparator = true
          if (sourceLines?.[j] !== undefined && sourceColumn(sourceLines[j]!) === termHostContentColumn)
            foldedSeparator = true
        }
        if (termOpen && returnedSeparator && authoredOpeners?.has(j) && termSourceLines?.[j] !== undefined &&
            sourceColumn(termSourceLines[j]!) > sourceTermHostColumn &&
            lineOpensItemBlock(candidate.trimStart())) break
        if (isBlankLine(candidate)) {
          descriptionFenceClaimsBelow = false
          if (termFloorText) break
          termOpen = false
          let k = j + 1
          while (k < lines.length && isBlankLine(lines[k]!)) k++
          if (k >= lines.length || k - j > 1) break
          const nextColumn = indentColumns(lines[k]!)
          const nextLocal = nextColumn < base ? '' : sliceColumns(lines[k]!, base, true)
          const continues =
            (descriptionColumn !== null && nextColumn >= descriptionColumn) ||
            (nextColumn === base && (RE_DEFLIST_TERM.test(nextLocal) || RE_DEFLIST_DEF.test(nextLocal)))
          if (!continues) break
          ownedBlanks.add(j)
          end = j
          continue
        }
        const column = indentColumns(candidate)
        if (descriptionColumn !== null && descriptionFenceClaimsBelow && descriptionState?.opaque?.kind === 'code' &&
            column < descriptionColumn && (opensCodeFence(candidate) || !lineOpensItemBlock(candidate))) {
          end = j
          continue
        }
        // PART 0: a line that opens nothing continues the open description
        // paragraph lazily, whether the host took it from below its column or
        // it sits between the list's base and the description column.
        if (descriptionColumn !== null && descriptionState?.lazyFoldable &&
            (takenBelowColumn?.has(j) || (!termOpen && column >= base && column < descriptionColumn && !isContinuationMarker(candidate))) &&
            !lineOpensItemBlock(candidate.trimStart()) && !RE_COMMENT_LINE.test(candidate.trimStart())) {
          end = j
          continue
        }
        if (descriptionColumn !== null && descriptionState?.lazyFoldable && !descriptionState.inlineFenceParagraph && column < descriptionColumn &&
            opensCodeFence(candidate.trimStart())) {
          let memo = groupCloserMemos.get(column)
          if (memo === undefined) {
            memo = { verbatim: new Map(), comment: new Map() }
            groupCloserMemos.set(column, memo)
          }
          const group = opaqueGroupCloser(candidate.trimStart())!
          if (!opaqueGroupCloses(group, lines, j + 1, column, takenBelowColumn, memo)) {
            end = j
            continue
          }
        }
        if (descriptionColumn !== null && descriptionState?.lazyFoldable &&
            column < descriptionColumn && RE_COMMENT_LINE.test(candidate.trimStart())) {
          // X1 admits a below-column comment without ending its description.
          // The next line still chooses its owner by the description column.
          descriptionState.lazyFoldable = false
          const width = commentFenceRun(candidate.trimStart())
          if (width !== undefined) {
            const close = (commentCloser ??= commentCloserLookup(lines))(width, j)
            if (close > j) j = close
          }
          end = j
          continue
        }
        if (descriptionColumn !== null && column < descriptionColumn &&
            colonFenceOpenerLen(candidate.trimStart()) !== null) break
        if (column < base) {
          const authoredColumn = sourceLines?.[j] === undefined ? column : sourceColumn(sourceLines[j]!)
          if (termOpen && !isListMarkerLine(candidate.trimStart()) &&
              (authoredColumn > authoredBase ||
                (!lineOpensItemBlock(candidate.trimStart()) && !opensCodeFence(candidate.trimStart())))) {
            const comment = commentFenceRun(candidate.trimStart())
            if (comment !== undefined) {
              const close = (commentCloser ??= commentCloserLookup(lines))(comment, j)
              if (close > j) j = close
            }
            end = j
            continue
          }
          break
        }
        const local = sliceColumns(candidate, base, true)
        const description = column === base ? RE_DEFLIST_DEF.exec(local) : null
        if (column === base && (RE_DEFLIST_TERM.test(local) || description !== null)) {
          // A description still belongs to the term after ordinary term text.
          // A following term starts a separate authored block.
          if (termFloorText && description === null) break
          end = j
          termOpen = description === null
          if (description) {
            descriptionColumn = base + 1 + description[1]!.length
            descriptionState = verbatimOnlyLazyState()
            descriptionFenceClaimsBelow = false
            trackItemLazyState(description[2]!, descriptionState)
          }
          continue
        }
        if (termOpen && column === base && opensWrappedAttributeBlock(local)) {
          const attributes = quoteProbe ??= new Lexer([])
          attributes.lines = lines
          attributes.pos = j
          if (peekBlockAttributes(attributes, local)) break
        }
        if (termOpen &&
            (column > base
              ? !isListMarkerLine(local.trimStart())
              : markerContentColumn(local) < 0 && !lineOpensItemBlock(local) && !RE_COMMENT_LINE.test(local))) {
          if (column === base) termFloorText = true
          // A comment fence keeps its body and closer, whatever they look like.
          const comment = commentFenceRun(sliceColumns(candidate, column, true))
          if (comment !== undefined) {
            const close = (commentCloser ??= commentCloserLookup(lines))(comment, j)
            if (close > j) j = close
          }
          end = j
          continue
        }
        termOpen = false
        if (descriptionColumn !== null && column >= descriptionColumn) {
          const text = candidate.trimStart()
          onFenceBodyLine?.(j)
          const wasCodeFence = descriptionState?.opaque?.kind === 'code'
          const hadOpenParagraph = descriptionState?.lazyFoldable === true
          if (descriptionState) trackItemLazyState(text, descriptionState, () => {
            const group = opaqueGroupCloser(text)
            if (group === null) return false
            const closesAt = (atColumn: number): boolean => {
              const key = `${descriptionColumn}:${atColumn}`
              let memo = descriptionCloserMemos.get(key)
              if (memo === undefined) {
                memo = { verbatim: new Map(), comment: new Map() }
                descriptionCloserMemos.set(key, memo)
              }
              return opaqueGroupCloses(group, lines, j + 1, atColumn, takenBelowColumn, memo, descriptionColumn!)
            }
            return closesAt(column) || closesAt(descriptionColumn!)
          }, true, width => (commentCloser ??= commentCloserLookup(lines))(width, j) > j)
          if (!wasCodeFence && descriptionState?.opaque?.kind === 'code')
            descriptionFenceClaimsBelow = hadOpenParagraph && column > descriptionColumn
          else if (descriptionState?.opaque?.kind !== 'code') descriptionFenceClaimsBelow = false
          end = j
          continue
        }
        break
      }
    }
    const code = RE_FENCE.exec(opener) ?? RE_RAW_FENCE.exec(opener)
    const comment = code ? undefined : commentFenceRun(opener)
    const colon = code || comment !== undefined ? null : colonBlockOpenerRun(opener)
    const source = code && tabFenceColumns?.has(i) ? sourceLines?.[i] : undefined
    const sourceCodeBase = source !== undefined && source.slice(0, leadingWhitespace(source)).includes('\t')
      ? indentColumns(source) : undefined

    if (code) {
      // Only the item's own paragraph releases a differently indented list marker.
      const marker = RE_FENCE.test(opener) ? code[2]! : code[1]!
      if (!includeSublists && itemParagraphFences?.has(i) && sourceCodeBase === undefined) {
        onUnclosedCodeFence?.()
        for (let j = i + 1; j < lines.length; j++) {
          const candidate = lines[j]!
          const column = indentColumns(candidate)
          if (column > 0 && column !== base && isListMarkerLine(candidate.trimStart())) break
          end = j
          onFenceBodyLine?.(j)
          if (takenBelowColumn?.has(j)) heldFoldedLines.add(j)
        }
      } else end = sourceCodeBase === undefined
        ? rebasedCodeFenceEnd(lines, i, base, marker, heldFoldedLines, takenBelowColumn,
          onFenceBodyLine, onUnclosedCodeFence, includeSublists && itemParagraphFences?.has(i) ? (line, index) => {
            const text = line.trimStart()
            if (RE_FENCE.test(opener) && indentColumns(line, base) < base && RE_COMMENT_LINE.test(text)) return true
            return (descriptionParagraphFence || lazyParagraphFences?.has(i) === true) && eligible?.has(index) === true &&
              (RE_HEADING.test(text) || RE_BLOCKQUOTE.test(text) || RE_HR.test(text) || isTableRow(text) ||
                colonFenceOpenerLen(text) !== null || (descriptionParagraphFence &&
                  (RE_DEFLIST_TERM.test(text) || RE_DEFLIST_DEF.test(text) || isBlockAttributeLine(text))))
          } : undefined)
        : sourceCodeFenceEnd(lines, i, base, marker, heldFoldedLines, takenBelowColumn,
          onFenceBodyLine, onUnclosedCodeFence, sourceCodeBase, sourceLines!)
    } else if (comment !== undefined) {
      const closeAt = (commentCloser ??= commentCloserLookup(lines))(comment, i)
      for (let j = i + 1; j < lines.length; j++) {
        const candidate = lines[j]!
        if (!isBlankLine(candidate) && indentColumns(candidate, base) < base) break
        end = j
        if (
          !isBlankLine(candidate) &&
          commentFenceRun(sliceColumns(candidate, base, true)) === comment
        )
          break
        if (j < closeAt) heldFoldedLines.add(j)
      }
    } else if (colon !== null) {
      const typedContainer = RE_ADMONITION_OPEN.test(opener) && !RE_ADMONITION_CLOSE.test(opener)
      let closerMemo = groupCloserMemos.get(base)
      if (closerMemo === undefined) {
        closerMemo = { verbatim: new Map(), comment: new Map() }
        groupCloserMemos.set(base, closerMemo)
      }
      end = rebasedColonGroupEnd(
        lines, i, base, colon, heldFoldedLines,
        (width, index) => (colonCommentCloser ??= commentCloserLookup(lines, false))(width, index),
        closerMemo,
        takenBelowColumn, onFenceBodyLine,
        !absorbingColonParagraph && (!includeSublists || typedContainer) ? markerColonNestedBody : undefined,
        (!includeSublists && descriptionItem && !RE_LINE_BLOCK_OPEN.test(opener)) || (includeSublists && typedContainer),
        !includeSublists,
        hostIsFootnoteBody,
      )
      if (markerColonOwnsExtent && i === 0 && base === 0 && !RE_LINE_BLOCK_OPEN.test(opener)) {
        markerColonEnd = end
        for (let j = i + 1; j <= end; j++) if (isBlankLine(lines[j]!)) ownedBlanks.add(j)
        end = i
      }
    } else if (!definitionEntry && (
      RE_BLOCKQUOTE.test(opener) ||
      // A LINK REFERENCE DEFINITION HAS NO BODY, so it owns no run at all - it
      // is one line by construction, since a definition cannot take its
      // destination from the next line. Listing it here let it swallow the line
      // below, which is how a SECOND definition written between two open
      // content columns kept its residual indent and reached the page as
      // characters while still registering.
      RE_FOOTNOTE_DEF.test(opener)
    )) {
      // A final line below the nested note's own column returns to its parent.
      const runColumn = RE_FOOTNOTE_DEF.test(opener)
        ? Math.max(base, FOOTNOTE_BODY_COLUMN)
        : base
      const authoredNoteBodyColumn = RE_FOOTNOTE_DEF.test(opener)
        ? (paragraphOwnedNotes.has(i)
          ? sourceColumn(sourceLines?.[i] ?? lines[i]!)
          : indentColumns(lines[i]!)) + FOOTNOTE_BODY_COLUMN : undefined
      // A QUOTE IS REACHED BY ITS MARKER, so the run ends where the quote stops
      // reaching: a line that carries no marker is the quote's only as the lazy
      // continuation of an OPEN PARAGRAPH (markup-carve/carve-js#2536). The
      // column test below answers the footnote body's question, and asking it of
      // a quote let one that ended in a table, a heading or a break claim every
      // indented line under it - so an over-indented table row below
      // `: > | a |` was never reconsidered as a block of its own, kept the
      // residual indent, and reached the page as prose. `rebasedQuoteEnd` is the
      // same reach the `!includeSublists` arm above already measures.
      const quoted = RE_FOOTNOTE_DEF.test(opener) ? null : markerLineQuoteState(opener)
      let returnedToHost = false
      for (let j = i + 1; j < lines.length; j++) {
        const candidate = lines[j]!
        if (hostOwnedBlockStarts?.has(j)) returnedToHost = true
        if (isBlankLine(candidate)) {
          // An unmarked blank ends a quote (CARVE-P2-008). The next block
          // gets its own footnote-body base (CARVE-P0-004, carve#2598).
          if (hostIsFootnoteBody && RE_BLOCKQUOTE.test(opener)) break
          let k = j + 1
          while (k < lines.length && isBlankLine(lines[k]!)) k++
          if (k >= lines.length || indentColumns(lines[k]!, runColumn) < runColumn) break
          // Past an unmarked blank only a marked line or the quote's caption
          // is still the quote's.
          if (quoted !== null && !RE_BLOCKQUOTE.test(lines[k]!.replace(/^[ \t]+/, '')) &&
              !RE_CAPTION.test(sliceColumns(lines[k]!, base, true))) break
          end = j
          continue
        }
        if (indentColumns(candidate, runColumn) < runColumn) {
          noteReturnsToParagraphOwner = authoredNoteBodyColumn !== undefined &&
            paragraphOwnedNotes.has(i) && indentColumns(candidate) > paragraphOwnedNotes.get(i)! &&
            !lineOpensItemBlock(candidate.trimStart())
          break
        }
        if (authoredNoteBodyColumn !== undefined && sourceLines?.[j] !== undefined &&
            sourceColumn(sourceLines[j]!) < authoredNoteBodyColumn && paragraphOwnedNotes.has(i) &&
            !returnedToHost &&
            indentColumns(candidate) > paragraphOwnedNotes.get(i)! &&
            opaqueGroupCloser(candidate.trimStart()) !== null) break
        if (authoredNoteBodyColumn !== undefined && sourceLines?.[j] !== undefined &&
            sourceColumn(sourceLines[j]!, quotePrefixDepth(sourceLines[j]!)) < authoredNoteBodyColumn &&
            paragraphOwnedNotes.has(i) && indentColumns(candidate) > paragraphOwnedNotes.get(i)! &&
            !returnedToHost &&
            !isContinuationMarker(candidate.trimStart()) &&
            opaqueGroupCloser(candidate.trimStart()) === null) {
          noteReturnsToParagraphOwner = !lineOpensItemBlock(candidate.trimStart())
          if (!noteReturnsToParagraphOwner)
            lines[j] = sliceColumns(candidate, Math.max(0, base - paragraphOwnedNotes.get(i)!), true)
          break
        }
        if (authoredNoteBodyColumn !== undefined &&
            (paragraphOwnedNotes.has(i) && sourceLines?.[j] !== undefined
              ? sourceColumn(sourceLines[j]!)
              : indentColumns(candidate, authoredNoteBodyColumn)) < authoredNoteBodyColumn &&
            lineOpensItemBlock(candidate.trimStart()) &&
            !RE_FOOTNOTE_DEF.test(candidate.trimStart()) &&
            !returnedToHost) break
        if (quoted !== null) {
          // AN OVER-INDENTED MARKER IS STILL THE MARKER, and `RE_BLOCKQUOTE` is
          // anchored - reading a line the author wrote one column in as
          // unmarked would end the run on a question about indentation rather
          // than about the quote's reach.
          const local = sliceColumns(candidate, base, true)
          const marked = RE_BLOCKQUOTE.exec(local.replace(/^[ \t]+/, ''))
          if (marked) trackBlockQuoteLazyState(marked[1] ?? '', quoted, () => true, () => true)
          else if (!blockQuoteParagraphOpen(quoted)) break
          // An unmarked opener at the run's own column interrupts the quote
          // and is a rebase group of its own, with its own payload and closer.
          else if ((leadingWhitespace(local) === 0 && (lineOpensItemBlock(local) || RE_CAPTION.test(local))) ||
            (leadingWhitespace(local) > 0 && isLinkDefLine(local.trimStart()))) break
          else trackBlockQuoteLazyState(local, quoted, () => true, () => true, undefined, undefined, false)
        }
        end = j
      }
    }

    // A caption is a structural continuation of the captionable block above
    // it and shares that block's authored base. Leaving the caption behind at
    // the residual indentation turns it into escaped prose.
    const caption = lines[end + 1]
    if (
      caption !== undefined &&
      !isBlankLine(caption) &&
      indentColumns(caption, base) >= base &&
      RE_CAPTION.test(sliceColumns(caption, base, true))
    ) {
      end++
    }

    // Preserve the written column when flattening would hand a sibling tail to this note.
    const keepsAuthoredColumn = (hostIsFootnoteBody || noteReturnsToParagraphOwner ||
      (i + 2 === lines.length && lines[i + 1] !== undefined &&
        !RE_ADMONITION_CLOSE.test(lines[i + 1]!.trimStart()) &&
        !RE_LINE_BLOCK_OPEN.test(lines[i + 1]!.trimStart()) &&
        indentColumns(lines[i + 1]!, base + FOOTNOTE_BODY_COLUMN) < base + FOOTNOTE_BODY_COLUMN)) &&
      RE_FOOTNOTE_DEF.test(opener) && base > 0 &&
      !foldedMarkers.has(i - 1) && !(i > 0 && /^\+[ \t]+\S/.test(lines[i - 1]!))
    if (!keepsAuthoredColumn) {
      if (sourceCodeBase !== undefined) {
        for (let j = i; j <= end; j++) {
          const sourceLine = sourceLines?.[j]
          if (sourceLine !== undefined) {
            if (!heldFoldedLines.has(j)) lines[j] =
              indentColumns(sourceLine, sourceCodeBase) >= sourceCodeBase
                ? sliceColumns(sourceLine, sourceCodeBase, true)
                : sourceLine.slice(leadingWhitespace(sourceLine))
          } else if (!isBlankLine(lines[j]!) && indentColumns(lines[j]!, base) >= base && !heldFoldedLines.has(j)) {
            lines[j] = sliceColumns(lines[j]!, base, true)
          }
        }
      } else {
        for (let j = i; j <= end; j++) {
          if (!isBlankLine(lines[j]!) && !heldFoldedLines.has(j)) {
            const column = indentColumns(lines[j]!)
            if (column >= base || code &&
                (stripLeftCodePrefix || !itemParagraphFences?.has(i) && !lazyParagraphFences?.has(i))) {
              lines[j] = sliceColumns(lines[j]!, Math.min(base, column), true)
            }
          }
        }
      }
    }
    i = end
  }
  return ownedBlanks
}

}
