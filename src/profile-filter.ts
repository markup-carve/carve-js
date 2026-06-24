/*
 * Profile AST transform (port of carve-php's ProfileFilter).
 *
 * Walks a (resolved) Document and, for every disallowed node, applies the
 * profile's `disallowedAction`:
 *   - to_text: replace the node with its rendered text content (default)
 *   - strip:   remove node + subtree
 *   - error:   collect violations and throw ProfileViolationError
 *
 * Also enforces maxNesting (block-container depth) and applies the link
 * policy (URL gating + rel attribute injection) in the same pass.
 *
 * carve-js' AST is heterogeneous: children live under different fields
 * depending on the node (`children`, `items`, `rows`, `cells`, `terms`,
 * `definitions`, `inline`, `content`, `target`, `caption`, `title`,
 * `attribution`). We expose a uniform child-list view over those fields so
 * the walk mirrors carve-php's `getChildren()` / `removeChild()` /
 * `replaceChildNode()` semantics.
 */

import type {
  Attrs,
  BlockNode,
  Document,
  InlineNode,
  Text,
} from './ast.js'
import {
  canonicalType,
  Profile,
  ProfileViolationError,
  type LinkPolicy,
  type ProfileViolation,
} from './profile.js'

type NodeLike = { type: string; attrs?: Attrs } & Record<string, unknown>

/**
 * Resolve a node to its canonical type for the allow/deny check, accounting
 * for shape-dependent types (footnote ref vs inline footnote) and the
 * bold-italic emphasis variant.
 */
function resolveCanonical(node: NodeLike): string | undefined {
  if (node.type === 'footnote') {
    // `^[...]` (inline) carries `inline`; `[^id]` is a reference.
    return node['inline'] !== undefined ? 'inline_footnote' : 'footnote_ref'
  }
  if (node.type === 'bold-italic') {
    // Nested strong+emphasis; gate it under `strong` (the outer feature).
    return 'strong'
  }
  return canonicalType(node.type)
}

/**
 * A child slot: the array a node's children live in, plus an index, plus
 * whether that array holds block-axis children (which decides how a to_text
 * replacement is shaped: a block-wrapping paragraph vs a bare inline Text).
 */
interface ChildSlot {
  list: NodeLike[]
  index: number
  block: boolean
  /**
   * The list holds homogeneous wrapper nodes the renderer assumes by type
   * (`list-item` in `list.items`, `table-row` in `table.rows`, `table-cell`
   * in `table-row.cells`). A to_text replacement here must stay that wrapper
   * type (wrapping its paragraph), otherwise the stricter carve-js renderer
   * throws. carve-php's renderer is lenient and emits a bare paragraph; this
   * is a deliberate structural divergence to keep js output valid.
   */
  wrap?: 'list-item' | 'table-row' | 'table-cell'
}

/** A child array view: the live array + whether it holds block children. */
interface ChildArray {
  list: NodeLike[]
  block: boolean
  wrap?: 'list-item' | 'table-row' | 'table-cell'
}

/**
 * Return the editable child arrays of a node (the fields that hold nested
 * block/inline nodes), each tagged block/inline. Each returned `list` is the
 * live array on the node, so splice/replace mutates the tree directly.
 */
function childArrays(node: NodeLike): ChildArray[] {
  const arrays: ChildArray[] = []
  const push = (
    v: unknown,
    block: boolean,
    wrap?: 'list-item' | 'table-row' | 'table-cell',
  ): void => {
    if (Array.isArray(v)) {
      arrays.push(wrap ? { list: v as NodeLike[], block, wrap } : { list: v as NodeLike[], block })
    }
  }
  switch (node.type) {
    case 'document':
      push(node['children'], true)
      break
    case 'list':
      push(node['items'], true, 'list-item')
      break
    case 'list-item':
      push(node['children'], true)
      break
    case 'table':
      push(node['rows'], true, 'table-row')
      if (node['caption']) push(node['caption'], false)
      break
    case 'table-row':
      push(node['cells'], true, 'table-cell')
      break
    case 'table-cell':
      push(node['children'], false)
      break
    case 'definition-list':
      // items is DefinitionItem[]; handled specially in filterDefinitionList.
      break
    case 'figure':
      if (node['caption']) push(node['caption'], false)
      break
    case 'footnote':
      // Inline footnote content is inline.
      if (node['inline']) push(node['inline'], false)
      break
    case 'extension':
      push(node['content'], false)
      break
    case 'admonition':
      if (node['title']) push(node['title'], false)
      push(node['children'], true)
      break
    case 'blockquote':
      push(node['children'], true)
      if (node['attribution']) push(node['attribution'], false)
      break
    case 'heading':
    case 'paragraph':
      push(node['children'], false)
      break
    default:
      // Generic inline container: span/emphasis/link/critic-*/etc.
      push(node['children'], false)
      break
  }
  return arrays
}

