import type {
  BlockNode,
  Document,
  Heading,
  HeadingLevel,
  InlineNode,
  Mention,
  Paragraph,
  Position,
  Tag,
  Text,
  SmartPunctuation,
  EscapedText,
} from './ast.js'
import type { CarveExtension } from './extension.js'
import { utf8ByteLength } from './abbr-budget.js'
import { inlineText, promoteBlockImages, slugify } from './heading-ids.js'
import { promoteCitationDefinitions } from './citations.js'
import { parse, normalizeRefLabel } from './parse.js'
import { mergeRun } from './coalesce-text-runs.js'
import {
  DIRECTIVE_SCAN_RE,
  DIRECTIVE_SHAPE_RE,
  parseDirective,
  type Directive,
} from './include-directive.js'

/**
 * One include directive, located in the file that wrote it.
 *
 * Deliberately the same four locating fields {@link IncludeWarning} carries,
 * plus the file they are measured in, so a host maps a site with the code it
 * already has for a warning. Nothing about the directive's TEXT is stored:
 * `start`/`end` bound the token itself in codepoints, so
 * `[...source].slice(start, end).join('')` is the token as written, and a host
 * that wants it parsed has {@link findDirectiveSites} for that file.
 */
export interface IncludeSite {
  /** 1-based line number when source positions are available. */
  line: number
  /** 1-based column number when source positions are available. */
  column: number
  /** 0-based start offset of the directive token, inclusive. */
  start: number
  /** 0-based end offset of the directive token, exclusive. */
  end: number
  /**
   * Identity of the file the directive is written in, on the same terms as
   * {@link IncludeWarning.file}. Absent for a directive in the top-level
   * document when the caller supplied no `sourcePath`.
   */
  file?: string
}

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
  /**
   * Raw underlying error text, when one exists. Kept OUT of `message` on
   * purpose: spec I7 requires a processor-generated message naming the
   * failure class, because a resolver's own error commonly embeds absolute
   * filesystem paths -- rendering those into a hosted preview leaks host
   * layout. Tools that want the raw text (a local CLI behind a verbose flag,
   * a log sink) can opt into it here; default output must not print it.
   */
  detail?: string
  /** 0-based start offset in the parent source, inclusive. */
  start: number
  /** 0-based end offset in the parent source, exclusive. */
  end: number
  /**
   * Identity of the file the warning arose in: the canonical id a resolver
   * returned for that file, or the raw directive path when the resolver
   * returned plain source. A directive that failed to resolve is attributed
   * to the document that contains it, not to the target it names; a warning
   * raised while expanding a child (a heading clamp, a rename, a nested
   * cycle) is attributed to that child.
   *
   * Absent for the top-level document when the caller supplied no
   * `sourcePath` - there is no identity to report, and none is invented.
   */
  file?: string
  /**
   * How {@link file} was REACHED: the directives that pulled the chain in,
   * root first, each located in the file that wrote it. The first entry is
   * therefore always a directive in the top-level document, and the last one
   * is the directive that pulled in `file` itself.
   *
   * Absent - never empty - for a warning raised in the top-level document,
   * including one about a directive there that failed to resolve: such a
   * warning is attributed to the document that wrote the directive, and
   * `line` / `column` / `start` / `end` already name a position in it. Present
   * on every warning attributed to a child, so `includedBy === undefined` and
   * "the warning is in the root" are the same question.
   *
   * This is what `file` alone cannot answer, and what an editor needs: a
   * warning raised in a child names offsets in the CHILD, and the only range
   * valid in the document a client has open is `includedBy[0]`. Reconstructing
   * it from resolver calls is exact only while every target is written once
   * and reached once - the engine expands a repeated target once per
   * occurrence, and the occurrences are distinguishable here and nowhere else.
   */
  includedBy?: IncludeSite[]
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

/** Why a resolver refused an include target, when it can classify the refusal. */
export type IncludeDenial = 'outside-root' | 'not-found' | 'no-root' | 'denied' | 'unresolved'

const INCLUDE_DENIALS = new Set<IncludeDenial>([
  'outside-root',
  'not-found',
  'no-root',
  'denied',
  'unresolved',
])

function isIncludeDenial(value: unknown): value is IncludeDenial {
  return typeof value === 'string' && INCLUDE_DENIALS.has(value as IncludeDenial)
}

/**
 * A target the resolver could not produce, named by where it would appear
 * (spec I11). A host watches that path and rebuilds when the file arrives; the
 * directive as written names nothing it can watch from a file below the root.
 */
export interface IncludeUnresolved {
  source: null
  id: string
  /** Portable refusal class for operator-facing dependency reports. */
  denial?: IncludeDenial
}

