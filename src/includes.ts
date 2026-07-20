import type {
  BlockNode,
  Document,
  Heading,
  HeadingLevel,
  InlineNode,
  Mention,
  Paragraph,
  Tag,
  Text,
} from './ast.js'
import { utf8ByteLength } from './abbr-budget.js'
import { inlineText, slugify } from './heading-ids.js'
import { parse, normalizeRefLabel } from './parse.js'
import { readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'

/** Warning emitted by {@link expandIncludes}. */
export interface IncludeWarning {
  /** 1-based line number when source positions are available. */
  line: number
  /** 1-based column number when source positions are available. */
  column: number
  /** Stable rule id, e.g. "include-cycle". */
  rule: string
  /** Human-readable explanation of the include degradation or rename. */
  message: string
  /** 0-based start offset in the parent source, inclusive. */
  start: number
  /** 0-based end offset in the parent source, exclusive. */
  end: number
}

export interface IncludeContext {
  /** Identity of the including document, supplied by the host when known. */
  sourcePath?: string
  /**
   * Include chain, root first: each entry is the canonical id a resolver
   * returned for that file ({@link IncludeResolved}), or the raw directive
   * path when the resolver returned plain source. Used for relative
   * resolution and cycle guards.
   */
  stack: string[]
  /** Zero-based include depth of the directive being resolved. */
  depth: number
}

/**
 * Resolver result: plain source text, or source plus a canonical id for the
 * resolved file. The id feeds cycle detection and becomes the parent entry in
 * {@link IncludeContext.stack} for nested resolves, so resolvers that map
 * paths to files (filesystem, VFS) should return one; without it two
 * spellings of the same file ("b.crv" vs "./b.crv") defeat the cycle guard
 * and only the depth limit stops the recursion.
 */
export type IncludeResolved = string | { source: string; id?: string }

export interface IncludeOptions {
  /** Resolve an include path to source text. Return null for an unresolvable path. */
  resolve?: (path: string, ctx: IncludeContext) => IncludeResolved | null
  /** Identity of the root document, passed to the first resolver call as context. */
  sourcePath?: string
  /** Maximum transitive include depth. Default 16. */
  maxDepth?: number
  /** Expanded child source byte budget. Default max(1 MB, 8 x root source bytes). */
  maxBytes?: number
}

/**
 * One include target touched during expansion. Hosts key file watchers off
 * `id`, so unresolved targets are reported too: a preview that watched only
 * successful reads would never notice a missing `{{ chapter-3.crv }}` being
 * created and would stay stale.
 */
export interface IncludeDependency {
  /**
   * The resolver's canonical id when it supplied one (the identity the cycle
   * guard uses), otherwise the directive path as written.
   */
  id: string
  /** True when the resolver produced source text for this target. */
  resolved: boolean
}

export interface IncludeResult {
  doc: Document
  warnings: IncludeWarning[]
  /**
   * Every include target touched during the whole recursive expansion,
   * nested children included, de-duplicated and in first-encounter order.
   * Intended for preview invalidation: re-run the expansion when any of
   * these paths changes. Empty when no resolver was supplied.
   */
  dependencies: IncludeDependency[]
}

export interface FileSystemResolverOptions {
  /** Allow absolute include paths after root containment checks. Default false. */
  allowAbsolute?: boolean
}

export type IncludeResolver = (path: string, ctx: IncludeContext) => IncludeResolved | null

interface Directive {
  raw: string
  path: string
  section?: string
  lines?: { start: number; end: number }
  /** Literal signed offset, or "auto" to derive it from the include site. */
  shift: number | 'auto'
}

interface State {
  opts: IncludeOptions
  warnings: IncludeWarning[]
  maxDepth: number
  maxBytes: number
  usedBytes: number
  stack: string[]
  /** Directive nesting depth; separate from stack, which may hold the root id. */
  depth: number
  docs: Document[]
  usedHeadingIds: Set<string>
  /** Include targets in first-encounter order; value is the resolved flag. */
  dependencies: Map<string, boolean>
  /**
   * Spec I8 context level C for `@shift:auto`: the level of the nearest
   * preceding heading in the directive's own block container or an enclosing
   * one, 0 when there is none. Containers save and restore it on entry/exit,
   * so a sibling container that has already closed does not set context.
   *
   * Held in the coordinate system of the content currently being expanded: a
   * child that will later be shifted by N sees C - N here, so that once the
   * shift lands the effective context is the parent's actual level again.
   */
  contextLevel: number
}

const DIRECTIVE_SCAN_RE = /\{\{\s+(?:"((?:\\.|[^"\\])*)"|\u201c([^\u201d]*)\u201d|([^#@}\s"\u201c]+))((?:\s+#[A-Za-z_][\w-]*)?)(.*?)\s+\}\}/g
const DIRECTIVE_FULL_RE = /^\{\{\s+(?:"((?:\\.|[^"\\])*)"|\u201c([^\u201d]*)\u201d|([^#@}\s"\u201c]+))((?:\s+#[A-Za-z_][\w-]*)?)(.*?)\s+\}\}$/
const OPTION_RE = /^@([A-Za-z_][\w-]*):([^#@}\s]+)$/
/** Loose directive shape: one whole-paragraph token, valid options or not. */
const DIRECTIVE_SHAPE_RE = /^\{\{[^{}]*\}\}$/
const MIN_BUDGET = 1024 * 1024

function locate(node: { pos?: { startLine: number; startColumn?: number; startOffset?: number; endOffset?: number } }): Pick<
  IncludeWarning,
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

function warn(
  state: State,
  rule: string,
  message: string,
  node?: { pos?: { startLine: number; startColumn?: number; startOffset?: number; endOffset?: number } },
): void {
  state.warnings.push({ ...locate(node ?? {}), rule, message })
}

function unescapeQuotedPath(path: string): string {
  return path.replace(/\\(["\\])/g, '$1')
}

function parseDirective(raw: string, onInvalidOption?: (part: string) => void): Directive | null {
  const m = DIRECTIVE_FULL_RE.exec(raw)
  if (!m) return null
  const path = m[1] !== undefined ? unescapeQuotedPath(m[1]) : m[2] ?? m[3]!
  const sectionPart = m[4]?.trim()
  const section = sectionPart ? sectionPart.slice(1) : undefined
  let lines: Directive['lines']
  let shift: number | 'auto' = 0
  const rest = m[5]?.trim()
  if (rest) {
    for (const part of rest.split(/\s+/)) {
      const opt = OPTION_RE.exec(part)
      const invalid = (): null => {
        // Spec I1: an unrecognized (or malformed) option makes the directive
        // unresolvable - Warning + literal, never silent.
        if (part.startsWith('@')) onInvalidOption?.(part)
        return null
      }
      if (!opt) return invalid()
      const [, key, value] = opt
      if (key === 'lines') {
        const lm = /^([1-9]\d*)-([1-9]\d*)$/.exec(value!)
        if (!lm) return invalid()
        lines = { start: Number(lm[1]), end: Number(lm[2]) }
        if (lines.end < lines.start) return invalid()
      } else if (key === 'shift') {
        // Spec I8: a signed integer or the literal "auto", never both forms.
        if (value === 'auto') shift = 'auto'
        else if (!/^[+-]?\d+$/.test(value!)) return invalid()
        else shift = Number(value)
      } else {
        return invalid()
      }
    }
  }
  const directive: Directive = { raw, path, shift }
  if (section !== undefined) directive.section = section
  if (lines !== undefined) directive.lines = lines
  return directive
}

function sourceLines(source: string): string[] {
  const lines = source.split(/\n/)
  if (lines.length && lines[lines.length - 1] === '') lines.pop()
  return lines
}

function sliceLines(source: string, range: { start: number; end: number }): string {
  return sourceLines(source).slice(range.start - 1, range.end).join('\n')
}

function childContext(state: State): IncludeContext {
  const ctx: IncludeContext = {
    stack: [...state.stack],
    depth: state.depth,
  }
  if (state.opts.sourcePath !== undefined) ctx.sourcePath = state.opts.sourcePath
  return ctx
}

/**
 * Record an include target for host file watching. Deduplicated by id, first
 * encounter fixes the order, and a later successful read upgrades an entry
 * that was first seen unresolved.
 */
function note(state: State, id: string, resolved: boolean): void {
  if (resolved || !state.dependencies.has(id)) state.dependencies.set(id, resolved)
}

function resolveChild(d: Directive, state: State, node: Text): { source: string; id: string } | null {
  if (!state.opts.resolve) return null
  if (d.section && d.lines) {
    warn(state, 'include-selection-conflict', `Include "${d.path}" cannot use both #section and @lines.`, node)
    return null
  }
  if (state.depth >= state.maxDepth) {
    // Never handed to the resolver, but still a target the host may want to
    // watch, so it is reported as unresolved rather than dropped.
    note(state, d.path, false)
    warn(state, 'include-depth', `Include depth limit of ${state.maxDepth} exceeded for "${d.path}".`, node)
    return null
  }

  let resolved: unknown
  try {
    resolved = state.opts.resolve(d.path, childContext(state))
  } catch (e) {
    note(state, d.path, false)
    warn(state, 'include-unresolved', `Include "${d.path}" could not be resolved: ${(e as Error).message}`, node)
    return null
  }
  if (resolved === null || resolved === undefined) {
    // Covers missing files and containment denials alike: the resolver reports
    // both as null, and a host wants to re-check either if the tree changes.
    note(state, d.path, false)
    warn(state, 'include-unresolved', `Include "${d.path}" could not be resolved.`, node)
    return null
  }
  const source = typeof resolved === 'string' ? resolved : (resolved as { source?: unknown }).source
  const id =
    typeof resolved === 'string' ? d.path : ((resolved as { id?: unknown }).id as string | undefined) ?? d.path
  if (typeof source !== 'string' || source.includes('\0')) {
    note(state, id, false)
    warn(state, 'include-non-text', `Include "${d.path}" did not resolve to text.`, node)
    return null
  }
  note(state, id, true)
  // The cycle guard compares canonical ids after resolution, so a resolver
  // that supplies ids catches "b.crv" vs "./b.crv" spellings of one file.
  if (state.stack.includes(id)) {
    warn(state, 'include-cycle', `Include cycle detected for "${d.path}".`, node)
    return null
  }

  const bytes = utf8ByteLength(source)
  if (state.usedBytes + bytes > state.maxBytes) {
    warn(state, 'include-budget', `Include byte budget exceeded by "${d.path}".`, node)
    return null
  }
  state.usedBytes += bytes
  return { source: d.lines ? sliceLines(source, d.lines) : source, id }
}

function headingId(h: Heading): string {
  return h.attrs?.id ?? slugify(inlineText(h.children))
}

function selectSection(doc: Document, section: string): BlockNode[] | null {
  const start = doc.children.findIndex((b) => b.type === 'heading' && headingId(b) === section)
  if (start < 0) return null
  const level = (doc.children[start] as Heading).level
  let end = start + 1
  while (end < doc.children.length) {
    const b = doc.children[end]!
    if (b.type === 'heading' && b.level <= level) break
    end++
  }
  return doc.children.slice(start, end)
}

function shiftBlocks(blocks: BlockNode[], shift: number, state: State): void {
  if (shift === 0) return
  const visit = (node: BlockNode): void => {
    switch (node.type) {
      case 'heading': {
        const shifted = node.level + shift
        const clamped = Math.min(6, Math.max(1, shifted)) as HeadingLevel
        if (clamped !== shifted) {
          warn(state, 'include-heading-clamp', `Included heading level ${shifted} was clamped to ${clamped}.`, node)
        }
        node.level = clamped
        break
      }
      case 'blockquote':
      case 'div':
      case 'admonition':
        node.children.forEach(visit)
        break
      case 'list':
        for (const item of node.items) item.children.forEach(visit)
        break
      case 'definition-list':
        for (const item of node.items) for (const def of item.definitions) def.forEach(visit)
        break
      case 'figure':
        if (node.target.type === 'blockquote') visit(node.target)
        break
    }
  }
  blocks.forEach(visit)
}

function expandChild(d: Directive, state: State, node: Text): Document | null {
  const resolved = resolveChild(d, state, node)
  if (resolved === null) return null
  const child = parse(resolved.source, { positions: true })
  // Select before expanding: nested includes outside the wanted section must
  // not be resolved (no budget charge) and must not move section boundaries.
  if (d.section) {
    const selected = selectSection(child, d.section)
    if (!selected) {
      // Same attempt, not a second one: the file was read but the include did
      // not expand, so the entry is forced back to unresolved rather than
      // going through note()'s upgrade rule. A host must still watch the
      // target and must not treat the include as having succeeded.
      state.dependencies.set(resolved.id, false)
      warn(state, 'include-section', `Include "${d.path}" has no section "#${d.section}".`, node)
      return null
    }
    child.children = selected
  }
  renameChildHeadingIds(child, state)
  const auto = d.shift === 'auto'
  const stated = auto ? 0 : (d.shift as number)
  state.stack.push(resolved.id)
  state.depth++
  state.docs.push(child)
  // The child is shifted only after its own includes are expanded, so inside
  // it the inherited context is expressed in pre-shift coordinates: a stated
  // shift is known now and translated out, and once it lands a nested "auto"
  // sits where the assembled document says it should.
  //
  // "auto" is not translated because its offset is not known yet - it is
  // measured over the assembled content below, which is exactly what makes it
  // self-consistent: whatever level the nested content settles at is the level
  // the measurement then reads.
  const outerContext = state.contextLevel
  state.contextLevel = outerContext - stated
  expandBlocks(child.children, state)
  if (child.footnoteDefs) {
    // A footnote body is its own container: no heading precedes it.
    for (const body of Object.values(child.footnoteDefs)) {
      state.contextLevel = 0
      expandBlocks(body, state)
    }
  }
  state.contextLevel = outerContext
  state.docs.pop()
  state.depth--
  state.stack.pop()
  // Measured after expansion so a child that only passes through to nested
  // includes is levelled by the headings those actually contributed.
  shiftBlocks(child.children, auto ? autoShift(child, state) : stated, state)
  return child
}

/**
 * Spec I8 `@shift:auto`: N = (C + 1) - T, where C is the context level at the
 * include site and T the minimum heading level in the resolved content.
 *
 * The minimum rather than the first heading's level, so the child's internal
 * relative structure survives: a child whose h1 is followed by an h2 keeps
 * that one-level gap wherever it lands. Content with no headings is a no-op
 * (N = 0) and warns about nothing, which also covers inline includes, whose
 * content cannot contain a heading.
 *
 * Called after the child's own includes are expanded, so headings a child
 * contributes only by including another file still count.
 */
function autoShift(child: Document, state: State): number {
  let top: number | null = null
  walkBlocks(child.children, (block) => {
    if (block.type === 'heading' && (top === null || block.level < top)) top = block.level
  })
  if (top === null) return 0
  return state.contextLevel + 1 - top
}

/**
 * Merge-time collision pass for explicit heading ids (spec I5): parent ids and
 * earlier includes win, a later duplicate gets the least free "-N" suffix, and
 * the child's own crossrefs follow the rename so they keep resolving within
 * the child's scope. Runs depth-first at merge time because after splicing,
 * file provenance (which crossref belongs to which file) is gone.
 */
function renameChildHeadingIds(child: Document, state: State): void {
  const rename = new Map<string, string>()
  walkBlocks(child.children, (block) => {
    if (block.type !== 'heading' || block.attrs?.id === undefined) return
    const id = block.attrs.id
    if (!state.usedHeadingIds.has(id)) {
      state.usedHeadingIds.add(id)
      return
    }
    const renamed = nextFree(id, state.usedHeadingIds)
    block.attrs.id = renamed
    state.usedHeadingIds.add(renamed)
    rename.set(id, renamed)
    warn(state, 'include-heading-id-rename', `Heading id "${id}" was renamed to "${renamed}".`, block)
  })
  if (rename.size) {
    renameInBlocks(child.children, new Map(), rename)
    if (child.footnoteDefs) {
      for (const body of Object.values(child.footnoteDefs)) renameInBlocks(body, new Map(), rename)
    }
  }
}

function textFrom(value: string, like: Text): Text {
  return { ...like, value }
}

type RunNode = Text | Mention | Tag

function isRunNode(node: InlineNode): node is RunNode {
  return node.type === 'text' || node.type === 'mention' || node.type === 'tag'
}

function runNodeText(node: RunNode): string {
  if (node.type === 'text') return node.value
  return node.type === 'mention' ? `@${node.user}` : `#${node.name}`
}

/**
 * Return the run nodes covering [from, to) of the run's reassembled text.
 * Directive matches start with "{{" and end with "}}", which the core always
 * parses as text, so a boundary can only fall inside a text node; mention and
 * tag nodes are either fully kept or fully consumed by a directive span.
 */
function sliceRun(run: RunNode[], from: number, to: number): InlineNode[] {
  const out: InlineNode[] = []
  let offset = 0
  for (const node of run) {
    const text = runNodeText(node)
    const start = offset
    const end = offset + text.length
    offset = end
    if (end <= from || start >= to) continue
    if (node.type !== 'text') {
      out.push(node)
      continue
    }
    const value = text.slice(Math.max(from, start) - start, Math.min(to, end) - start)
    if (value === text) out.push(node)
    else if (value !== '') out.push(textFrom(value, node))
  }
  return out
}

/**
 * Scan a contiguous run of text-like inline nodes (text, mention, tag) for
 * directives. The core splits "{{ x #s @shift:1 }}" into text plus tag and
 * mention nodes, so recognition reassembles the run before matching. Failed
 * directives keep their original nodes, rendering exactly as the core does
 * with no resolver.
 */
function expandRun(run: RunNode[], state: State): InlineNode[] {
  const full = run.map(runNodeText).join('')
  const anchor = run.find((n): n is Text => n.type === 'text') ?? ({ type: 'text', value: full } as Text)
  const re = new RegExp(DIRECTIVE_SCAN_RE.source, 'g')
  const spans: { start: number; end: number; replacement: InlineNode[] }[] = []
  for (let m = re.exec(full); m; m = re.exec(full)) {
    const raw = m[0]
    const d = parseDirective(raw, (part) =>
      warn(state, 'include-unknown-option', `Unknown include option "${part}".`, anchor),
    )
    if (!d) continue
    const child = expandChild(d, state, anchor)
    if (!child) continue
    if (child.children.length === 0 || (child.children.length === 1 && child.children[0]!.type === 'paragraph')) {
      const replacement = child.children.length === 1 ? (child.children[0] as Paragraph).children : []
      mergeFootnotes(state.docs[state.docs.length - 1]!, child, state)
      spans.push({ start: m.index, end: m.index + raw.length, replacement })
    } else {
      warn(state, 'include-block-in-inline', `Inline include "${d.path}" resolved to block content.`, anchor)
    }
  }
  if (spans.length === 0) return run
  const out: InlineNode[] = []
  let cursor = 0
  for (const span of spans) {
    out.push(...sliceRun(run, cursor, span.start))
    out.push(...span.replacement)
    cursor = span.end
  }
  out.push(...sliceRun(run, cursor, full.length))
  return out
}

function expandInlines(nodes: InlineNode[], state: State): InlineNode[] {
  const out: InlineNode[] = []
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!
    if (isRunNode(node)) {
      // A directive split across other inline structures (emphasis, links)
      // stays literal by design (corpus pin: "bare-path directive with no
      // active inline markers"); only text/mention/tag runs reassemble.
      let j = i
      while (j < nodes.length && isRunNode(nodes[j]!)) j++
      out.push(...expandRun(nodes.slice(i, j) as RunNode[], state))
      i = j - 1
    } else {
      switch (node.type) {
        case 'italic':
        case 'strong':
        case 'underline':
        case 'strike':
        case 'super':
        case 'sub':
        case 'highlight':
        case 'bold-italic':
        case 'link':
        case 'span':
        case 'critic-insert':
        case 'critic-delete':
          node.children = expandInlines(node.children, state)
          break
        case 'extension':
          node.content = expandInlines(node.content, state)
          break
        case 'footnote':
          if (node.inline) node.inline = expandInlines(node.inline, state)
          break
        case 'citation-group':
          for (const item of node.items) {
            if (item.prefix) item.prefix = expandInlines(item.prefix, state)
            if (item.locator) item.locator = expandInlines(item.locator, state)
            if (item.suffix) item.suffix = expandInlines(item.suffix, state)
          }
          break
      }
      out.push(node)
    }
  }
  return out
}

function directiveSource(nodes: InlineNode[]): string | null {
  let out = ''
  for (const node of nodes) {
    switch (node.type) {
      case 'text':
        out += node.value
        break
      case 'mention':
        out += `@${node.user}`
        break
      case 'tag':
        out += `#${node.name}`
        break
      default:
        return null
    }
  }
  return out
}

function renameInlines(nodes: InlineNode[], footnotes: Map<string, string>, headings: Map<string, string>): void {
  for (const node of nodes) {
    if (node.type === 'footnote' && node.id !== undefined) node.id = footnotes.get(node.id) ?? node.id
    if (node.type === 'crossref') node.target = headings.get(node.target) ?? node.target
    if ('children' in node && Array.isArray(node.children)) renameInlines(node.children, footnotes, headings)
    if (node.type === 'extension') renameInlines(node.content, footnotes, headings)
    if (node.type === 'footnote' && node.inline) renameInlines(node.inline, footnotes, headings)
    if (node.type === 'citation-group') {
      for (const item of node.items) {
        if (item.prefix) renameInlines(item.prefix, footnotes, headings)
        if (item.locator) renameInlines(item.locator, footnotes, headings)
        if (item.suffix) renameInlines(item.suffix, footnotes, headings)
      }
    }
  }
}

function renameInBlocks(blocks: BlockNode[], footnotes: Map<string, string>, headings: Map<string, string>): void {
  walkBlocks(blocks, (block) => {
    switch (block.type) {
      case 'heading':
      case 'paragraph':
        renameInlines(block.children, footnotes, headings)
        break
      case 'table':
        if (block.caption) renameInlines(block.caption, footnotes, headings)
        for (const row of block.rows) for (const cell of row.cells) renameInlines(cell.children, footnotes, headings)
        break
      case 'figure':
        renameInlines(block.caption, footnotes, headings)
        if (block.target.type === 'paragraph') renameInlines(block.target.children, footnotes, headings)
        if (block.target.type === 'table' && block.target.caption) renameInlines(block.target.caption, footnotes, headings)
        break
    }
  })
}

function mergeFootnotes(target: Document, child: Document, state: State): void {
  if (!child.footnoteDefs) return
  target.footnoteDefs = target.footnoteDefs ?? {}
  const rename = new Map<string, string>()
  for (const label of Object.keys(child.footnoteDefs)) {
    const taken = Object.keys(target.footnoteDefs).some(
      (existing) => normalizeRefLabel(existing) === normalizeRefLabel(label),
    )
    const finalLabel = taken ? nextFree(label, new Set(Object.keys(target.footnoteDefs))) : label
    if (finalLabel !== label) {
      rename.set(label, finalLabel)
      warn(state, 'include-footnote-rename', `Footnote label "${label}" was renamed to "${finalLabel}".`)
    }
    target.footnoteDefs[finalLabel] = child.footnoteDefs[label]!
  }
  if (rename.size) renameInBlocks(child.children, rename, new Map())
}

function expandParagraph(block: Paragraph, state: State): BlockNode[] {
  const source = directiveSource(block.children)
  if (source !== null) {
    const text = block.children.find((node): node is Text => node.type === 'text') ?? ({ type: 'text', value: source } as Text)
    const d = parseDirective(source, (part) =>
      warn(state, 'include-unknown-option', `Unknown include option "${part}".`, text),
    )
    if (d) {
      const child = expandChild(d, state, text)
      if (!child) {
        // Degrade to literal: the original inline nodes render exactly as the
        // core does with no resolver (spec I7).
        return [block]
      }
      mergeFootnotes(state.docs[state.docs.length - 1]!, child, state)
      return child.children
    }
    // A whole-paragraph directive that failed to parse was already reported
    // here; skip the inline scan so it is not warned about twice.
    if (DIRECTIVE_SHAPE_RE.test(source.trim())) return [block]
  }
  block.children = expandInlines(block.children, state)
  return [block]
}

function expandBlocks(blocks: BlockNode[], state: State): void {
  // Spec I8: this block list is one container. Headings in it set the context
  // for later blocks and for containers nested inside it, but the entry value
  // is restored on exit so a closed sibling container never sets context.
  const entryContext = state.contextLevel
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!
    let replacement: BlockNode[] | null = null
    switch (block.type) {
      case 'paragraph':
        replacement = expandParagraph(block, state)
        break
      case 'blockquote':
      case 'div':
      case 'admonition':
        expandBlocks(block.children, state)
        break
      case 'list':
        for (const item of block.items) expandBlocks(item.children, state)
        break
      case 'definition-list':
        for (const item of block.items) for (const def of item.definitions) expandBlocks(def, state)
        break
      case 'figure':
        if (block.target.type === 'blockquote') expandBlocks(block.target.children, state)
        else if (block.target.type === 'paragraph') block.target.children = expandInlines(block.target.children, state)
        if (block.caption) block.caption = expandInlines(block.caption, state)
        break
      case 'heading':
        block.children = expandInlines(block.children, state)
        state.contextLevel = block.level
        break
      case 'table':
        if (block.caption) block.caption = expandInlines(block.caption, state)
        for (const row of block.rows) for (const cell of row.cells) cell.children = expandInlines(cell.children, state)
        break
    }
    if (replacement) {
      blocks.splice(i, 1, ...replacement)
      i += replacement.length - 1
      // The merged blocks are now part of this container, so a heading they
      // contribute at this level sets the context for what follows - "the
      // document as assembled" (spec I8).
      for (const merged of replacement) {
        if (merged.type === 'heading') state.contextLevel = merged.level
      }
    }
  }
  state.contextLevel = entryContext
}

function walkBlocks(blocks: BlockNode[], fn: (block: BlockNode) => void): void {
  for (const block of blocks) {
    fn(block)
    switch (block.type) {
      case 'blockquote':
      case 'div':
      case 'admonition':
        walkBlocks(block.children, fn)
        break
      case 'list':
        for (const item of block.items) walkBlocks(item.children, fn)
        break
      case 'definition-list':
        for (const item of block.items) for (const def of item.definitions) walkBlocks(def, fn)
        break
      case 'figure':
        if (block.target.type === 'blockquote') walkBlocks(block.target.children, fn)
        break
    }
  }
}

function nextFree(base: string, used: Set<string>): string {
  let n = 2
  while (used.has(`${base}-${n}`)) n++
  return `${base}-${n}`
}

/**
 * Expand processor-level `{{ ... }}` include directives in an already-parsed AST.
 *
 * With no resolver, directives remain ordinary text and no warnings are emitted.
 */
export function expandIncludes(doc: Document, source: string, options: IncludeOptions = {}): IncludeResult {
  const state: State = {
    opts: options,
    warnings: [],
    maxDepth: options.maxDepth ?? 16,
    maxBytes: options.maxBytes ?? Math.max(MIN_BUDGET, 8 * utf8ByteLength(source)),
    usedBytes: 0,
    stack: options.sourcePath ? [options.sourcePath] : [],
    depth: 0,
    docs: [doc],
    usedHeadingIds: new Set(),
    dependencies: new Map(),
    contextLevel: 0,
  }
  // Recognition needs a parse, but a document whose source contains no "{{"
  // at all cannot contain a directive in any position, so the AST walk is
  // skipped outright. This keeps directive-free documents at parse cost.
  if (options.resolve && source.includes('{{')) {
    // Parent explicit ids are claimed first (spec I5: parent before child), so
    // an included duplicate is the one renamed - even against a parent heading
    // after the include site.
    walkBlocks(doc.children, (block) => {
      if (block.type === 'heading' && block.attrs?.id !== undefined) state.usedHeadingIds.add(block.attrs.id)
    })
    expandBlocks(doc.children, state)
    if (doc.footnoteDefs) {
      // Each footnote body is its own container, with no preceding heading.
      for (const body of Object.values(doc.footnoteDefs)) {
        state.contextLevel = 0
        expandBlocks(body, state)
      }
    }
  }
  return {
    doc,
    warnings: state.warnings,
    dependencies: [...state.dependencies].map(([id, resolved]) => ({ id, resolved })),
  }
}

/** Filesystem resolver with canonical root-containment checks for trusted hosts. */
export function fileSystemResolver(
  root: string,
  opts: FileSystemResolverOptions = {},
): IncludeResolver {
  const rootReal = realpathSync(root)
  /**
   * Canonicalize-then-contain: the candidate is resolved to its real path
   * (symlinks followed) and only then compared against the real root.
   *
   * Deliberately NOT a lexical ban on "..", which is both too strict and too
   * weak. Too strict: "../shared/glossary.crv" from chapters/ch1.crv is a
   * normal book layout whose canonical target is inside the root, and must
   * resolve. Too weak: a symlink inside the root pointing out of it, or an
   * absolute path, escapes without containing ".." at all. Canonical
   * containment subsumes both cases.
   */
  const contains = (candidate: string): boolean => {
    const rel = path.relative(rootReal, candidate)
    if (rel === '') return true
    if (!rel || path.isAbsolute(rel)) return false
    // Segment-wise, so a directory legitimately named "..foo" is not read as
    // an escape the way a `startsWith('..')` prefix test would.
    return rel.split(path.sep)[0] !== '..'
  }
  return (includePath, ctx) => {
    if (!opts.allowAbsolute && path.isAbsolute(includePath)) return null
    // The stack carries the canonical (real) path of each ancestor, so a
    // nested relative include resolves against its actual parent directory,
    // not the root.
    const parent = ctx.stack[ctx.stack.length - 1]
    const base = parent ? path.dirname(path.resolve(rootReal, parent)) : rootReal
    const resolved = path.isAbsolute(includePath) ? includePath : path.resolve(base, includePath)
    let real: string
    try {
      real = realpathSync(resolved)
    } catch {
      return null
    }
    if (!contains(real)) return null
    return { source: readFileSync(real, 'utf8'), id: real }
  }
}