/** Whether a canonical type is a block-axis type (drives nesting depth). */
function isBlockNode(node: NodeLike): boolean {
  const c = resolveCanonical(node)
  if (c === undefined) {
    // Fall back to the js block type list for unmapped block nodes.
    return BLOCK_JS_TYPES.has(node.type)
  }
  return BLOCK_CANONICAL.has(c)
}

const BLOCK_CANONICAL = new Set([
  'paragraph',
  'heading',
  'code_block',
  'block_quote',
  'list',
  'list_item',
  'table',
  'table_row',
  'table_cell',
  'thematic_break',
  'div',
  'raw_block',
  'footnote',
  'definition_list',
  'definition_term',
  'definition_description',
  'section',
  'line_block',
  'comment',
  'figure',
  'caption',
])

const BLOCK_JS_TYPES = new Set([
  'heading',
  'paragraph',
  'blockquote',
  'list',
  'code-block',
  'thematic-break',
  'table',
  'admonition',
  'div',
  'definition-list',
  'figure',
  'image',
  'abbreviation-def',
  'raw-block',
  'comment',
])

/** Result of a profile transform. */
export interface ProfileFilterResult {
  doc: Document
  violations: ProfileViolation[]
}

class ProfileFilter {
  private violations: ProfileViolation[] = []

  constructor(private readonly baseHost: string | null) {}

  filter(doc: Document, profile: Profile): ProfileFilterResult {
    this.violations = []
    // carve-php starts the document's direct children at depth 0 and checks
    // `depth > maxNesting`, incrementing depth on *every* descend (block and
    // inline alike, since getChildren() includes inline children).
    this.filterChildArrays(doc as unknown as NodeLike, profile, 0)
    // carve-js stores footnote definitions in a separate `footnoteDefs`
    // record (keyed by label) rather than in the tree, but every renderer
    // emits them, so a denied node *inside* a referenced footnote definition
    // must be filtered too (e.g. an image in a footnote when images are
    // denied). carve-php keeps definitions in the tree and filters them
    // naturally; we mirror that by walking each definition's block list.
    const defs = (doc as unknown as { footnoteDefs?: Record<string, NodeLike[]> }).footnoteDefs
    if (defs) {
      for (const blocks of Object.values(defs)) {
        this.filterArray(blocks, profile, 1, true)
      }
    }
    this.cleanupEmptyContainers(doc as unknown as NodeLike)
    if (defs) {
      for (const blocks of Object.values(defs)) this.cleanupArray(blocks)
    }
    return { doc, violations: this.violations }
  }

  /**
   * Filter every child array of `parent`. Each direct child sits at `depth`.
   * Iterates a snapshot of each array (matching carve-php, which copies
   * getChildren() before mutating), then locates the live slot per child so
   * to_text/strip removals don't shift the walk.
   */
  private filterChildArrays(parent: NodeLike, profile: Profile, depth: number): void {
    if (parent.type === 'definition-list') {
      this.filterDefinitionList(parent, profile, depth)
      return
    }
    if (parent.type === 'figure') {
      this.filterFigure(parent, profile, depth)
      return
    }
    for (const { list, block, wrap } of childArrays(parent)) {
      this.filterArray(list, profile, depth, block, wrap)
    }
  }