export interface IncludeOptions {
  /** Resolve an include path to source text. Return null for an unresolvable path. */
  resolve?: (path: string, ctx: IncludeContext) => IncludeResolved | IncludeUnresolved | null
  /** Identity of the root document, passed to the first resolver call as context. */
  sourcePath?: string
  /**
   * Extensions the child is parsed with. Pass the set the PARENT was parsed
   * with: an include is textual composition of one document, so the same text
   * has to mean the same thing whichever file it sits in. Left out, an
   * extension that adds syntax applies to the parent and not to the child.
   */
  extensions?: CarveExtension[]
  /** Maximum transitive include depth. Default 16. */
  maxDepth?: number
  /** Expanded child source byte budget. Default max(1 MB, 8 x root source bytes). */
  maxBytes?: number
  /**
   * Resolver calls allowed for one expansion. Default 1000.
   *
   * The byte budget bounds expanded OUTPUT; it does not bound the WORK done to
   * produce it, because a target is resolved before its size is known and a
   * document may carry one directive per dozen bytes. Spec section 19 requires
   * a finite bound here.
   */
  maxResolverCalls?: number
  /**
   * Include warnings retained. Default 100. A document of refused directives
   * otherwise allocates one warning per directive. One warning per distinct
   * rule always survives, and `suppressedWarnings` reports the remainder.
   */
  maxWarnings?: number
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
  /** Why the resolver refused, when it supplied a class. */
  denial?: IncludeDenial
}

export interface IncludeResult {
  doc: Document
  warnings: IncludeWarning[]
  /**
   * Include warnings raised but not retained, once `maxWarnings` was reached.
   * Zero on every uncapped run. Non-zero means `warnings` is a sample, not the
   * whole report - one warning per distinct rule is always kept.
   */
  suppressedWarnings: number
  /**
   * Every include target touched during the whole recursive expansion,
   * nested children included, de-duplicated and in first-encounter order.
   * Intended for preview invalidation: re-run the expansion when any of
   * these paths changes. Empty when no resolver was supplied.
   */
  dependencies: IncludeDependency[]
  /**
   * Bytes charged against the byte budget, per occurrence rather than per
   * distinct identity, and INCLUDING the target whose size broke it.
   *
   * PART 9 section 19 bounds the expanded OUTPUT and explicitly not the work
   * done to produce it, since a target is resolved before its size is known -
   * so a total that omitted the refused read could not tell "read nothing"
   * from "read a target and refused it", which is what a host auditing a
   * budget needs.
   *
   * A target refused BEFORE the budget check - non-text, or a cycle - is read
   * and not charged. Those are not budget decisions, and what bounds the I/O
   * a render performs is the separate resolver-call bound, which section 19
   * states for exactly that purpose.
   */
  chargedBytes: number
}


export type IncludeResolver = (
  path: string,
  ctx: IncludeContext,
) => IncludeResolved | IncludeUnresolved | null


interface State {
  opts: IncludeOptions
  warnings: IncludeWarning[]
  maxDepth: number
  maxBytes: number
  usedBytes: number
  maxResolverCalls: number
  resolverCalls: number
  maxWarnings: number
  suppressedWarnings: number
  /** Rules already represented in `warnings`, so a cap never hides a class. */
  seenRules: Set<string>
  /**
   * Rule of the first guard to refuse on a whole-expansion total - the byte
   * budget or the resolver-call bound - or undefined while both have room.
   * Both only ever grow, so once either is spent no later directive can
   * succeed; latching stops the pass resolving the rest of the document only
   * to refuse each directive individually (spec section 19, "refusal is
   * terminal").
   */
  spent?: 'include-budget' | 'include-call-limit'
  stack: string[]
  /** Directive nesting depth; separate from stack, which may hold the root id. */
  depth: number
  /**
   * Identity of the document whose content is currently being expanded, used
   * to attribute warnings ({@link IncludeWarning.file}). Undefined only for a
   * top-level document the caller gave no `sourcePath` for. Always present as
   * a key so `exactOptionalPropertyTypes` keeps the "unknown" case explicit.
   */
  file: string | undefined
  /**
   * Directives entered but not yet left, root first - the value
   * {@link IncludeWarning.includedBy} reports. Parallel to `file` rather than
   * to `stack`: it moves when the file being expanded moves, so a warning
   * raised before a child is entered describes the reach of the file that
   * wrote the directive, not of the target it names.
   */
  sites: IncludeSite[]
  docs: Document[]
  usedHeadingIds: Set<string>
  /** Include targets in first-encounter order; value is the resolved flag. */
  dependencies: Map<string, { resolved: boolean; denial?: IncludeDenial }>
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
  /** Overrides the attributed file when the warning is about content the
   * caller already merged out of its own document (see mergeFootnotes). */
  file: string | undefined = state.file,
  /** Raw underlying error text; never folded into `message` (spec I7). */
  detail?: string,
  /** Overrides the reported reach, for the same reason `file` is overridden. */
  sites: IncludeSite[] = state.sites,
): void {
  // A rule not yet represented is always kept, so a capped report still shows
  // every distinct failure class; only repeats of a class already shown are
  // counted instead of stored.
  if (state.warnings.length >= state.maxWarnings && state.seenRules.has(rule)) {
    state.suppressedWarnings++
    return
  }
  const warning: IncludeWarning = { ...locate(node ?? {}), rule, message }
  if (file !== undefined) warning.file = file
  if (detail !== undefined) warning.detail = detail
  // Snapshotted: `state.sites` is mutated as the walk enters and leaves
  // children, and a warning holds the reach it was raised under.
  if (sites.length > 0) warning.includedBy = [...sites]
  state.seenRules.add(rule)
  state.warnings.push(warning)
}

