/*
 * Lint for silent-failure problems in Carve documents.
 *
 * djotMigrationWarnings (djot-migrate.ts) catches *source-level* delimiter
 * collisions. This module catches markup that parses without error but
 * renders as the wrong thing, so nothing throws:
 *
 *   - references that degrade to literal text at resolve() time: broken
 *     `</#id>` cross-references and duplicate heading ids;
 *   - a trailing `{…}` on a heading, which is literal text under
 *     heading-strict, not an attribute block;
 *   - a ```raw FORMAT fence (the Carve raw block is ```=FORMAT; the wrong
 *     form fails to open and desyncs the rest of the document's fences);
 *   - a line that begins with a block marker (`:::`, `{#`, `{.`) yet parsed
 *     as a paragraph because the block never opened.
 *
 * The id/crossref checks mirror resolveHeadingIds so they agree with what the
 * resolver actually does - they do not re-run resolve (which would discard the
 * very nodes we want to flag by turning a broken crossref or unresolved ref
 * into a Text node). The remaining checks read the source line at each node's
 * position and skip verbatim regions (code/raw blocks) the parser already
 * accounts for.
 */
import { parse } from './parse.js'
import { slugify, inlineText } from './heading-ids.js'
import type { Document, Heading } from './ast.js'

export interface LintWarning {
  /** 1-based line number. */
  line: number
  /** 1-based column number. */
  column: number
  /** Stable rule id, e.g. "broken-crossref". */
  rule: string
  /** Human-readable explanation of the silent degradation. */
  message: string
  /** 0-based start offset in the source, inclusive. */
  start: number
  /** 0-based end offset in the source, exclusive. */
  end: number
}

interface Positioned {
  pos?: {
    startLine: number
    startColumn?: number
    startOffset?: number
    endOffset?: number
  }
}

function locate(node: Positioned): Pick<
  LintWarning,
  'line' | 'column' | 'start' | 'end'
> {
  const p = node.pos
  return {
    line: p?.startLine ?? 1,
    column: p?.startColumn ?? 1,
    start: p?.startOffset ?? 0,
    end: p?.endOffset ?? p?.startOffset ?? 0,
  }
}

/** Every `crossref` node anywhere under `doc.children`, with its raw target. */
function collectCrossrefs(doc: Document): Array<{ target: string; node: Positioned }> {
  const found: Array<{ target: string; node: Positioned }> = []
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }
    if (value && typeof value === 'object') {
      const node = value as Record<string, unknown>
      if (node.type === 'crossref' && typeof node.target === 'string') {
        found.push({ target: node.target, node: node as Positioned })
      }
      // Recurse into child containers; pos/attrs hold no inline nodes.
      for (const key of Object.keys(node)) {
        if (key !== 'pos' && key !== 'attrs') visit(node[key])
      }
    }
  }
  visit(doc.children)
  return found
}

/**
 * Lint a Carve document for silent-failure problems: duplicate heading ids,
 * `</#id>` cross-references with no target, trailing heading attribute blocks,
 * legacy `raw FORMAT` fences, and block markers that leaked as paragraph text.
 *
 * `asciiHeadingIds` must match the value passed to `resolve()`, since it
 * changes how heading slugs (and therefore the valid id set) are computed.
 */
export function lintCarve(
  source: string,
  opts: { asciiHeadingIds?: boolean } = {},
): LintWarning[] {
  const doc = parse(source, { positions: true })
  const asciiFold = opts.asciiHeadingIds ?? false
  const out: LintWarning[] = []

  // Build the final heading-id set exactly as resolveHeadingIds does
  // (explicit ids win; colliding slugs get a `-2`, `-3`, … suffix), and warn
  // on every collision along the way.
  const used = new Set<string>()
  for (const block of doc.children) {
    if (block.type !== 'heading') continue
    const heading = block as Heading
    const explicit = heading.attrs?.id

    if (explicit) {
      if (used.has(explicit)) {
        out.push({
          ...locate(heading),
          rule: 'duplicate-heading-id',
          message: `Duplicate heading id "${explicit}": the repeated HTML id is invalid, and cross-references to it resolve to the first occurrence.`,
        })
      }
      used.add(explicit)
      continue
    }

    const base = slugify(inlineText(heading.children), asciiFold)
    if (!base) continue
    if (used.has(base)) {
      let n = 2
      while (used.has(`${base}-${n}`)) n++
      const id = `${base}-${n}`
      out.push({
        ...locate(heading),
        rule: 'duplicate-heading-id',
        message: `Heading slug "${base}" collides with an earlier heading; its auto id becomes "${id}", and ambiguous references to "${base}" resolve to the first occurrence.`,
      })
      used.add(id)
    } else {
      used.add(base)
    }
  }

  // `used` now holds every valid id. A crossref to anything else degrades to
  // literal text in resolveHeadingIds.
  for (const { target, node } of collectCrossrefs(doc)) {
    if (used.has(target)) continue
    out.push({
      ...locate(node),
      rule: 'broken-crossref',
      message: `Cross-reference </#${target}> has no matching heading id; it renders as the literal text "</#${target}>".`,
    })
  }

  collectSilentFailures(source, doc, out)

  out.sort((a, b) => a.start - b.start || a.line - b.line || a.column - b.column)
  return out
}

/** A trailing `{.class}` / `{#id}` attribute block at the end of a line. The
 *  leading `(^|\s)` keeps a valid inline span like `[t]{.c}` (brace abuts `]`,
 *  no space) from matching. */