  private filterArray(
    list: NodeLike[],
    profile: Profile,
    depth: number,
    block: boolean,
    wrap?: 'list-item' | 'table-row' | 'table-cell',
  ): void {
    const snapshot = [...list]
    for (const child of snapshot) {
      const index = list.indexOf(child)
      if (index === -1) continue // already removed by a prior step
      const slot: ChildSlot = wrap
        ? { list, index, block, wrap }
        : { list, index, block }

      const maxNesting = profile.getMaxNesting()
      if (maxNesting > 0 && depth > maxNesting) {
        this.handleViolation(child, slot, profile, 'max_nesting_exceeded')
        continue
      }

      const canonical = resolveCanonical(child)
      const allowed =
        canonical !== undefined
          ? profile.isTypeAllowed(canonical)
          : child.type === 'document'
      if (!allowed) {
        this.handleViolation(child, slot, profile, 'element_not_allowed')
        continue
      }

      const policy = profile.getLinkPolicy()
      if (policy !== null && (child.type === 'link' || child.type === 'autolink')) {
        if (!this.filterLink(child, slot, profile, policy)) continue
      }
      if (policy !== null && child.type === 'image') {
        if (!this.filterImage(child, slot, profile, policy)) continue
      }

      // Recurse: every level increments depth (matches carve-php).
      this.filterChildArrays(child, profile, depth + 1)
    }
  }

  private filterDefinitionList(parent: NodeLike, profile: Profile, depth: number): void {
    const items = parent['items'] as
      | { terms: InlineNode[][]; definitions: BlockNode[][] }[]
      | undefined
    if (!items) return
    for (const item of items) {
      for (const term of item.terms) {
        this.filterArray(term as unknown as NodeLike[], profile, depth + 1, false)
      }
      for (const defBlocks of item.definitions) {
        this.filterArray(defBlocks as unknown as NodeLike[], profile, depth + 1, true)
      }
    }
  }

  private filterFigure(parent: NodeLike, profile: Profile, depth: number): void {
    const caption = parent['caption'] as NodeLike[] | undefined
    if (caption) this.filterArray(caption, profile, depth + 1, false)
    const target = parent['target'] as NodeLike | undefined
    if (!target) return

    // The figure target is a single-node field (Image | BlockQuote | Table |
    // CodeBlock | Paragraph), not an array. carve-php treats it as an ordinary
    // child, so a denied target (e.g. an image when images are denied) must be
    // filtered. Wrap it in a one-element array view so the same allow/deny +
    // action machinery applies, then write the result back to `target`.
    const wrapper: NodeLike[] = [target]
    this.filterArray(wrapper, profile, depth + 1, true)
    if (wrapper.length === 0) {
      // Stripped: a figure with no target is meaningless; drop the figure by
      // emptying its caption too so cleanup removes it. carve-php removes the
      // node; we mark the target undefined and let the renderer/cleanup cope.
      delete (parent as Record<string, unknown>)['target']
      return
    }
    // filterArray already recursed into the survivor's / replacement's
    // children, so only the back-reference needs updating when it changed.
    const newTarget = wrapper[0]!
    if (newTarget !== target) (parent as Record<string, unknown>)['target'] = newTarget
  }

  /** Returns true if the link survives (allowed). */
  private filterLink(
    node: NodeLike,
    slot: ChildSlot,
    profile: Profile,
    policy: LinkPolicy,
  ): boolean {
    const url = node['href'] as string | undefined
    if (!policy.isUrlAllowed(url ?? '', this.baseHost)) {
      this.handleViolation(node, slot, profile, 'link_not_allowed')
      return false
    }
    this.applyRelAttributes(node, policy)
    return true
  }

  /** Returns true if the image survives (allowed). */
  private filterImage(
    node: NodeLike,
    slot: ChildSlot,
    profile: Profile,
    policy: LinkPolicy,
  ): boolean {
    const url = (node['src'] as string | undefined) ?? ''
    if (!policy.isUrlAllowed(url, this.baseHost)) {
      this.handleViolation(node, slot, profile, 'image_not_allowed')
      return false
    }
    return true
  }