function sourceLines(source: string): string[] {
  const lines = source.split(/\n/)
  if (lines.length && lines[lines.length - 1] === '') lines.pop()
  return lines
}

function sliceLines(source: string, range: { start: number; end: number }): string {
  return sourceLines(source).slice(range.start - 1, range.end).join('\n')
}

/** Where a `@lines` slice sits in the file it was cut from. */
interface SliceBase {
  /** Line breaks preceding the slice, counted as the lexer counts them. */
  line: number
  /** Codepoints preceding the slice. */
  offset: number
}

/**
 * The part of `source` that `sliceLines` cut away ahead of the range.
 *
 * Reconstructed from the same `\n` split the slice uses, so it is the raw
 * prefix byte for byte: a `\r` stays inside its line and every separator is
 * restored. Line breaks are then counted the way the lexer does (`\r\n`, a
 * lone `\r` and `\n` all end a line) and offsets in codepoints, because that
 * is the space the positions being rebased are measured in.
 */
function sliceBase(source: string, range: { start: number; end: number }): SliceBase {
  const before = sourceLines(source).slice(0, range.start - 1)
  if (before.length === 0) return { line: 0, offset: 0 }
  const prefix = `${before.join('\n')}\n`
  return { line: prefix.match(/\r\n|[\r\n]/g)?.length ?? 0, offset: codepoints(prefix) }
}

/**
 * Put a sliced child's positions back into the coordinates of the file they
 * were cut from (spec PART 9 section 19: an included node keeps the
 * coordinates of its own file, and `pos.file` names that file).
 *
 * Columns are untouched because the slice cuts whole lines. Runs before any
 * warning the child raises, so `IncludeWarning.line` / `start` / `end` read
 * the rebased positions rather than needing a second correction.
 */
function rebaseSlicedChild(child: Document, base: SliceBase): void {
  if (base.line === 0 && base.offset === 0) return
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }
    if (value === null || typeof value !== 'object') return
    const pos = (value as { pos?: Position }).pos
    if (pos) {
      pos.startLine += base.line
      pos.endLine += base.line
      if (pos.startOffset !== undefined) pos.startOffset += base.offset
      if (pos.endOffset !== undefined) pos.endOffset += base.offset
    }
    for (const [key, inner] of Object.entries(value)) {
      if (key !== 'pos') visit(inner)
    }
  }
  visit(child.children)
  if (child.footnoteDefs) visit(Object.values(child.footnoteDefs))
}

function runAnchor(run: RunNode[], offset: number): Text {
  let cursor = 0
  for (const node of run) {
    const end = cursor + runNodeText(node).length
    if (offset < end && node.type === 'text') return node
    cursor = end
  }
  return run.find((node): node is Text => node.type === 'text') ?? ({ type: 'text', value: '' } as Text)
}

