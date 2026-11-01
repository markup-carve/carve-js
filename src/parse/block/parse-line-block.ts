import type { Lexer } from '../parse-lexer.js'
import type { InlineSource } from '../../parse.js'
import type { LinkDef } from '../inline/inline-resolution.js'
import type { BlockNode, Comment, InlineNode, LineBlock, Paragraph, Position } from '../../ast.js'
import { trimNonNbsp } from '../../trim-non-nbsp.js'

const RE_VERSE_COMMENT_OPEN = /^ {0,3}(%{3,})(.*)$/
const RE_VERSE_COMMENT_RUN = /^[ \t]*(%{3,})/

export interface LineBlockHost {
  definitionRegionLines: Set<number> | null
  inMatcherRequest: boolean
  inLineBlock: boolean
  activeMatchers: readonly unknown[]
  quoteGlyphHasNul: boolean
  parseInline(text: string, abbrDefs: Map<string, string>, linkDefs?: Map<string, LinkDef>, source?: InlineSource, captionContext?: boolean): InlineNode[]
}

export function createLineBlockParser(helpers: typeof import('../../parse.js').lineBlockHelpers) {
  const { RE_LINE_BLOCK_OPEN, collectLiteralColonFenceBody, dropTrailingSpaces, expandLineBlockWhitespace, inlineSource, isBlankLine, mapInlineChildren, restoreVerseGaps, stripLazyFrame, stripPositions, trimEndSpaceTab, verseSourceOffset, visitInlineChildren } = helpers

  return function parseLineBlock(host: LineBlockHost, lexer: Lexer): LineBlock {
    const openLineIndex = lexer.pos
    const open = lexer.consume()
    const m = RE_LINE_BLOCK_OPEN.exec(open)!
    const fence = m[1]!.length
    if (host.definitionRegionLines && !host.inMatcherRequest) {
      const body = collectLiteralColonFenceBody(lexer, {
        kind: 'line block', lineIndex: openLineIndex, fenceWidth: fence,
      })
      host.definitionRegionLines.add(lexer.lineNumber(openLineIndex))
      for (const line of body) host.definitionRegionLines.add(lexer.lineNumber(line.lineIndex))
      if (lexer.pos > openLineIndex + 1) host.definitionRegionLines.add(lexer.lineNumber(lexer.pos - 1))
      return { type: 'line_block', children: [] }
    }
    interface StanzaLine {
      text: string
      lineIndex: number
      /** Identity mapping unless tabs introduce generated columns. */
      sourceOffsets: Array<number | undefined> | undefined
      sourceLength: number
      aligned: boolean
      /**
       * The comment this line WAS, for a line the block layer emptied.
       *
       * Kept because §23 removes the line from the RENDER and not from the tree:
       * it stays a `comment` node like any other, so the canonical writer can put
       * the author's line back at the column they wrote it at.
       */
      comment?: Comment
      /** Closed `%%%` pairs before this line's content, at a stanza's start. */
      before?: Comment[]
      /** Closed `%%%` pairs after this line, before the break that ends it. */
      after?: Comment[]
    }
    const stanzas: StanzaLine[][] = []
    let stanza: StanzaLine[] = []
    const body = collectLiteralColonFenceBody(lexer, {
      kind: 'line block',
      lineIndex: openLineIndex,
      fenceWidth: fence,
    })
    // A closed `%%%` pair leaves no verse line, and a blank line in its body
    // splits no stanza (CARVE-P9-047). An opener may be indented up to 3 spaces;
    // the closer may be indented and matches on exact run length.
    const commentRun = (text: string): number | undefined => RE_VERSE_COMMENT_RUN.exec(stripLazyFrame(text))?.[1]!.length
    const lastCloser = new Map<number, number>()
    body.forEach(({ text }, index) => {
      const run = commentRun(text)
      if (run !== undefined) lastCloser.set(run, index)
    })
    let leading: Comment[] = []
    for (let bodyIndex = 0; bodyIndex < body.length; bodyIndex++) {
      const { text, lineIndex } = body[bodyIndex]!
      const line = stripLazyFrame(text)
      const ln = lexer.quoteLazyLines.has(lexer.lineNumber(lineIndex)) ? line.trimStart() : line
      const opener = RE_VERSE_COMMENT_OPEN.exec(ln)
      const run = opener?.[1]!.length
      if (run !== undefined && (lastCloser.get(run) ?? -1) > bodyIndex) {
        let closer = bodyIndex + 1
        while (commentRun(body[closer]!.text) !== run) closer++
        const tail = trimNonNbsp(opener![2]!)
        const content = [...(tail === '' ? [] : [tail]), ...body.slice(bodyIndex + 1, closer).map((line) => stripLazyFrame(line.text))]
        const comment: Comment = { type: 'comment', block: true, content: content.join('\n') }
        if (lexer.hasDocumentOffsets) {
          const end = body[closer]!.lineIndex
          const endLength = lexer.lineAt(end)?.length ?? 0
          // A leaf begins at its markup, not at the indent before `%%%` (carve#1928).
          const markup = lexer.sourceBoundary(lineIndex, (lexer.lineAt(lineIndex) ?? '').search(/[^ \t]|$/))
          comment.pos = {
            startLine: lexer.lineNumber(lineIndex),
            endLine: lexer.lineNumber(end),
            startColumn: markup.column,
            endColumn: lexer.lineStartColumn(end) + endLength,
            startOffset: markup.offset,
            endOffset: lexer.lineOffset(end) + endLength,
          }
        }
        const host = stanza.at(-1)
        if (host) (host.after ??= []).push(comment)
        else leading.push(comment)
        bodyIndex = closer
        continue
      }
      if (isBlankLine(ln)) {
        if (stanza.length) {
          stanzas.push(stanza)
          stanza = []
        }
        continue
      }
      if (ln.startsWith('%%')) {
        const comment: Comment = {
          type: 'comment',
          block: false,
          content: trimEndSpaceTab(ln.slice(2).replace(/^ /, '')),
        }
        if (lexer.hasDocumentOffsets) {
          comment.pos = {
            startLine: lexer.lineNumber(lineIndex),
            endLine: lexer.lineNumber(lineIndex),
            startColumn: lexer.lineStartColumn(lineIndex),
            endColumn: lexer.lineStartColumn(lineIndex) + ln.length,
            startOffset: lexer.lineOffset(lineIndex),
            endOffset: lexer.lineOffset(lineIndex) + ln.length,
          }
        }
        stanza.push({ text: '', lineIndex, sourceOffsets: undefined, sourceLength: 0, aligned: true, comment, ...(leading.length ? { before: leading } : {}) })
        leading = []
        continue
      }
      const sourceOffsets: Array<number | undefined> | undefined = ln.includes('\t') ? [] : undefined
      const expanded = expandLineBlockWhitespace(ln, sourceOffsets)
      stanza.push({
        text: dropTrailingSpaces(expanded),
        lineIndex,
        sourceOffsets,
        sourceLength: ln.length,
        aligned: sourceOffsets === undefined,
        ...(leading.length ? { before: leading } : {}),
      })
      leading = []
    }
    if (stanza.length) stanzas.push(stanza)
    // Pairs after the last verse line stay with it; with no verse line at all
    // they are the block's only children.
    const lastLine = stanzas.at(-1)?.at(-1)
    if (lastLine && leading.length) (lastLine.after ??= []).push(...leading)

    const children = stanzas.map<Paragraph>((lines) => {
      const anchorable = lexer.hasDocumentOffsets
      const unchangedColumns = lines.every((line) => line.aligned)

      const terminalCommentGuard = lines.at(-1)?.comment ? '\uE001' : ''
      const joined = lines.map((line) => line.text).join('\n') + terminalCommentGuard
      const firstLineNumber = lexer.lineNumber(lines[0]!.lineIndex)
      // A `%%%` pair between two lines removes source lines, so a line's index
      // is looked up by its number rather than counted from the first.
      const indexByLine = new Map(lines.map((line, index) => [lexer.lineNumber(line.lineIndex), index]))
      // The break BETWEEN line `index` and the one after it, from line geometry.
      // Unchanged from when each break was built during the per-line walk, down to
      // the clamp: keep the usual start after the parsed text, so a dropped
      // trailing source space remains part of the break span, but do not let an
      // expanded tab put `startOffset` past the following line's offset.
      const breakPos = (index: number): Position | undefined => {
        if (!lexer.hasDocumentOffsets) return undefined
        const line = lines[index]!
        const next = lines[index + 1]
        if (!next) return undefined
        const lineOffset = lexer.lineOffset(line.lineIndex)
        const sourceLineEnd = lineOffset + (lexer.lineAt(line.lineIndex)?.length ?? 0)
        // The break follows the `%%%` pairs this line hosts, so it starts where the last one ends.
        const hosted = line.after?.at(-1)?.pos
        if (hosted?.endColumn !== undefined && hosted.endOffset !== undefined) {
          return {
            startLine: hosted.endLine,
            endLine: lexer.lineNumber(next.lineIndex),
            startColumn: hosted.endColumn,
            endColumn: lexer.lineStartColumn(next.lineIndex),
            startOffset: hosted.endOffset,
            endOffset: lexer.lineOffset(next.lineIndex),
          }
        }
        return {
          startLine: lexer.lineNumber(line.lineIndex),
          endLine: lexer.lineNumber(next.lineIndex),
          startColumn:
            lexer.lineStartColumn(line.lineIndex) + (lexer.lineAt(line.lineIndex)?.length ?? 0),
          endColumn: lexer.lineStartColumn(next.lineIndex),
          // A COMMENT LINE IS MEASURED FROM ITS SOURCE, not from the empty text
          // the block layer left behind. The clamp above reads the parsed text's
          // length, which is zero here, so the break would start at the line's
          // FIRST column while its `startColumn` is derived from the source line
          // and reports the last - one span with two answers, overlapping the
          // `comment` node that occupies those same bytes.
          startOffset: line.comment
            ? sourceLineEnd
            : Math.min(lineOffset + line.text.length, sourceLineEnd),
          endOffset: lexer.lineOffset(next.lineIndex),
        }
      }
      // Parse with expanded columns, then map each surviving span to its source.
      const outerLineBlock = host.inLineBlock
      host.inLineBlock = true
      let parsed: InlineNode[]
      try {
        parsed = host.parseInline(
          joined,
          lexer.abbrDefs,
          lexer.linkDefs,
          lexer.hasDocumentOffsets
            ? inlineSource({
                baseOffset: lexer.lineOffset(lines[0]!.lineIndex),
                startLine: firstLineNumber,
                startColumn: lexer.lineStartColumn(lines[0]!.lineIndex),
                lineAnchors: lines.map((line) => ({
                  offset: lexer.lineOffset(line.lineIndex),
                  column: lexer.lineStartColumn(line.lineIndex),
                  line: lexer.lineNumber(line.lineIndex),
                })),
              })
            : inlineSource({ anchored: false }),
        )
      } finally {
        host.inLineBlock = outerLineBlock
      }
      // Source NULs were replaced before block parsing; these are generated gaps.
      if (joined.includes('\0') || host.activeMatchers.length || host.quoteGlyphHasNul) restoreVerseGaps(parsed)
      if (terminalCommentGuard) {
        const removeGuard = (nodes: InlineNode[]): boolean => {
          for (let index = 0; index < nodes.length; index++) {
            const node = nodes[index]!
            const record = node as unknown as Record<string, unknown>
            for (const key of ['value', 'content'] as const) {
              const value = record[key]
              if (typeof value === 'string' && value.endsWith(terminalCommentGuard)) {
                record[key] = value.slice(0, -terminalCommentGuard.length)
                // The guard may be the entire final text leaf when no verbatim
                // run claims it. Leaving that synthesized empty node behind also
                // leaves its source span over the comment bytes, overlapping the
                // real comment node reinserted below.
                if (node.type === 'text' && record.value === '') nodes.splice(index, 1)
                return true
              }
            }
            let removed = false
            visitInlineChildren(node, (children) => {
              if (!removed) removed = removeGuard(children)
            }, undefined)
            if (removed) return true
          }
          return false
        }
        removeGuard(parsed)
        if (lexer.hasDocumentOffsets) {
          const guardLine = lines[lines.length - 1]!
          const guardOffset = lexer.lineOffset(guardLine.lineIndex)
          const guardColumn = lexer.lineStartColumn(guardLine.lineIndex)
          const guardLineNumber = lexer.lineNumber(guardLine.lineIndex)
          // AT EVERY DEPTH: the run that swallows the boundary may be nested
          // inside emphasis that opened on an earlier body line, and then the
          // container ends there too.
          const clampToGuard = (nodes: InlineNode[]): void => {
            for (const node of nodes) {
              const pos = node.pos
              if (pos && pos.endOffset !== undefined && pos.endOffset > guardOffset) {
                pos.endOffset = guardOffset
                pos.endColumn = guardColumn
                pos.endLine = guardLineNumber
              }
              visitInlineChildren(node, clampToGuard, undefined)
            }
          }
          clampToGuard(parsed)
        }
      }
      // Read the boundary each break belongs to BEFORE any stripping takes the
      // position that says so.
      const breakIndex = new Map<InlineNode, number>()
      // WHICH LINES STILL END AT A BOUNDARY, counting the boundaries the author
      // spelled with a `\` as well as the ones the container hardens. A `\` is
      // not a soft break and never reaches the conversion below, but it is just
      // as much a surviving line end - and the comment reinsertion asks that
      // question, not the conversion's.
      const boundaryLines = new Set<number>()
      // AT EVERY DEPTH. An inline container that opens on one body line and
      // closes on a later one holds the boundaries between them as its OWN
      // children, so a walk over the stanza's top-level nodes never sees them
      // (carve-js#1174).
      const readBoundaries = (nodes: InlineNode[]): void => {
        for (const node of nodes) {
          if (node.type === 'soft_break' || node.type === 'hard_break') {
            const startLine = node.pos?.startLine
            if (startLine === undefined) continue
            const index = indexByLine.get(startLine)
            if (index === undefined) continue
            boundaryLines.add(index)
            if (node.type === 'soft_break') breakIndex.set(node, index)
            continue
          }
          visitInlineChildren(node, readBoundaries, undefined)
        }
      }
      readBoundaries(parsed)
      if (!anchorable) stripPositions(parsed)
      else if (!unchangedColumns || lines.some((line) => lexer.lineStartColumn(line.lineIndex) < 1)) {
        const byLine = new Map(lines.map((line) => [lexer.lineNumber(line.lineIndex), line]))
        const remapPosition = (node: { pos?: Position; type?: string }): void => {
          const pos = node.pos
          if (pos && typeof pos === 'object' && typeof pos.startLine === 'number' && typeof pos.endLine === 'number') {
            const first = byLine.get(pos.startLine)
            const last = byLine.get(pos.endLine)
            const start = first && pos.startColumn !== undefined
              ? pos.startColumn - lexer.lineStartColumn(first.lineIndex) : -1
            const end = last && pos.endColumn !== undefined
              ? pos.endColumn - lexer.lineStartColumn(last.lineIndex) : -1
            const sourceStart = verseSourceOffset(first, start)
            const sourceLast = end === 0 && last
              ? -1 : verseSourceOffset(last, end - 1)
            const contiguousText = !('type' in node) || node.type !== 'text' || (first === last &&
              sourceStart !== undefined && sourceLast !== undefined &&
              sourceLast - sourceStart === end - start - 1 &&
              (first!.sourceOffsets === undefined || first!.sourceOffsets.slice(start, end).every((offset) => offset !== undefined)))
            if (!first || !last || sourceStart === undefined || sourceLast === undefined || !contiguousText ||
              lexer.lineStartColumn(first.lineIndex) + sourceStart < 1) {
              delete node.pos
            } else {
              pos.startColumn = lexer.lineStartColumn(first.lineIndex) + sourceStart
              pos.endColumn = lexer.lineStartColumn(last.lineIndex) + sourceLast + 1
              pos.startOffset = lexer.lineOffset(first.lineIndex) + sourceStart
              pos.endOffset = lexer.lineOffset(last.lineIndex) + sourceLast + 1
            }
          }
        }
        const remap = (nodes: InlineNode[]): void => {
          for (const node of nodes) {
            remapPosition(node)
            visitInlineChildren(node, remap, undefined)
            if (node.type === 'citation_group') {
              for (const item of node.items) remapPosition(item)
            }
          }
        }
        remap(parsed)
      }
      const pendingComments = new Map<number, Comment>()
      lines.forEach((line, index) => {
        if (!line.comment) return
        pendingComments.set(index, line.comment)
      })
      const place = (nodes: InlineNode[]): InlineNode[] => {
        const out: InlineNode[] = []
        for (const node of nodes) {
          if (node.type !== 'soft_break') {
            mapInlineChildren(node, place, undefined)
            out.push(node)
            continue
          }
          const index = breakIndex.get(node)
          // The comment sits BEFORE the break that ends its line: the line is empty
          // now, so there is nothing else on it.
          if (index !== undefined) {
            const comment = pendingComments.get(index)
            if (comment) {
              // A NESTED REINSERTION KEEPS ITS POSITION NOW. It could not before:
              // the nodes it sits among were measured from the JOINED text, which
              // is shorter than the source by exactly the line this comment
              // emptied, so `c` in `*a` / `%% secret` / `c*` reported the offset
              // of `%` and a correct span beside it would have asserted that two
              // nodes hold the same bytes (carve-js#1182). With the anchors
              // carried into the nested scan those siblings are measured from the
              // line they were written on, and the spans nest the way PART 12
              // containment asks.
              out.push(comment)
              pendingComments.delete(index)
            }
          }
          // EVERY SURVIVING BREAK IS HARDENED AND RE-POSED FROM LINE GEOMETRY, at
          // any depth. A nested break left on its scanned span ends where the
          // NEXT line starts, so the one that ends an emptied comment line
          // covered that whole line and overlapped the comment reinserted just
          // above it.
          const hardBreak = { type: 'hard_break' } as InlineNode
          const pos = index === undefined ? undefined : breakPos(index)
          if (pos) hardBreak.pos = pos

          if (index !== undefined) out.push(...lines[index]!.after ?? [])
          out.push(hardBreak)
        }
        return out
      }
      const inline: InlineNode[] = [...lines[0]!.before ?? [], ...place(parsed)]
      // A COMMENT ON THE STANZA'S LAST LINE has no break after it to sit before,
      // so it goes at the end - the boundary that opens its line is still there,
      // which is what says the line is still there.
      //
      // A COMMENT AN OPEN RUN SWALLOWED does not survive, and that is §23's own
      // account of the shape rather than a loss: what the run carries across the
      // emptied line is a NEWLINE, the same thing it carries across every other
      // boundary it swallows. There is no boundary left in the tree to host the
      // node, and appending one anyway put a span BEFORE the run that contains it
      // and after the node that follows it, which PART 12 containment refuses.
      // The writer keeps the LINE - an empty verse line has exactly one spelling
      // inside an open run, and it is a comment line.
      for (const index of [...pendingComments.keys()].sort((a, b) => a - b)) {
        const isLastLine = index === lines.length - 1
        if (isLastLine && (index === 0 || boundaryLines.has(index - 1))) {
          inline.push(pendingComments.get(index)!)
        }
      }
      inline.push(...lines.at(-1)!.after ?? [])

      const paragraph: Paragraph = { type: 'paragraph', children: inline }
      if (lexer.hasDocumentOffsets) {
        const first = lines[0]!
        const last = lines[lines.length - 1]!
        paragraph.pos = {
          startLine: lexer.lineNumber(first.lineIndex),
          endLine: lexer.lineNumber(last.lineIndex),
          startColumn: lexer.lineStartColumn(first.lineIndex),
          endColumn: lexer.lineStartColumn(last.lineIndex) + (lexer.lineAt(last.lineIndex)?.length ?? 0),
          startOffset: lexer.lineOffset(first.lineIndex),
          endOffset: lexer.lineOffset(last.lineIndex) + (lexer.lineAt(last.lineIndex)?.length ?? 0),
        }
        const placed = anchorable && unchangedColumns ? inline.filter((node) => node.pos !== undefined) : []
        const firstIndex = placed.findIndex(
          (node) => node.type !== 'soft_break' && node.type !== 'hard_break',
        )
        // A `%%%` pair after a leading break does not move the stanza's start past that break.
        const firstPos = firstIndex > 0 && placed[firstIndex]!.type === 'comment' ? undefined : placed[firstIndex]?.pos
        const lastPos = placed[placed.length - 1]?.pos
        if (firstPos) {
          paragraph.pos.startLine = firstPos.startLine
          if (firstPos.startColumn !== undefined) paragraph.pos.startColumn = firstPos.startColumn
          if (firstPos.startOffset !== undefined) paragraph.pos.startOffset = firstPos.startOffset
        }
        if (lastPos) {
          paragraph.pos.endLine = lastPos.endLine
          if (lastPos.endColumn !== undefined) paragraph.pos.endColumn = lastPos.endColumn
          if (lastPos.endOffset !== undefined) paragraph.pos.endOffset = lastPos.endOffset
        }
      }
      return paragraph
    })
    // No inline opener attributes (strict djot); a preceding block-attribute
    // line merges onto this node in parseBlocks.
    const node: LineBlock = {
      type: 'line_block',
      children: children.length ? children : leading as BlockNode[],
    }
    return node
  }
}