  private applyRelAttributes(node: NodeLike, policy: LinkPolicy): void {
    const relAttrs = policy.getRelAttributes()
    if (relAttrs.length === 0) return
    const attrs = (node.attrs ??= {})
    const kv = (attrs.keyValues ??= {})
    const existing = kv['rel']
    const parts = existing !== undefined && existing !== '' ? existing.split(' ') : []
    for (const rel of relAttrs) if (!parts.includes(rel)) parts.push(rel)
    kv['rel'] = parts.join(' ')
    // Ensure `rel` appears in the source-order slots so the renderer emits it.
    attrs.order ??= []
    if (!attrs.order.includes('rel')) attrs.order.push('rel')
  }

  private handleViolation(
    node: NodeLike,
    slot: ChildSlot,
    profile: Profile,
    reason: string,
  ): void {
    const canonical = resolveCanonical(node) ?? node.type
    const reasonDescription = profile.getReasonDisallowed(canonical)
    this.violations.push({ nodeType: canonical, reason, reasonDescription })

    switch (profile.getDisallowedAction()) {
      case Profile.ACTION_STRIP:
        this.removeAt(slot)
        return
      case Profile.ACTION_ERROR:
        throw new ProfileViolationError(this.violations)
      case Profile.ACTION_TO_TEXT:
      default:
        this.convertToText(node, slot)
        return
    }
  }

  private removeAt(slot: ChildSlot): void {
    slot.list.splice(slot.index, 1)
  }

  private replaceAt(slot: ChildSlot, replacement: NodeLike): void {
    slot.list[slot.index] = replacement
  }

  private convertToText(node: NodeLike, slot: ChildSlot): void {
    // A comment is never visible; dropping it avoids leaking its body.
    if (node.type === 'comment') {
      this.removeAt(slot)
      return
    }

    const textContent = extractTextContent(node)
    if (textContent === '') {
      this.removeAt(slot)
      return
    }

    if (slot.block) {
      // Block context: wrap text in a paragraph to keep block structure,
      // converting newlines to hard breaks (mirrors carve-php
      // appendTextWithBreaks + the `$node instanceof BlockNode` branch, which
      // keys off the *container*, not the node's intrinsic axis — a
      // document-level inline image still becomes a wrapped paragraph).
      const para: NodeLike = {
        type: 'paragraph',
        children: textWithBreaks(textContent) as unknown as NodeLike[],
      }
      this.replaceAt(slot, this.wrapForContainer(para, textContent, slot.wrap))
    } else {
      const textNode: NodeLike = { type: 'text', value: textContent }
      this.replaceAt(slot, textNode)
    }
  }

  /**
   * Keep a to_text replacement valid for a typed-wrapper container. carve-php
   * inserts a bare paragraph here; carve-js' renderer assumes `list.items` are
   * list-items, `table.rows` are rows, and `table-row.cells` are cells, so we
   * re-wrap to that type (a deliberate, documented structural divergence).
   */
  private wrapForContainer(
    para: NodeLike,
    textContent: string,
    wrap?: 'list-item' | 'table-row' | 'table-cell',
  ): NodeLike {
    switch (wrap) {
      case 'list-item':
        return { type: 'list-item', children: [para] }
      case 'table-cell':
        return {
          type: 'table-cell',
          header: false,
          children: textWithBreaks(textContent) as unknown as NodeLike[],
        }
      case 'table-row':
        return {
          type: 'table-row',
          cells: [
            {
              type: 'table-cell',
              header: false,
              children: textWithBreaks(textContent) as unknown as NodeLike[],
            },
          ],
        }
      default:
        return para
    }
  }

  // ---- empty-container cleanup (mirrors carve-php) ----

  private cleanupEmptyContainers(parent: NodeLike): void {
    if (parent.type === 'definition-list') {
      const items = parent['items'] as
        | { terms: InlineNode[][]; definitions: BlockNode[][] }[]
        | undefined
      if (items) {
        for (const item of items) {
          for (const def of item.definitions) this.cleanupArray(def as unknown as NodeLike[])
        }
      }
      return
    }
    if (parent.type === 'figure') {
      const caption = parent['caption'] as NodeLike[] | undefined
      if (caption) this.cleanupArray(caption)
      const target = parent['target'] as NodeLike | undefined
      if (target) this.cleanupEmptyContainers(target)
      return
    }
    for (const { list } of childArrays(parent)) this.cleanupArray(list)
  }