/** Locate a directive in the file currently being expanded. */
function siteOf(run: RunNode[], from: number, to: number, state: State): IncludeSite {
  const span = siteSpan(run, from, to)
  return state.file === undefined ? span : { ...span, file: state.file }
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
function note(state: State, id: string, resolved: boolean, denial?: IncludeDenial): void {
  const current = state.dependencies.get(id)
  if (resolved) {
    state.dependencies.set(id, { resolved: true })
  } else if (current === undefined) {
    state.dependencies.set(id, denial === undefined ? { resolved: false } : { resolved: false, denial })
  } else if (!current.resolved && current.denial === undefined && denial !== undefined) {
    current.denial = denial
  }
}

function spentMessage(rule: 'include-budget' | 'include-call-limit', path: string): string {
  return rule === 'include-call-limit'
    ? `Include resolver call limit exceeded for "${path}".`
    : `Include byte budget exceeded by "${path}".`
}

function resolveChild(
  d: Directive,
  state: State,
  node: Text,
): { source: string; id: string; base: SliceBase } | null {
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

  // A whole-expansion total is already spent, so this directive cannot expand
  // whatever it resolves to. Refuse it WITHOUT resolving: the target is never
  // read, and it is reported unresolved because it genuinely was not.
  if (state.spent) {
    note(state, d.path, false)
    warn(state, state.spent, spentMessage(state.spent, d.path), node)
    return null
  }
  if (state.resolverCalls >= state.maxResolverCalls) {
    state.spent = 'include-call-limit'
    note(state, d.path, false)
    warn(state, 'include-call-limit', spentMessage('include-call-limit', d.path), node)
    return null
  }
  state.resolverCalls++

  let resolved: unknown
  try {
    resolved = state.opts.resolve(d.path, childContext(state))
  } catch (e) {
    note(state, d.path, false)
    // Spec I7: the message is OURS and names the failure class plus the path
    // as written. The resolver's own error goes to `detail` instead -- a
    // filesystem resolver's message routinely carries an absolute path, and
    // echoing that into rendered output discloses host layout.
    warn(
      state,
      'include-unresolved',
      `Include "${d.path}" could not be resolved.`,
      node,
      state.file,
      (e as Error)?.message,
    )
    return null
  }
  if (resolved === null || resolved === undefined) {
    // Covers missing files and containment denials alike: the resolver reports
    // both as null, and a host wants to re-check either if the tree changes.
    note(state, d.path, false)
    warn(state, 'include-unresolved', `Include "${d.path}" could not be resolved.`, node)
    return null
  }
  // I11: the resolver named where the target would be without producing it.
  if (typeof resolved === 'object' && (resolved as { source?: unknown }).source === null) {
    const named = (resolved as { id?: unknown }).id
    const denial = (resolved as { denial?: unknown }).denial
    note(
      state,
      typeof named === 'string' && named !== '' ? named : d.path,
      false,
      isIncludeDenial(denial) ? denial : undefined,
    )
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

  // CHARGED BEFORE THE COMPARISON, because by this line the resolver has run
  // and `source` is in hand: `utf8ByteLength` is reading it. PART 9 section 19
  // says the budget "does not bound the WORK a processor does to produce it,
  // because a target is resolved before its size is known", so the read cannot
  // be avoided at this seam and charging what was read is the honest total.
  // Charging only what was ADMITTED cannot tell "read nothing" from "read a
  // target and refused it".
  //
  // The refusal itself does not move: `state.spent` latches on the same
  // directive either way, so every later one is still refused without being
  // resolved, which is section 19's separate "refusal is terminal" rule.
  const bytes = utf8ByteLength(source)
  state.usedBytes += bytes
  if (state.usedBytes > state.maxBytes) {
    state.spent = 'include-budget'
    warn(state, 'include-budget', spentMessage('include-budget', d.path), node)
    return null
  }
  if (d.lines && d.lines.start > sourceLines(source).length) {
    warn(state, 'include-lines-out-of-range', `Include line range for "${d.path}" starts past end of file.`, node)
    return null
  }
  if (!d.lines) return { source, id, base: { line: 0, offset: 0 } }
  return { source: sliceLines(source, d.lines), id, base: sliceBase(source, d.lines) }
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
      case 'block_quote':
      case 'div':
      case 'admonition':
        node.children.forEach(visit)
        break
      case 'list':
        for (const item of node.items) item.children.forEach(visit)
        break
      case 'definition_list':
        for (const item of node.items) for (const def of item.definitions) def.forEach(visit)
        break
      case 'figure':
        if (node.target.type === 'block_quote') visit(node.target)
        break
    }
  }
  blocks.forEach(visit)
}

/**
 * Snapshot of every identifier namespace an include can reserve from, taken
 * before a child is processed so a REJECTED directive can give them back.
 */
interface Reservations {
  headingIds: Set<string>
  target: Document
  footnoteDefs: Record<string, BlockNode[]> | undefined
  warnings: number
}

function beginReservations(state: State): Reservations {
  const target = state.docs[state.docs.length - 1]!
  return {
    headingIds: new Set(state.usedHeadingIds),
    target,
    footnoteDefs: target.footnoteDefs ? { ...target.footnoteDefs } : undefined,
    warnings: state.warnings.length,
  }
}

/**
 * Undo the reservations a rejected include made. Rejection reasons that carry
 * their own warning (unresolved, cycle, depth, budget, ...) keep it - it is
 * the diagnostic the author needs - but a rename warning is dropped along
 * with the rename it reported, since neither survives into the document.
 */
function rollbackReservations(state: State, snap: Reservations): void {
  state.usedHeadingIds.clear()
  for (const id of snap.headingIds) state.usedHeadingIds.add(id)
  if (snap.footnoteDefs === undefined) delete snap.target.footnoteDefs
  else snap.target.footnoteDefs = snap.footnoteDefs
  const dropped = new Set(['include-heading-id-rename', 'include-footnote-rename'])
  if (state.warnings.length > snap.warnings) {
    state.warnings.splice(
      snap.warnings,
      state.warnings.length - snap.warnings,
      ...state.warnings.slice(snap.warnings).filter((w) => !dropped.has(w.rule)),
    )
  }
}

/**
 * Expand one directive and merge its content, as a transaction.
 *
 * A rejected directive must leave NO observable trace: the document has to
 * come out byte-identical to the same document with that directive written as
 * literal text from the start. Rejection can happen before the child is even
 * read (unresolvable, cycle, depth, budget, both selections) or only at merge
 * time (block content at an inline position), and by then the child's explicit
 * heading ids are already reserved - which silently suffixed a later, entirely
 * legitimate heading. Reserving inside a transaction that only commits when
 * `merge` actually takes the content covers every such path by construction,
 * including ones added later, rather than special-casing the one found.
 *
 * `merge` returns null to reject; it must emit no warning of its own, so the
 * caller can report the rejection after the rollback has run.
 *
 * The byte budget is deliberately NOT rolled back: those bytes were really
 * read and parsed, and refunding them would let a rejected include be
 * repeated without limit.
 */