const TRAILING_HEADING_ATTR = /(^|\s)(\{\s*[.#][^{}]*\})\s*$/
/** A fenced block whose info string is the legacy `raw FORMAT` form. */
const LEGACY_RAW_FENCE = /^(\s*)(`{3,}|~{3,})\s*raw\s+(\S+)/
/** A line that opens like a block construct (`:::`, `{#`, `{.`). */
const LEAKED_BLOCK_MARKER = /^(\s*)(:{3,}|\{[.#])/

/**
 * Source-line checks for constructs that parsed into the wrong node. Each is
 * anchored to a parsed node so verbatim regions (code/raw blocks) are skipped
 * automatically: only real headings/paragraphs are inspected, and the
 * raw-fence scan ignores lines inside a code/raw block.
 */
function collectSilentFailures(source: string, doc: Document, out: LintWarning[]): void {
  const lines = source.split('\n')
  const lineStart: number[] = []
  for (let off = 0, i = 0; i < lines.length; i++) {
    lineStart[i] = off
    off += lines[i]!.length + 1
  }
  const push = (lineNo: number, col: number, len: number, rule: string, message: string): void => {
    const start = (lineStart[lineNo - 1] ?? 0) + (col - 1)
    out.push({ line: lineNo, column: col, rule, message, start, end: start + len })
  }

  const verbatim: Array<[number, number]> = []
  const headings: Positioned[] = []
  const paragraphs: Positioned[] = []
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item)
      return
    }
    if (!value || typeof value !== 'object') return
    const node = value as Record<string, unknown>
    const pos = (node as Positioned).pos
    const endLine = (pos as { endLine?: number } | undefined)?.endLine
    if (node.type === 'heading') headings.push(node as Positioned)
    else if (node.type === 'paragraph') paragraphs.push(node as Positioned)
    else if ((node.type === 'code-block' || node.type === 'raw-block') && pos) {
      verbatim.push([pos.startLine, endLine ?? pos.startLine])
    } else if (node.type === 'figure' && pos) {
      // A captioned code/raw block is a figure wrapping a *position-less*
      // code-block target, so the block itself never reaches the branch above.
      // Use the figure's range so the fence scan still skips its verbatim body.
      const target = (node.target as { type?: string } | undefined)?.type
      if (target === 'code-block' || target === 'raw-block') {
        verbatim.push([pos.startLine, endLine ?? pos.startLine])
      }
    }
    for (const key of Object.keys(node)) {
      if (key !== 'pos' && key !== 'attrs') walk(node[key])
    }
  }
  walk(doc.children)

  // 1. Trailing attribute block on a heading: literal text, not attributes.
  for (const h of headings) {
    const ln = (h.pos as { endLine?: number } | undefined)?.endLine ?? h.pos?.startLine
    if (!ln) continue
    const line = lines[ln - 1] ?? ''
    // Guard against position drift: only flag if this really is a heading line.
    if (!/^\s*#{1,6}\s/.test(line)) continue
    const m = TRAILING_HEADING_ATTR.exec(line)
    if (!m) continue
    const col = m.index + m[1]!.length + 1
    push(
      ln,
      col,
      m[2]!.length,
      'heading-trailing-attribute',
      `Trailing "${m[2]}" on a heading is literal text in Carve, not an attribute block. ` +
        `Move it to a "${m[2]}" line directly above the heading.`,
    )
  }

  // 2. Legacy `raw FORMAT` fence: never opens, and desyncs later fences.
  const inVerbatim = (ln: number): boolean => verbatim.some(([s, e]) => ln >= s && ln <= e)
  for (let i = 0; i < lines.length; i++) {
    if (inVerbatim(i + 1)) continue
    const m = LEGACY_RAW_FENCE.exec(lines[i]!)
    if (!m) continue
    push(
      i + 1,
      m[1]!.length + 1,
      lines[i]!.length - m[1]!.length,
      'raw-block-syntax',
      `"${m[2]}raw ${m[3]}" is not a Carve raw block; it fails to open and desyncs the ` +
        `document's fences. Use "${m[2]}=${m[3]}" to pass content through to ${m[3]}.`,
    )
  }

  // 3. A paragraph whose first inline text opens like a block construct: the
  //    block never opened, so the marker leaked as plain text. Gating on the
  //    text content (not the source line) avoids a false positive when a valid
  //    container's child paragraph reports its parent's start line.
  for (const p of paragraphs) {
    const first = (p as { children?: unknown[] }).children?.[0] as
      | { type?: string; value?: string }
      | undefined
    if (first?.type !== 'text' || typeof first.value !== 'string') continue
    const m = LEAKED_BLOCK_MARKER.exec(first.value)
    if (!m) continue
    const loc = locate(first as Positioned)
    const what = m[2]!.startsWith(':')
      ? `an admonition/div fence ("${m[2]}")`
      : `a block-attribute line ("${m[2]}…")`
    out.push({
      line: loc.line,
      column: loc.column,
      rule: 'block-marker-as-text',
      message:
        `This line begins like ${what} but parsed as plain text - the block did not open. ` +
        `Check this line's syntax and any unterminated fence above it.`,
      start: loc.start,
      end: loc.start + m[2]!.length,
    })
  }
}

/** Format lint warnings as `file:line:col rule — message`. */
export function formatLintWarnings(
  warnings: LintWarning[],
  file = '<stdin>',
): string {
  return warnings
    .map((w) => `${file}:${w.line}:${w.column} ${w.rule} — ${w.message}`)
    .join('\n')
}