  private cleanupArray(list: NodeLike[]): void {
    let i = 0
    while (i < list.length) {
      const child = list[i]!
      this.cleanupEmptyContainers(child)
      if (this.isEmptyContainer(child)) {
        list.splice(i, 1)
        continue
      }
      i++
    }
  }

  private isEmptyContainer(node: NodeLike): boolean {
    if (node.type === 'text') return (node['value'] as string) === ''

    // Nodes storing raw content directly are non-empty if they have content.
    const contentTypes = ['code-block', 'raw-block', 'raw-inline', 'math', 'code', 'comment']
    if (contentTypes.includes(node.type)) {
      const content = (node['content'] as string | undefined) ?? (node['value'] as string | undefined) ?? ''
      if (content !== '') return false
    }

    const allChildren = allChildNodes(node)

    if (allChildren.length === 0) {
      // Structural elements preserved even when empty.
      if (node.type === 'thematic-break' || node.type === 'table-cell') return false
      // Self-contained value/leaf nodes are not "empty containers".
      if (
        node.type === 'image' ||
        node.type === 'mention' ||
        node.type === 'tag' ||
        node.type === 'emoji' ||
        node.type === 'abbreviation' ||
        node.type === 'crossref' ||
        node.type === 'caption-number' ||
        node.type === 'soft-break' ||
        node.type === 'hard-break' ||
        contentTypes.includes(node.type)
      ) {
        return false
      }
      return isBlockNode(node)
    }

    for (const child of allChildren) if (!this.isEmptyContainer(child)) return false
    return true
  }
}

/**
 * Flatten every nested node of `node` across all its child arrays, including
 * the definition-list (terms/definitions) and figure (target) shapes that
 * `childArrays` deliberately skips (they need bespoke walking elsewhere).
 */
function allChildNodes(node: NodeLike): NodeLike[] {
  if (node.type === 'definition-list') {
    const out: NodeLike[] = []
    const items = (node['items'] as { terms: NodeLike[][]; definitions: NodeLike[][] }[]) ?? []
    // Non-spread push throughout: term/def/caption/child arrays can be
    // unbounded, so `push(...arr)` risks a call-stack overflow on large input.
    for (const item of items) {
      for (const term of item.terms) for (const n of term) out.push(n)
      for (const def of item.definitions) for (const n of def) out.push(n)
    }
    return out
  }
  if (node.type === 'figure') {
    const out: NodeLike[] = []
    const target = node['target'] as NodeLike | undefined
    if (target) out.push(target)
    const caption = node['caption'] as NodeLike[] | undefined
    if (caption) for (const n of caption) out.push(n)
    return out
  }
  const out: NodeLike[] = []
  for (const { list } of childArrays(node)) for (const n of list) out.push(n)
  return out
}

/** Build text nodes from content, converting `\n` to hard breaks. */
function textWithBreaks(content: string): NodeLike[] {
  const lines = content.split('\n')
  const out: NodeLike[] = []
  const last = lines.length - 1
  lines.forEach((line, idx) => {
    if (line !== '') out.push({ type: 'text', value: line })
    if (idx < last) out.push({ type: 'hard-break' })
  })
  return out
}

/**
 * Render a node to plain text the way carve-php's extractTextContent does, so
 * to_text output matches byte-for-byte. The representations are deliberately
 * source-flavored (heading `# ` prefix, `[img: alt]`, code fences, etc.).
 */