function includeChild<T>(
  d: Directive,
  state: State,
  node: Text,
  site: IncludeSite,
  merge: (child: Document, file: string, reach: IncludeSite[]) => T | null,
): T | null {
  const snap = beginReservations(state)
  const expanded = expandChild(d, state, node, site)
  const merged = expanded === null ? null : merge(expanded.doc, expanded.file, expanded.reach)
  if (merged === null) rollbackReservations(state, snap)
  return merged
}

/**
 * Read a child the way the entry point reads the root.
 *
 * The two structural passes are the ones `parse` in `index.ts` runs on top of
 * the parser: a reference image plus its caption is a `figure` there and was a
 * paragraph here, so the same lines rendered `^ Cap` as text once they arrived
 * through a directive. `promoteCitationDefinitions` is the same divergence one
 * extension further in - it needs the citation groups the extensions produce.
 */
function parseChild(source: string, state: State): Document {
  const extensions = state.opts.extensions
  const doc = parse(source, { positions: true, ...(extensions ? { extensions } : {}) })
  promoteBlockImages(doc.children, true)
  if (doc.footnoteDefs) {
    for (const body of Object.values(doc.footnoteDefs)) promoteBlockImages(body, true)
  }
  doc.children = promoteCitationDefinitions(doc.children)
  return doc
}

function expandChild(
  d: Directive,
  state: State,
  node: Text,
  site: IncludeSite,
): { doc: Document; file: string; reach: IncludeSite[] } | null {
  const resolved = resolveChild(d, state, node)
  if (resolved === null) return null
  const child = parseChild(resolved.source, state)
  // Before anything reads a position: selection, renames, nested expansion and
  // every warning below measure against the child's own file, not the slice.
  rebaseSlicedChild(child, resolved.base)
  // Select before expanding: nested includes outside the wanted section must
  // not be resolved (no budget charge) and must not move section boundaries.
  if (d.section) {
    const selected = selectSection(child, d.section)
    if (!selected) {
      // The dependency stays RESOLVED (spec I11): `resolved` reflects only
      // whether the source was READ, and it was. The host must keep watching
      // the target so that editing the child to ADD the missing section
      // invalidates the preview -- which a downgrade to unresolved would not
      // change, but which would misreport a successful read as a failed one.
      warn(state, 'include-section', `Include "${d.path}" has no section "#${d.section}".`, node)
      return null
    }
    child.children = selected
  }
  // Everything from here on operates on the child's own content, so warnings
  // it raises name the child rather than the document that included it.
  const outerFile = state.file
  state.file = resolved.id
  // Entered together with `file`, so every warning from here on reports the
  // child as its file and this directive as the last hop that reached it.
  state.sites.push(site)
  const reach = [...state.sites]
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
  stampSourceFile(child, resolved.id)
  state.file = outerFile
  state.sites.pop()
  return { doc: child, file: resolved.id, reach }
}

/**
 * Record which file a position is measured in, for every node of a resolved
 * child (spec section 19, source mapping).
 *
 * Runs AFTER the child's own includes are expanded and only where no identity
 * is set yet, so a grandchild keeps the file IT came from rather than being
 * overwritten by the file that pulled its parent in.
 */
function stampSourceFile(child: Document, file: string): void {
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }
    if (value === null || typeof value !== 'object') return
    const node = value as { pos?: { file?: string } }
    if (node.pos && node.pos.file === undefined) node.pos.file = file
    for (const [key, inner] of Object.entries(value)) {
      if (key !== 'pos') visit(inner)
    }
  }
  visit(child.children)
  if (child.footnoteDefs) visit(Object.values(child.footnoteDefs))
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

/**
 * A slice of `like` starting `from` code units in, with the part of its span the
 * slice covers (PART 12 §4). A span crossing a line has no column arithmetic,
 * so that slice publishes none.
 */
function textFrom(value: string, like: Text, from: number): Text {
  const pos = like.pos
  if (
    !pos ||
    pos.startLine !== pos.endLine ||
    pos.startOffset === undefined ||
    pos.startColumn === undefined
  ) {
    const { pos: _dropped, ...rest } = like
    return { ...rest, value }
  }
  const before = codepoints(like.value.slice(0, from))
  const length = codepoints(value)
  return {
    ...like,
    value,
    pos: {
      ...pos,
      startColumn: pos.startColumn + before,
      endColumn: pos.startColumn + before + length,
      startOffset: pos.startOffset + before,
      endOffset: pos.startOffset + before + length,
    },
  }
}

function codepoints(s: string): number {
  let n = 0
  for (const _ of s) n++
  return n
}

type RunNode = Text | Mention | Tag | SmartPunctuation | EscapedText

function isRunNode(node: InlineNode): node is RunNode {
  return (
    node.type === 'text' ||
    node.type === 'mention' ||
    node.type === 'tag' ||
    node.type === 'smart_punctuation' ||
    node.type === 'escaped_text'
  )
}

/**
 * The source text a run node stands for.
 *
 * A quoted path reaches here as a `smart_punctuation` node per delimiter, and
 * its `value` is the author's own run (`"`), not the glyph the parser resolved
 * it to. Reassembling from `value` therefore sees the directive exactly as
 * written, which is what the grammar matches - matching the curled glyph
 * instead would make the path depend on smart typography having run.
 */
