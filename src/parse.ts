/*
 * Carve parser — implemented incrementally, construct by construct.
 *
 * Current scope: headings only (M1, step 1). Any other line is silently
 * ignored for now; subsequent steps will add paragraphs, lists, fences,
 * tables, inline parsing, etc.
 */

import type { BlockNode, Document, Heading, HeadingLevel, Text } from './ast.js'

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/

export interface ParseOptions {
  /** Track 1-based source line positions on every node. Off by default. */
  positions?: boolean
}

export function parse(source: string, opts: ParseOptions = {}): Document {
  const children: BlockNode[] = []
  const lines = source.replace(/\r\n?/g, '\n').split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (line.trim() === '') continue

    const h = HEADING_RE.exec(line)
    if (h) {
      const level = h[1]!.length as HeadingLevel
      const text: Text = { type: 'text', value: h[2]! }
      const heading: Heading = { type: 'heading', level, children: [text] }
      if (opts.positions) heading.pos = { startLine: i + 1, endLine: i + 1 }
      children.push(heading)
      continue
    }

    // Other constructs unimplemented at this step — fall through, ignore.
  }

  return { type: 'document', children }
}