function extractTextContent(node: NodeLike): string {
  switch (node.type) {
    case 'image': {
      const alt = (node['alt'] as string | undefined) ?? ''
      return alt !== '' ? `[img: ${alt}]` : '[img]'
    }
    case 'heading': {
      const prefix = '#'.repeat(node['level'] as number) + ' '
      let text = ''
      for (const child of (node['children'] as NodeLike[]) ?? []) text += extractTextContent(child)
      return prefix + text
    }
    case 'code-block': {
      const content = (node['content'] as string) ?? ''
      if (content.includes('\n')) return '```\n' + content + '\n```'
      return '`' + content + '`'
    }
    case 'link':
    case 'autolink': {
      let text = ''
      for (const child of (node['children'] as NodeLike[]) ?? []) text += extractTextContent(child)
      // An autolink with no children carries the URL as its visible text.
      if (text === '' && node.type === 'autolink') return (node['href'] as string) ?? ''
      return text
    }
    case 'table': {
      const rows: string[] = []
      for (const row of (node['rows'] as NodeLike[]) ?? []) {
        if (row.type === 'table-row') {
          const cells: string[] = []
          for (const cell of (row['cells'] as NodeLike[]) ?? []) cells.push(extractTextContent(cell))
          rows.push(cells.join(' | '))
        }
      }
      return rows.join('\n')
    }
    case 'blockquote': {
      const paras: string[] = []
      for (const child of (node['children'] as NodeLike[]) ?? []) {
        const t = extractTextContent(child)
        if (t !== '') paras.push('> ' + t)
      }
      return paras.join('\n')
    }
    case 'definition-list': {
      const parts: string[] = []
      const items = (node['items'] as { terms: NodeLike[][]; definitions: NodeLike[][] }[]) ?? []
      for (const item of items) {
        for (const term of item.terms) {
          let t = ''
          for (const tn of term) t += extractTextContent(tn)
          if (t !== '') parts.push(t)
        }
        for (const def of item.definitions) {
          const ds: string[] = []
          for (const dn of def) {
            const t = extractTextContent(dn)
            if (t !== '') ds.push(t)
          }
          if (ds.length) parts.push('- ' + ds.join(' '))
        }
      }
      return parts.join('\n')
    }
    case 'list': {
      const items: string[] = []
      const ordered = node['ordered'] === true
      let index = (node['start'] as number | undefined) ?? 1
      for (const it of (node['items'] as NodeLike[]) ?? []) {
        if (it.type === 'list-item') {
          const t = extractTextContent(it)
          if (t !== '') {
            items.push((ordered ? `${index}. ` : '- ') + t)
            index++
          }
        }
      }
      return items.join('\n')
    }
    case 'emoji':
      return ':' + (node['name'] as string) + ':'
    case 'footnote': {
      // Reference: `[^id]`; carve-php FootnoteRef renders `[^label]`.
      if (node['inline'] === undefined) {
        return '[^' + ((node['id'] as string | undefined) ?? '') + ']'
      }
      // Inline footnote: join its inline content.
      let t = ''
      for (const child of (node['inline'] as NodeLike[]) ?? []) t += extractTextContent(child)
      return t
    }
    case 'thematic-break':
      return '---'
    case 'text':
      return (node['value'] as string) ?? ''
    case 'code':
      return (node['value'] as string) ?? ''
    case 'math':
      return (node['content'] as string) ?? ''
    case 'raw-block':
    case 'raw-inline':
      return (node['content'] as string) ?? ''
    case 'soft-break':
      return ' '
    case 'hard-break':
      return '\n'
    case 'mention':
      return '@' + (node['user'] as string)
    case 'tag':
      return '#' + (node['name'] as string)
    case 'abbreviation':
      return (node['abbr'] as string) ?? ''
    case 'comment':
      return ''
    default:
      break
  }

  // Generic: join child text. Block-ish containers join with space (matches
  // carve-php's default join), inline emphasis/spans concatenate.
  const children = allChildNodes(node)
  if (children.length === 0) return ''

  // Inline containers concatenate; block containers join with a space.
  const inlineConcat = INLINE_CONCAT.has(node.type)
  const parts: string[] = []
  for (const child of children) {
    const t = extractTextContent(child)
    if (t !== '') parts.push(t)
  }
  return parts.join(inlineConcat ? '' : ' ')
}

// Inline container types whose child text concatenates with no separator.
const INLINE_CONCAT = new Set([
  'italic',
  'strong',
  'underline',
  'strike',
  'super',
  'sub',
  'highlight',
  'bold-italic',
  'span',
  'critic-insert',
  'critic-delete',
  'extension',
  'paragraph',
])

/**
 * Apply a profile to a resolved Document, returning the filtered document and
 * any violations. The input document is mutated in place (callers that need
 * the original should clone first); this mirrors carve-php's filter().
 */
export function applyProfile(
  doc: Document,
  profile: Profile,
  baseHost: string | null = null,
): ProfileFilterResult {
  return new ProfileFilter(baseHost).filter(doc, profile)
}

export type { Text }