function runNodeText(node: RunNode): string {
  if (node.type === 'text') return node.value
  if (node.type === 'smart_punctuation') return node.value
  // The backslash is part of the source run: a quoted path spells an inner
  // quote as an escape, and the grammar matches the escape, not a bare quote.
  if (node.type === 'escaped_text') return `\\${node.value}`
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
    const sliceFrom = Math.max(from, start) - start
    const value = text.slice(sliceFrom, Math.min(to, end) - start)
    if (value === text) out.push(node)
    else if (value !== '') out.push(textFrom(value, node, sliceFrom))
  }
  return out
}

/**
 * Scan a contiguous run of text-like inline nodes (text, mention, tag, smart
 * punctuation) for
 * directives. The core splits "{{ x #s @shift:1 }}" into text plus tag and
 * mention nodes, so recognition reassembles the run before matching. Failed
 * directives keep their original nodes, rendering exactly as the core does
 * with no resolver.
 */
function expandRun(run: RunNode[], state: State): InlineNode[] {
  const full = run.map(runNodeText).join('')
  const re = new RegExp(DIRECTIVE_SCAN_RE.source, 'g')
  const spans: { start: number; end: number; replacement: InlineNode[] }[] = []
  for (let m = re.exec(full); m; m = re.exec(full)) {
    const raw = m[0]
    const anchor = runAnchor(run, m.index)
    const d = parseDirective(raw, (part) =>
      warn(state, 'include-unknown-option', `Unknown include option "${part}".`, anchor),
    )
    if (!d) continue
    let blockInInline = false
    const site = siteOf(run, m.index, m.index + raw.length, state)
    const replacement = includeChild(d, state, anchor, site, (child, file, reach) => {
      if (child.children.length > 1 || (child.children.length === 1 && child.children[0]!.type !== 'paragraph')) {
        blockInInline = true
        return null
      }
      const inlines = child.children.length === 1 ? (child.children[0] as Paragraph).children : []
      mergeFootnotes(state.docs[state.docs.length - 1]!, child, state, file, reach)
      return inlines
    })
    if (blockInInline) {
      warn(state, 'include-block-in-inline', `Inline include "${d.path}" resolved to block content.`, anchor)
    }
    if (replacement === null) continue
    spans.push({ start: m.index, end: m.index + raw.length, replacement })
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
  // The splice leaves the child's text beside the host's halves, and §1a holds
  // for this tree too: `toAstJson` publishes it without `resolve()`.
  const placed = run.filter((node) => node.pos)
  const first = placed[0]?.pos
  const last = placed[placed.length - 1]?.pos
  const span =
    first && last
      ? { ...first, endLine: last.endLine, endColumn: last.endColumn, endOffset: last.endOffset }
      : undefined
  const merged = mergeRun(out as unknown as Array<Record<string, unknown>>, { file: first?.file, span })
  return (merged as unknown as InlineNode[] | null) ?? out
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
        case 'emphasis':
        case 'strong':
        case 'underline':
        case 'strike':
        case 'superscript':
        case 'subscript':
        case 'highlight':
        case 'link':
        case 'span':
        case 'insert':
        case 'delete':
          node.children = expandInlines(node.children, state)
          break
        case 'inline_extension':
          node.content = expandInlines(node.content, state)
          break
        case 'inline_footnote':
          if (node.inline) node.inline = expandInlines(node.inline, state)
          break
        case 'substitution':
          node.old = expandInlines(node.old, state)
          node.new = expandInlines(node.new, state)
          break
        case 'citation_group':
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

/**
 * Source of a paragraph that is NOTHING BUT a directive, or null when some
 * node in it cannot belong to a directive run.
 *
 * Deliberately built from the same `isRunNode` / `runNodeText` pair the inline
 * scan uses. A second, hand-written copy of the vocabulary is what let block
 * recognition fall behind: it did not know about the `smart_punctuation` nodes
 * a quoted path is made of, so `{{ "c d.crv" }}` alone on its line was read as
 * an INLINE include and a block-shaped child was then refused.
 */
function directiveSource(nodes: InlineNode[]): string | null {
  let out = ''
  for (const node of nodes) {
    if (!isRunNode(node)) return null
    out += runNodeText(node)
  }
  return out
}

function renameInlines(nodes: InlineNode[], footnotes: Map<string, string>, headings: Map<string, string>): void {
  for (const node of nodes) {
    if (node.type === 'footnote_ref' && node.id !== undefined) node.id = footnotes.get(node.id) ?? node.id
    if (node.type === 'heading_ref') node.target = headings.get(node.target) ?? node.target
    if ('children' in node && Array.isArray(node.children)) renameInlines(node.children, footnotes, headings)
    if (node.type === 'inline_extension') renameInlines(node.content, footnotes, headings)
    if (node.type === 'inline_footnote' && node.inline) renameInlines(node.inline, footnotes, headings)
    if (node.type === 'substitution') {
      renameInlines(node.old, footnotes, headings)
      renameInlines(node.new, footnotes, headings)
    }
    if (node.type === 'citation_group') {
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

/**
 * `childFile` and `reach` are the child's: the renamed label is the child's
 * own, and the merge runs after expansion has already restored the parent as
 * the current file and left the child's directive, so both are passed in
 * explicitly rather than read off the walk.
 */
function mergeFootnotes(
  target: Document,
  child: Document,
  state: State,
  childFile: string,
  reach: IncludeSite[],
): void {
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
      warn(
        state,
        'include-footnote-rename',
        `Footnote label "${label}" was renamed to "${finalLabel}".`,
        undefined,
        childFile,
        undefined,
        reach,
      )
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
      const site = siteOf(block.children as RunNode[], 0, source.length, state)
      const merged = includeChild(d, state, text, site, (child, file, reach) => {
        mergeFootnotes(state.docs[state.docs.length - 1]!, child, state, file, reach)
        return child.children
      })
      // Degrade to literal: the original inline nodes render exactly as the
      // core does with no resolver (spec I7).
      return merged ?? [block]
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
      case 'block_quote':
      case 'div':
      case 'admonition':
        expandBlocks(block.children, state)
        break
      case 'list':
        for (const item of block.items) expandBlocks(item.children, state)
        break
      case 'definition_list':
        for (const item of block.items) for (const def of item.definitions) expandBlocks(def, state)
        break
      case 'figure':
        if (block.target.type === 'block_quote') expandBlocks(block.target.children, state)
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
      case 'block_quote':
      case 'div':
      case 'admonition':
        walkBlocks(block.children, fn)
        break
      case 'list':
        for (const item of block.items) walkBlocks(item.children, fn)
        break
      case 'definition_list':
        for (const item of block.items) for (const def of item.definitions) walkBlocks(def, fn)
        break
      case 'figure':
        if (block.target.type === 'block_quote') walkBlocks(block.target.children, fn)
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
/**
 * Whether the include pass runs for a given render target (spec I15).
 *
 * Only the Carve target opts out, and the reason is not performance: that
 * target writes the document back as Carve source, and expanding first returns
 * a DIFFERENT document, with every child inlined and the directives gone. The
 * writer already preserves a directive verbatim (I12); expanding before it runs
 * takes that away by another route.
 *
 * Exported, and read by both the CLI and the include-conformance suite, so the
 * rule has ONE home. It used to be an inline comparison in the CLI, which is
 * how this engine came to inline includes on `render --carve` while carve-rs
 * and carve-php returned the author's source.
 */
export function expandsForTarget(target: string): boolean {
  return target !== 'carve'
}

export function expandIncludes(doc: Document, source: string, options: IncludeOptions = {}): IncludeResult {
  const state: State = {
    opts: options,
    warnings: [],
    maxDepth: options.maxDepth ?? 16,
    maxBytes: options.maxBytes ?? Math.max(MIN_BUDGET, 8 * utf8ByteLength(source)),
    maxResolverCalls: options.maxResolverCalls ?? 1000,
    resolverCalls: 0,
    maxWarnings: options.maxWarnings ?? 100,
    suppressedWarnings: 0,
    seenRules: new Set<string>(),
    usedBytes: 0,
    stack: options.sourcePath ? [options.sourcePath] : [],
    depth: 0,
    file: options.sourcePath,
    sites: [],
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
    suppressedWarnings: state.suppressedWarnings,
    dependencies: [...state.dependencies].map(([id, dependency]) => ({ id, ...dependency })),
    chargedBytes: state.usedBytes,
  }
}

/**
 * One include directive the expander would act on, located in the document.
 */
export interface DirectiveSite {
  /** The directive token exactly as written. */
  raw: string
  /** The parsed directive: path, and any section, line range or shift. */
  directive: Directive
  /**
   * True when the directive is a whole paragraph of its own, so it expands to
   * BLOCKS; false for one inside a run of inline content.
   */
  block: boolean
  /**
   * Line and column of the inline node the token starts in - the same anchor
   * {@link expandIncludes} attributes its warnings to, so a host can match a
   * site against a warning it already has.
   */
  line: number
  column: number
  /**
   * Offsets bounding the token itself, in the CODEPOINT unit `pos` uses -
   * `[...source].slice(start, end).join('')` is `raw`. Both are zero when the
   * document was parsed without positions.
   */
  start: number
  end: number
}

/**
 * Source offset of the character at `index` of the run's reassembled text.
 *
 * Each boundary is resolved against the node it falls in and that node's own
 * position, never by measuring from the run's start: a run reassembles nodes
 * that need not be adjacent in source, and a directive carrying a section or
 * an option is split across several of them ("{{ a.crv " + tag + " }}").
 *
 * The count is in CODEPOINTS, because `pos` offsets are - so a host slices a
 * site out of its buffer the same way it slices any other node out.
 */
function absoluteAt(run: RunNode[], index: number): number | undefined {
  let cursor = 0
  for (const node of run) {
    const text = runNodeText(node)
    const end = cursor + text.length
    if (index < end) {
      // A directive opens and closes with characters the core always parses as
      // text, so a boundary can only fall in a text node (see sliceRun).
      if (node.type !== 'text' || node.pos?.startOffset === undefined) return undefined
      return node.pos.startOffset + [...text.slice(0, index - cursor)].length
    }
    cursor = end
  }
  return undefined
}

function siteSpan(run: RunNode[], from: number, to: number): Pick<DirectiveSite, 'line' | 'column' | 'start' | 'end'> {
  const at = locate(runAnchor(run, from))
  const start = absoluteAt(run, from)
  // The last character of the token, not the position after it: there may be
  // no node covering `to`, and a closing "}" is one codepoint either way.
  const last = absoluteAt(run, to - 1)
  if (start === undefined || last === undefined) return at
  return { line: at.line, column: at.column, start, end: last + 1 }
}

function collectRun(run: RunNode[], sites: DirectiveSite[]): void {
  const full = run.map(runNodeText).join('')
  const re = new RegExp(DIRECTIVE_SCAN_RE.source, 'g')
  for (let m = re.exec(full); m; m = re.exec(full)) {
    const directive = parseDirective(m[0])
    if (!directive) continue
    sites.push({ raw: m[0], directive, block: false, ...siteSpan(run, m.index, m.index + m[0].length) })
  }
}

function collectInlines(nodes: InlineNode[], sites: DirectiveSite[]): void {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!
    if (isRunNode(node)) {
      let j = i
      while (j < nodes.length && isRunNode(nodes[j]!)) j++
      collectRun(nodes.slice(i, j) as RunNode[], sites)
      i = j - 1
      continue
    }
    switch (node.type) {
      case 'emphasis':
      case 'strong':
      case 'underline':
      case 'strike':
      case 'superscript':
      case 'subscript':
      case 'highlight':
      case 'link':
      case 'span':
      case 'insert':
      case 'delete':
        collectInlines(node.children, sites)
        break
      case 'inline_extension':
        collectInlines(node.content, sites)
        break
      case 'inline_footnote':
        if (node.inline) collectInlines(node.inline, sites)
        break
      case 'substitution':
        collectInlines(node.old, sites)
        collectInlines(node.new, sites)
        break
      case 'citation_group':
        for (const item of node.items) {
          if (item.prefix) collectInlines(item.prefix, sites)
          if (item.locator) collectInlines(item.locator, sites)
          if (item.suffix) collectInlines(item.suffix, sites)
        }
        break
    }
  }
}

function collectParagraph(block: Paragraph, sites: DirectiveSite[]): void {
  const source = directiveSource(block.children)
  if (source !== null) {
    const directive = parseDirective(source)
    if (directive) {
      const run = block.children as RunNode[]
      sites.push({ raw: source, directive, block: true, ...siteSpan(run, 0, source.length) })
      return
    }
    // A whole-paragraph token that does not parse stays literal, and the
    // expander does not scan it again as inline content either.
    if (DIRECTIVE_SHAPE_RE.test(source.trim())) return
  }
  collectInlines(block.children, sites)
}

function collectBlocks(blocks: BlockNode[], sites: DirectiveSite[]): void {
  for (const block of blocks) {
    switch (block.type) {
      case 'paragraph':
        collectParagraph(block, sites)
        break
      case 'block_quote':
      case 'div':
      case 'admonition':
        collectBlocks(block.children, sites)
        break
      case 'list':
        for (const item of block.items) collectBlocks(item.children, sites)
        break
      case 'definition_list':
        for (const item of block.items) for (const def of item.definitions) collectBlocks(def, sites)
        break
      case 'figure':
        if (block.target.type === 'block_quote') collectBlocks(block.target.children, sites)
        else if (block.target.type === 'paragraph') collectInlines(block.target.children, sites)
        if (block.caption) collectInlines(block.caption, sites)
        break
      case 'heading':
        collectInlines(block.children, sites)
        break
      case 'table':
        if (block.caption) collectInlines(block.caption, sites)
        for (const row of block.rows) for (const cell of row.cells) collectInlines(cell.children, sites)
        break
    }
  }
}

/**
 * Locate the include directives {@link expandIncludes} would act on, in
 * document order.
 *
 * The answer is the EXPANDER's rather than a scan's: this visits exactly the
 * blocks and inline containers the expansion visits, so a `{{ ... }}` in a
 * code block, in a raw block or in a link destination is absent here for the
 * same reason it is never expanded, and a token whose options are malformed is
 * absent because it stays literal text (spec I1). A host that matched source
 * text with its own pattern would disagree with the engine about exactly those
 * tokens - which is the question an editor has to answer before it offers
 * go-to-definition on an include path.
 *
 * Parse with `positions: true` for `start`/`end` to be usable; without them
 * every site reports the zero offsets the AST carries.
 */
export function findDirectiveSites(doc: Document): DirectiveSite[] {
  const sites: DirectiveSite[] = []
  collectBlocks(doc.children, sites)
  // Footnote bodies are containers of their own to the expander (spec I8), and
  // a directive in one expands like any other.
  if (doc.footnoteDefs) for (const body of Object.values(doc.footnoteDefs)) collectBlocks(body, sites)
  return sites
}
