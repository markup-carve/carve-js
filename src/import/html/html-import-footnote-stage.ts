import { defaultTreeAdapter, html as p5html } from 'parse5'
import type { BlockNode, InlineNode } from '../../ast.js'
import { domAttrs, domChild, domContainer, domChildren, domParent, domTag, domValue, type P5Node } from './html-import-dom.js'
import type { HtmlImportReportCollector } from './html-import-report.js'
import { setOwn } from '../../own-property.js'
import { RESERVED_CARRIER_ATTRIBUTES } from '../../ast/roundtrip-carriers.js'
import { RE_ABBR_DEF, RE_FOOTNOTE_DEF } from '../../parse.js'
import { normalizeRefLabel } from '../../label-key.js'

/** The elements a footnote definition body can be spelled as. */
const FOOTNOTE_DEFINITION_BLOCKS = new Set(['li', 'div', 'section', 'aside', 'p', 'td', 'blockquote'])
/**
 * The elements a per-footnote wrapper can be spelled as.
 *
 * Word wraps each definition in `<div style='mso-element:footnote' id=ftn1>`
 * and LibreOffice in `<div id="sdfootnote1">`, so the block holding the body
 * is one level above the paragraph the back-anchor sits in.
 */
const FOOTNOTE_WRAPPER_BLOCKS = new Set(['div', 'li', 'section', 'aside'])
const GENERATED_FOOTNOTE_REF_ID = /^fnref-?\d+(?:-\d+)?$/

export interface FootnoteStageContext {
  report: HtmlImportReportCollector
  attr(node: P5Node, name: string): string | undefined
  hasCarrier(node: P5Node, name: 'inline-footnote' | 'abbreviations' | 'footnote-label'): boolean
  carrierValue(node: P5Node, name: 'inline-footnote' | 'abbreviations' | 'footnote-label'): string | undefined
  blocks(nodes: P5Node[], path: string, depth: number): BlockNode[]
  flatText(node: P5Node): string
  invalidateSiblingIndex(node: P5Node): void
  indexIn(parent: P5Node, node: P5Node): number
}

/**
 * Word's downlevel-revealed conditionals, `<![if !supportFootnotes]>` and the
 * matching `<![endif]>`. They are NOT comments in the HTML grammar - a parser
 * following the spec reads `<!` without `--` as a bogus comment, and one
 * following libxml's lead hands them back as TEXT - so both spellings are
 * recognized as the separator's packaging (see isFootnoteChromeNode).
 */
const RE_DOWNLEVEL_CONDITIONAL = /^(<!\[if[^\]]*\]>|<!\[endif\]>)+$/i

/**
 * A footnote-reference candidate: the anchor, the definition block its
 * fragment resolves to, the fragment itself, and whether the pair is mutual.
 */
interface FootnoteCandidate {
  ref: P5Node
  block: P5Node
  fragment: string
  mutual: boolean
  marked?: boolean
  backlink?: boolean
}

/** One recognized note: its block and every reference bound to it. */
interface FootnoteDefinitionGroup {
  block: P5Node
  refs: P5Node[]
  fragments: string[]
}

type FootnoteAnchorIndex = Map<P5Node, Map<string, P5Node[]> | null>
type FootnoteAnchorRange = {
  nodes: P5Node[]
  positions: number[]
  tree?: Array<FootnoteCandidate | null>
  size?: number
}
type FootnoteTargetIndex = {
  root: P5Node
  elements: P5Node[]
  order: Map<P5Node, number>
  used: Set<string>
  counts?: Map<P5Node, number>
  ends?: Map<P5Node, number>
  nearestBlocks?: Map<P5Node, P5Node | null>
  inverseFirst?: Map<P5Node, Map<string, FootnoteCandidate | null>>
  anchorRanges?: Map<string, FootnoteAnchorRange>
  anchorRanks?: Map<P5Node, number>
}


export class FootnoteStage {
  /** Bodies authored at the reference site by `data-carve-inline-footnote`. */
  private readonly inlineFootnoteBodiesState = new Map<string, InlineNode[]>()
  /** Definitions supplied by the document-end `data-carve-abbreviations` template. */
  private readonly abbreviationDefsState = new Map<string, string>()
  private readonly detachedFootnoteBlocksState: Set<P5Node> = new Set()
  private footnotePlacementMarked = false
  get inlineFootnoteBodies(): ReadonlyMap<string, InlineNode[]> { return this.inlineFootnoteBodiesState }
  get abbreviationDefs(): ReadonlyMap<string, string> { return this.abbreviationDefsState }
  get detachedFootnoteBlocks(): ReadonlySet<P5Node> { return this.detachedFootnoteBlocksState }
  constructor(private readonly context: FootnoteStageContext) {}
  /**
   * Recognize footnote pairs, rewrite each reference site to a synthetic
   * reference element `inline()` reads as a `footnote_ref`, detach the note
   * blocks, and return their bodies keyed 1..N by document order.
   *
   * Labels are assigned 1..N over the notes in document order rather than
   * parsed out of the ids: an id is generated navigation an engine
   * regenerates, and `_ftn1` or `sdfootnote1sym` is not a label any Carve
   * source could carry anyway.
   *
   * `heuristic` is the word-processor adapters' license: with it the mutual
   * anchor pair alone binds. Without it (`generic` and the editor adapters)
   * only an anchor the producer MARKED with `role="doc-noteref"` opens a
   * pair - authored DPUB-ARIA semantics, which is what carve-php's core
   * policy reads under every adapter - so a role-less document imports
   * exactly as before.
   */
  adapterFootnotes(root: P5Node, heuristic: boolean): Record<string, BlockNode[]> | undefined {
    const elements = this.footnoteDocumentElements(root)
    const order = new Map<P5Node, number>()
    elements.forEach((element, index) => order.set(element, index))

    const targets = this.footnoteFragmentTargets(elements)
    const anchorIndex: FootnoteAnchorIndex = new Map()
    const targetsIndex: FootnoteTargetIndex = { root, elements, order, used: new Set() }
    const candidates = this.resolveFootnotePairDirection(
      this.footnotePairCandidates(elements, targets, heuristic, anchorIndex, targetsIndex),
      order,
      anchorIndex,
      targetsIndex,
    )
    if (candidates.length === 0) return undefined

    const definitions = this.attachRemainingFootnoteReferences(
      elements,
      this.groupFootnoteDefinitions(candidates, order, targetsIndex),
      heuristic,
    )

    const defs: Record<string, BlockNode[]> = {}
    const containers = new Set<P5Node>()

    /*
     * EVERY REFERENCE SITE IS REWRITTEN BEFORE ANY BODY IS CONVERTED
     * (markup-carve/carve-js#1380).
     *
     * These were one loop, so a note's body was converted while the reference
     * sites of every LATER note were still raw anchors. A note body that
     * references another note is exactly that case: note 1's body was
     * converted at index 0, and the anchor in it pointing at note 2 was not
     * replaced until index 1 - too late, so it imported as an ordinary link
     * and came out hand-spelled:
     *
     *     [^1]: see [{^2^}](#fn2){#fnref2 role=doc-noteref}
     *
     * The damage did not stop at the spelling. Nothing referenced `[^2]` any
     * more, so its definition never rendered and the word it held left the
     * document. The pairing was never in doubt - both notes are recognized
     * candidates - only the ORDER in which the two halves ran.
     */
    const carriers = this.footnoteCarriers(definitions)
    definitions.forEach((definition, index) => {
      const label = carriers[index]!.label
      if (index === 0) this.removeFootnoteSeparator(definition.block)

      const identities = definition.refs
        .map((reference) => this.footnoteAnchorIdentity(reference))
        .filter((identity) => identity !== '')
      this.stripFootnoteBacklinks(definition.block, identities, definition.fragments)

      for (const reference of definition.refs) {
        const site = this.footnoteReferenceSite(reference)
        // An id other than the generated `fnref{n}` / `fnref{n}-{k}` was authored
        // (PART 9 §16). A word processor's anchor ids are its own, never authored.
        const id = heuristic ? undefined : this.context.attr(reference, 'id')
        const sourceAttrs = heuristic && domTag(reference) !== 'sup'
          ? []
          : (domAttrs(domTag(reference) === 'sup' ? site : reference) ?? [])
        const referenceAttrs = sourceAttrs.flatMap((attr) => {
          const name = attr.name.toLowerCase()
          if (['id', 'href', 'role', 'data-footnote-ref'].includes(name) || RESERVED_CARRIER_ATTRIBUTES.has(name)) return []
          if (name !== 'class') return [attr]
          // HTML footnote producers use this class as a recognition marker.
          const classes = attr.value.split(/\s+/).filter(value => value && value !== 'footnote-ref')
          return classes.length ? [{ ...attr, value: classes.join(' ') }] : []
        })
        const replacement = defaultTreeAdapter.createElement(
          'carve-footnote-ref', p5html.NS.HTML, [
            { name: 'label', value: label },
            ...(id && !GENERATED_FOOTNOTE_REF_ID.test(id) ? [{ name: 'id', value: id }] : []),
            ...referenceAttrs,
          ],
        )
        replacement.parentNode = domParent(site) ?? null
        this.replaceP5Node(site, replacement)
      }
    })

    // Detached only after the conversion above has read every body, for the
    // same reason: a body detached early is a body another note cannot reach.
    definitions.forEach((definition, index) => {
      const block = definition.block
      const label = carriers[index]!.label
      const body = this.context.blocks(domChildren(block) ?? [], `footnote[${label}]`, 1)
      // §13a `data-carve-inline-footnote`: the endnote was authored at its
      // point of use. Only a SINGLE PARAGRAPH can go back there - `^[...]`
      // holds an inline run - so a richer body keeps the labelled form, which
      // renders the same endnote and loses only the spelling.
      setOwn(defs, label, body)
      // THE DEFINITION STAYS UNTIL THE WALK IS OVER. A note body converted
      // here can hold a reference to a LATER note, which is read before that
      // note's inline body is registered, so dropping the definition now lost
      // the nested note entirely. `pruneInlinedFootnotes` removes the ones
      // nothing refers to, once everything has been read.
      if (carriers[index]!.inline && body.length === 1 && body[0]!.type === 'paragraph') {
        this.inlineFootnoteBodiesState.set(label, (body[0] as { children: InlineNode[] }).children)
      }
      this.detachedFootnoteBlocksState.add(block)
      const parent = domParent(block)
      if (parent !== undefined) containers.add(parent)
    })
    this.detachP5Nodes(definitions.map(definition => definition.block))
    this.detachedFootnoteBlocksState.clear()

    // Keyed by identity, because every note in one list names the SAME
    // container: pruning it once per note walked that list's children once
    // per note, which is quadratic on a document that is mostly notes.
    this.pruneFootnoteContainers(containers)

    return defs
  }

  /**
   * Drop the definition of every endnote that came back as an INLINE footnote.
   *
   * An inline note carries its body at the point of use, so a definition
   * beside it would render the endnote twice. One that is still referenced by
   * a `footnote_ref` keeps its definition: a labelled note's body can hold a
   * reference to a note written inline elsewhere, and that reference is read
   * before the inline body is registered.
   */
  pruneInlinedFootnotes(defs: Record<string, BlockNode[]>, children: BlockNode[]): void {
    if (this.inlineFootnoteBodiesState.size === 0) return
    const referenced = new Set<string>()
    const visit = (node: unknown): void => {
      if (Array.isArray(node)) {
        for (const item of node) visit(item)
        return
      }
      if (typeof node !== 'object' || node === null) return
      const record = node as Record<string, unknown>
      if (record.type === 'footnote_ref' && typeof record.label === 'string') referenced.add(record.label)
      for (const value of Object.values(record)) if (typeof value === 'object') visit(value)
    }
    visit(children)
    visit(Object.values(defs))
    for (const label of this.inlineFootnoteBodiesState.keys()) {
      if (!referenced.has(label)) delete defs[label]
    }
  }

  /**
   * §13a `data-carve-abbreviations`: the `*[abbr]: expansion` lines the
   * document-end `<template>` carries.
   *
   * The definitions are what `<abbr title=…>` alone cannot say. Without them
   * an expanded abbreviation came back as `[HTML]{abbr="…"}` on every use -
   * the rendering is the same and the source is not, and a second use writes
   * the expansion a second time.
   *
   * A line that is not a definition is skipped rather than guessed at, and the
   * FIRST definition of an abbreviation wins, as a Carve source's would.
   */
  readAbbreviationCarrier(root: P5Node): void {
    // DOCUMENT LEVEL ONLY, which is where §13a places it: "the document's
    // abbreviation definitions" on a `<template>` at document end. A deeper
    // one can sit inside a subtree `roundtrip` mode preserves wholesale, and
    // reading it there both left the template in the raw bytes AND defined the
    // abbreviation for the whole document, so unrelated prose gained an
    // `<abbr>` the source never had.
    const stack: P5Node[] = [...(domChildren(root) ?? [])].reverse()
    while (stack.length > 0) {
      const node = stack.pop()!
      if (domTag(node) === 'template' && this.context.hasCarrier(node, 'abbreviations')) {
        const content = (node as unknown as { content?: P5Node }).content
        // EVERY line terminator, not just `\n`: a carriage return inside an
        // expansion is a line ending to the Carve parser, so leaving one in
        // let a definition carry a whole fenced raw block into the source.
        for (const line of this.context.flatText(content ?? node).split(/\r\n|[\n\r\u2028\u2029]/u)) {
          // The PARSER's own line shape, not a second spelling of it: a line
          // it would not read is not a definition, and writing one back would
          // put a visible paragraph into the document instead.
          const match = RE_ABBR_DEF.exec(line)
          if (!match) continue
          const abbr = match[1]!
          if (this.abbreviationDefsState.has(abbr)) continue
          this.abbreviationDefsState.set(abbr, match[2]!.replace(/[ \t]+$/, ''))
        }
        continue
      }
    }
  }

  /**
   * The label and the inline-note flag each endnote's §13a carriers ask for.
   *
   * `data-carve-footnote-label` restores the label the author wrote in place of
   * the assigned number, and `data-carve-inline-footnote` says the note was
   * written at its point of use. An endnote carrying BOTH is contradictory -
   * an inline note has no label and the writer never emits the pair - so
   * neither is read and the note keeps its number, reported rather than
   * guessed at.
   *
   * Invalid labels are reported and ignored before testing for a conflict.
   * A label another note already took falls back to the assigned number.
   */
  private footnoteCarriers(definitions: Array<{ block: P5Node; refs: P5Node[] }>): Array<{ label: string; inline: boolean }> {
    const read = definitions.map((definition) => {
      const carriedLabel = this.context.carrierValue(definition.block, 'footnote-label')
      // §13e validates values before testing for contradictory meanings.
      const label = carriedLabel !== undefined
        && !/[\r\n\u2028\u2029]/u.test(carriedLabel)
        && RE_FOOTNOTE_DEF.exec(`[^${carriedLabel}]: x`)?.[1] === carriedLabel
        ? carriedLabel
        : undefined
      if (carriedLabel !== undefined && label === undefined) {
        this.context.report.add(
          'attribute-dropped',
          'Dropped a footnote label outside the footnote label grammar',
          'warning',
          'footnote',
          definition.block,
        )
      }
      const inline = this.context.hasCarrier(definition.block, 'inline-footnote')
      if (label !== undefined && inline) {
        this.context.report.add(
          'attribute-dropped',
          'Dropped both footnote carriers on one endnote: a label and an inline note contradict each other',
          'warning',
          'footnote',
          definition.block,
        )
        return { label: undefined, inline: false }
      }
      // An inline note is written back where it is used, so one reference site
      // is the whole shape: two sites mean a label, which an inline note has
      // no room for.
      return { label, inline: inline && definition.refs.length === 1 }
    })
    // THE AUTHORED LABELS ARE ALLOCATED FIRST, then a number is found for each
    // note that needs one. Reserving every number up front rejected an
    // authored `[^2]` because the second note would have been numbered 2 -
    // even where no note ended up wearing that number.
    const taken = new Set<string>()
    const accepted = read.map((entry, index) => {
      if (entry.label === undefined) return undefined
      const key = normalizeRefLabel(entry.label)
      if (taken.has(key)) {
        this.context.report.add(
          'attribute-dropped',
          'Dropped a footnote label already used by another note',
          'warning',
          'footnote',
          definitions[index]!.block,
        )
        return undefined
      }
      taken.add(key)
      return entry.label
    })
    let next = 1
    return read.map((entry, index) => {
      const label = accepted[index]
      if (label !== undefined) return { label, inline: entry.inline }
      while (taken.has(String(next))) next += 1
      taken.add(String(next))
      return { label: String(next), inline: entry.inline }
    })
  }

  /**
   * Every element in the subtree, in document order.
   *
   * ITERATIVE, like every walk in this pass: it runs on EVERY import now
   * (the role reading is not adapter-gated), so a document nested past the
   * JS stack has to reach the depth counter's typed refusal rather than a
   * `RangeError` here - the same §25 rule the renderers follow.
   */
  private footnoteDocumentElements(root: P5Node): P5Node[] {
    const elements: P5Node[] = []
    const stack: P5Node[] = [root]
    while (stack.length > 0) {
      const node = stack.pop()!
      if (node !== root) elements.push(node)
      if (domTag(node) === 'code' || domTag(node) === 'pre') continue
      const children = domChildren(node) ?? []
      for (let i = children.length - 1; i >= 0; i--) {
        if (domTag(children[i]!) !== undefined) stack.push(children[i]!)
      }
    }
    return elements
  }

  /**
   * Map every same-document fragment name to the element it addresses.
   *
   * `id` first and `name` second, in two passes rather than one, so an `id`
   * always wins over the legacy `<a name>` form when both spell one fragment.
   */
  private footnoteFragmentTargets(elements: P5Node[]): Map<string, P5Node> {
    const targets = new Map<string, P5Node>()
    for (const element of elements) {
      const id = this.context.attr(element, 'id')
      if (id && !targets.has(id)) targets.set(id, element)
    }
    for (const element of elements) {
      if (domTag(element) !== 'a') continue
      const name = this.context.attr(element, 'name')
      if (name && !targets.has(name)) targets.set(name, element)
    }
    return targets
  }

  /**
   * Every anchor that could be a footnote reference, with the block it would
   * bind to. Under the heuristic a candidate needs the mutual back-link or an
   * explicit reference marker; outside it, ONLY the authored
   * `role="doc-noteref"` opens one - the vendor classes belong to the
   * heuristic, since a class is a styling hook where the role is a statement.
   * An anchor inside its own would-be note is never a candidate.
   */
  private footnotePairCandidates(
    elements: P5Node[],
    targets: Map<string, P5Node>,
    heuristic: boolean,
    anchorIndex: FootnoteAnchorIndex,
    targetsIndex: FootnoteTargetIndex,
  ): FootnoteCandidate[] {
    const anchors: Array<{ anchor: P5Node; fragment: string }> = []
    const used = targetsIndex.used
    for (const element of elements) {
      if (domTag(element) !== 'a') continue
      const href = this.context.attr(element, 'href') ?? ''
      if (!href.startsWith('#')) continue
      const fragment = href.slice(1)
      if (fragment === '' || !targets.has(fragment)) continue
      anchors.push({ anchor: element, fragment })
      used.add(fragment)
    }

    const bareSites: Array<{ reference: P5Node; target: P5Node; fragment: string }> = []
    for (const backlink of elements) {
      if (domTag(backlink) !== 'a' || this.context.attr(backlink, 'role') !== 'doc-backlink') continue
      const href = this.context.attr(backlink, 'href') ?? ''
      // An authored id can replace `fnref{n}` (PART 9 §16), so the target decides, not the spelling.
      if (!href.startsWith('#') || href.length < 2) continue
      const reference = targets.get(href.slice(1))
      if (reference === undefined || domTag(reference) !== 'sup') continue
      let target = domParent(backlink)
      while (target !== undefined && !this.context.attr(target, 'id')) target = domParent(target)
      if (target === undefined) continue
      let endnotes: P5Node | undefined = target
      while (endnotes !== undefined && !this.isEndnotesSection(endnotes)) endnotes = domParent(endnotes)
      if (endnotes === undefined) continue
      const fragment = this.context.attr(target, 'id')!
      used.add(fragment)
      bareSites.push({ reference, target, fragment })
    }
    const candidates: FootnoteCandidate[] = []
    // Register every bare target before counting notes under shared wrappers.
    for (const { reference, target, fragment } of bareSites) {
      const block = this.resolveFootnoteDefinitionBlock(target, targetsIndex)
      if (block === null || this.p5Contains(block, reference, targetsIndex)) continue
      candidates.push({ ref: reference, block, fragment, mutual: true })
    }
    for (const { anchor, fragment } of anchors) {
      if (!heuristic && !this.isExplicitFootnoteReference(anchor)) continue
      const block = this.resolveFootnoteDefinitionBlock(targets.get(fragment)!, targetsIndex)
      if (block === null || this.p5Contains(block, anchor, targetsIndex)) continue

      const identity = this.footnoteAnchorIdentity(anchor)
      const mutual = identity !== '' && this.footnoteHasAnchor(block, `#${identity}`, anchorIndex, targetsIndex)
      // A role-carrying anchor is marked, so outside the heuristic the role
      // is both the filter above and the confirmation here: the candidate
      // stands with or without a spelled back-link.
      if (!mutual && !this.isFootnoteReferenceMarked(anchor)) continue

      candidates.push({ ref: anchor, block, fragment, mutual })
    }
    return candidates
  }

  /**
   * The block a reference's target belongs to.
   *
   * The target itself when it is already a block (Pandoc's `<li id="fn1">`),
   * otherwise the nearest block ancestor of the anchor the fragment names.
   * Then ONE guarded climb, because Word and LibreOffice wrap each note in a
   * dedicated `<div id=...>` and the body can be several paragraphs inside
   * it: the climb only happens into a wrapper that carries an id and holds
   * exactly one referenced target, which is what keeps a shared container
   * (Google Docs' one trailing `<div>` around every note) from swallowing
   * its siblings. A fragment whose nearest block is the document root itself
   * is refused - taking it would move every block in the document into one
   * note - which here is the climb running off the fragment root.
   */
  private resolveFootnoteDefinitionBlock(target: P5Node, index: FootnoteTargetIndex): P5Node | null {
    let block = target
    let depth = 0
    while (true) {
      const tag = domTag(block)
      if (tag !== undefined && FOOTNOTE_DEFINITION_BLOCKS.has(tag)) break
      const parent = domParent(block)
      if (parent === undefined || domTag(parent) === undefined) return null
      block = parent
      if (++depth === 8) {
        if (index.nearestBlocks === undefined) {
          index.nearestBlocks = new Map()
          for (const element of index.elements) {
            const tag = domTag(element)
            index.nearestBlocks.set(element, tag !== undefined && FOOTNOTE_DEFINITION_BLOCKS.has(tag)
              ? element : index.nearestBlocks.get(domParent(element)!) ?? null)
          }
        }
        const nearest = index.nearestBlocks.get(block)
        if (nearest === undefined || nearest === null) return null
        block = nearest
        break
      }
    }

    const parent = domParent(block)
    const parentTag = domTag(parent)
    if (
      parent !== undefined &&
      parentTag !== undefined &&
      FOOTNOTE_WRAPPER_BLOCKS.has(parentTag) &&
      (this.context.attr(parent, 'id') ?? '') !== '' &&
      (index.counts ??= this.footnoteTargetCounts(index.elements, index.used)).get(parent) === 1
    ) {
      block = parent
    }
    return block
  }

  /** Count targets once, from children to parents, before adapter mutations. */
  private footnoteTargetCounts(elements: P5Node[], used: Set<string>): Map<P5Node, number> {
    const counts = new Map(elements.map(node => [node, Number(this.isFootnoteFragmentTarget(node, used))]))
    for (let i = elements.length - 1; i >= 0; i--) {
      const node = elements[i]!
      const parent = domParent(node)
      if (parent !== undefined && counts.has(parent)) {
        counts.set(parent, counts.get(parent)! + counts.get(node)!)
      }
    }
    return counts
  }

  private isFootnoteFragmentTarget(node: P5Node, used: Set<string>): boolean {
    const id = this.context.attr(node, 'id')
    if (id && used.has(id)) return true
    if (domTag(node) !== 'a') return false
    const name = this.context.attr(node, 'name')
    return name !== undefined && name !== '' && used.has(name)
  }

  /**
   * Keep one side of every mutually linked anchor pair.
   *
   * The pair is symmetric, so both directions produce a candidate and one of
   * them is the back-link reading as a reference. An explicit marker decides
   * where there is one; otherwise document order does, because a footnote
   * reference precedes the note it opens in every export shape measured.
   */
  private resolveFootnotePairDirection(
    candidates: FootnoteCandidate[],
    order: Map<P5Node, number>,
    anchorIndex: FootnoteAnchorIndex,
    targetsIndex: FootnoteTargetIndex,
  ): FootnoteCandidate[] {
    const byReference = new Map<P5Node, FootnoteCandidate>()
    for (const candidate of candidates) byReference.set(candidate.ref, candidate)

    return candidates.filter((candidate) => {
      const inverse = this.inverseFootnoteCandidate(byReference, candidate, anchorIndex, targetsIndex)
      return !(inverse !== null && this.footnoteReferenceSideWins(inverse, candidate, order))
    })
  }

  /**
   * The candidate that reads the same mutual pair from the other end.
   *
   * Found through the back anchor the candidate's own block holds rather than
   * by comparing every candidate with every other: a document with a thousand
   * notes made that scan a thousand times a thousand containment walks, and
   * the anchor names the inverse directly.
   */
  private inverseFootnoteCandidate(
    byReference: Map<P5Node, FootnoteCandidate>,
    candidate: FootnoteCandidate,
    anchorIndex: FootnoteAnchorIndex,
    targetsIndex: FootnoteTargetIndex,
  ): FootnoteCandidate | null {
    const identity = this.footnoteAnchorIdentity(candidate.ref)
    if (identity === '') return null

    const href = `#${identity}`
    const small = this.footnoteAnchorIndex(candidate.block, anchorIndex)
    if (small === null) {
      const inverse = this.firstFootnoteInverseInRange(candidate.block, href, byReference, targetsIndex)
      return inverse !== null && this.p5Contains(inverse.block, candidate.ref, targetsIndex) ? inverse : null
    }
    const anchors = small.get(href) ?? []
    let inverse: FootnoteCandidate | null | undefined
    let cached: Map<string, FootnoteCandidate | null> | undefined
    if (anchors.length >= 8) {
      targetsIndex.inverseFirst ??= new Map()
      cached = targetsIndex.inverseFirst.get(candidate.block)
      if (cached === undefined) targetsIndex.inverseFirst.set(candidate.block, cached = new Map<string, FootnoteCandidate | null>())
      inverse = cached.get(href)
    }
    if (inverse === undefined) {
      inverse = null
      for (const anchor of anchors) {
        const found = byReference.get(anchor)
        if (found !== undefined) {
          inverse = found
          break
        }
      }
      cached?.set(href, inverse)
    }
    // Equal hrefs resolve to the same block through the first fragment target.
    return inverse !== null && this.p5Contains(inverse.block, candidate.ref, targetsIndex) ? inverse : null
  }

  private footnoteReferenceSideWins(
    first: FootnoteCandidate,
    second: FootnoteCandidate,
    order: Map<P5Node, number>,
  ): boolean {
    const firstMarked = first.marked ??= this.isFootnoteReferenceMarked(first.ref)
    const secondMarked = second.marked ??= this.isFootnoteReferenceMarked(second.ref)
    if (firstMarked !== secondMarked) return firstMarked

    const firstBack = first.backlink ??= this.isFootnoteBacklinkMarked(first.ref)
    const secondBack = second.backlink ??= this.isFootnoteBacklinkMarked(second.ref)
    if (firstBack !== secondBack) return secondBack

    return (order.get(first.ref) ?? 0) < (order.get(second.ref) ?? 0)
  }

  /**
   * One entry per definition block, carrying every reference bound to it. A
   * block that contains another definition block is a container, not a note:
   * keeping both would move a subtree into two places at once. The next group in document order reveals whether a block contains a note.
   */
  private groupFootnoteDefinitions(
    candidates: FootnoteCandidate[],
    order: Map<P5Node, number>,
    targetsIndex: FootnoteTargetIndex,
  ): FootnoteDefinitionGroup[] {
    const groups = new Map<P5Node, FootnoteDefinitionGroup>()
    const fragments = new Map<P5Node, Set<string>>()
    for (const candidate of candidates) {
      let group = groups.get(candidate.block)
      if (group === undefined) {
        group = { block: candidate.block, refs: [], fragments: [] }
        groups.set(candidate.block, group)
      }
      group.refs.push(candidate.ref)
      if (group.fragments.length < 8) {
        if (!group.fragments.includes(candidate.fragment)) group.fragments.push(candidate.fragment)
      } else {
        let seen = fragments.get(candidate.block)
        if (seen === undefined) fragments.set(candidate.block, seen = new Set(group.fragments))
        if (!seen.has(candidate.fragment)) {
          seen.add(candidate.fragment)
          group.fragments.push(candidate.fragment)
        }
      }
    }

    const ordered = [...groups.values()].sort(
      (first, second) => (order.get(first.block) ?? 0) - (order.get(second.block) ?? 0),
    )
    // A containing group precedes its first contained group in preorder.
    return ordered.filter((group, index) => {
      const next = ordered[index + 1]
      return next === undefined || !this.p5Contains(group.block, next.block, targetsIndex)
    })
  }

  /**
   * Bind every remaining anchor that addresses a confirmed note.
   *
   * Once a block IS a footnote definition, an anchor pointing at it is a
   * reference to it whatever it looks like. This matters for the second and
   * later reference to one note: only one of them can be the back-link's
   * target, so the mutual pair that confirmed the note cannot confirm them,
   * and without this they stayed literal links beside a `[^1]`. An anchor
   * inside a note stays a link - a note's body may address another note.
   */
  private attachRemainingFootnoteReferences(
    elements: P5Node[],
    definitions: FootnoteDefinitionGroup[],
    heuristic: boolean,
  ): FootnoteDefinitionGroup[] {
    const byFragment = new Map<string, FootnoteDefinitionGroup>()
    const references = new Map<FootnoteDefinitionGroup, Set<P5Node>>()
    for (const definition of definitions) {
      for (const fragment of definition.fragments) byFragment.set(fragment, definition)
    }

    // Which elements sit inside a note, computed once: asking each anchor
    // whether it is inside any note walked the tree once per anchor and per
    // note, which is quadratic on a document that is mostly notes.
    const inside = new Set<P5Node>()
    const stack: P5Node[] = definitions.map((definition) => definition.block)
    while (stack.length > 0) {
      const node = stack.pop()!
      inside.add(node)
      for (const child of domChildren(node) ?? []) stack.push(child)
    }

    for (const element of elements) {
      if (domTag(element) !== 'a') continue
      // Outside the heuristic an unmarked anchor addressing a note is a LINK,
      // not a reference: the role is the whole signal, and a content link to
      // `#fn1` in a role-marked document keeps the author's shape. (The
      // marked candidates already sit in their groups; this loop exists for
      // the unmarked second reference the heuristic binds.)
      if (!heuristic && !this.isExplicitFootnoteReference(element)) continue
      const href = this.context.attr(element, 'href') ?? ''
      if (!href.startsWith('#')) continue
      const definition = byFragment.get(href.slice(1))
      if (definition === undefined || inside.has(element)) continue
      if (definition.refs.length < 8) {
        if (!definition.refs.includes(element)) definition.refs.push(element)
      } else {
        let seen = references.get(definition)
        if (seen === undefined) references.set(definition, seen = new Set(definition.refs))
        if (!seen.has(element)) {
          seen.add(element)
          definition.refs.push(element)
        }
      }
    }

    return definitions
  }

  private footnoteAnchorIdentity(anchor: P5Node): string {
    const id = this.context.attr(anchor, 'id')
    return id !== undefined && id !== '' ? id : this.context.attr(anchor, 'name') ?? ''
  }

  private footnoteAnchorIndex(block: P5Node, index: FootnoteAnchorIndex): Map<string, P5Node[]> | null {
    const held = index.get(block)
    if (held !== undefined) return held
    const anchors = new Map<string, P5Node[]>()
    const stack: P5Node[] = [block]
    let visited = 0
    while (stack.length > 0) {
      const current = stack.pop()!
      if (++visited > 64) {
        index.set(block, null)
        return null
      }
      const children = domChildren(current) ?? []
      for (let i = children.length - 1; i >= 0; i--) {
        const child = children[i]!
        if (domTag(child) === 'a') {
          const href = this.context.attr(child, 'href')
          if (href !== undefined) {
            const list = anchors.get(href)
            if (list === undefined) anchors.set(href, [child])
            else list.push(child)
          }
        }
        if (domTag(child) !== undefined) stack.push(child)
      }
    }
    index.set(block, anchors)
    return anchors
  }

  private footnoteHasAnchor(block: P5Node, href: string, anchors: FootnoteAnchorIndex, index: FootnoteTargetIndex): boolean {
    const small = this.footnoteAnchorIndex(block, anchors)
    if (small !== null) return small.has(href)
    const range = this.footnoteAnchorRange(href, index)
    if (range === undefined) return false
    const start = this.footnoteRangeBound(range.positions, index.order.get(block)!)
    return start < range.positions.length && range.positions[start]! <= this.footnoteSubtreeEnds(index).get(block)!
  }

  private footnoteAnchorRange(href: string, index: FootnoteTargetIndex): FootnoteAnchorRange | undefined {
    if (index.anchorRanges === undefined) {
      index.anchorRanges = new Map()
      index.anchorRanks = new Map(this.footnoteAnchorsUnder(index.root).map((node, rank) => [node, rank]))
      for (const node of index.elements) {
        if (domTag(node) !== 'a') continue
        const key = this.context.attr(node, 'href')
        if (key === undefined) continue
        let range = index.anchorRanges.get(key)
        if (range === undefined) index.anchorRanges.set(key, range = { nodes: [], positions: [] })
        range.nodes.push(node)
        range.positions.push(index.order.get(node)!)
      }
    }
    return index.anchorRanges.get(href)
  }

  private footnoteRangeBound(positions: number[], at: number): number {
    let lo = 0
    let hi = positions.length
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (positions[mid]! <= at) lo = mid + 1
      else hi = mid
    }
    return lo
  }

  private firstFootnoteInverseInRange(block: P5Node, href: string, candidates: Map<P5Node, FootnoteCandidate>, index: FootnoteTargetIndex): FootnoteCandidate | null {
    const range = this.footnoteAnchorRange(href, index)
    if (range === undefined) return null
    const earlier = (a: FootnoteCandidate | null, b: FootnoteCandidate | null): FootnoteCandidate | null => {
      if (a === null) return b
      if (b === null) return a
      return index.anchorRanks!.get(a.ref)! < index.anchorRanks!.get(b.ref)! ? a : b
    }
    if (range.tree === undefined) {
      let size = 1
      while (size < range.nodes.length) size *= 2
      const tree: Array<FootnoteCandidate | null> = new Array<FootnoteCandidate | null>(size * 2).fill(null)
      range.nodes.forEach((node, i) => { tree[size + i] = candidates.get(node) ?? null })
      for (let i = size - 1; i > 0; i--) tree[i] = earlier(tree[i * 2]!, tree[i * 2 + 1]!)
      range.tree = tree
      range.size = size
    }
    let lo = this.footnoteRangeBound(range.positions, index.order.get(block)!) + range.size!
    let hi = this.footnoteRangeBound(range.positions, this.footnoteSubtreeEnds(index).get(block)!) + range.size!
    let first: FootnoteCandidate | null = null
    while (lo < hi) {
      if (lo % 2 === 1) first = earlier(first, range.tree[lo++]!)
      if (hi % 2 === 1) first = earlier(first, range.tree[--hi]!)
      lo = Math.floor(lo / 2)
      hi = Math.floor(hi / 2)
    }
    return first
  }

  private footnoteAnchorsUnder(node: P5Node): P5Node[] {
    const anchors: P5Node[] = []
    const stack: P5Node[] = [node]
    while (stack.length > 0) {
      const current = stack.pop()!
      const children = domChildren(current) ?? []
      for (let i = children.length - 1; i >= 0; i--) {
        const child = children[i]!
        if (domTag(child) === 'a') anchors.push(child)
        if (domTag(child) !== undefined) stack.push(child)
      }
    }
    return anchors
  }

  /**
   * `footnoteRef` is Pandoc 1.x's spelling of `footnote-ref`, which it used
   * together with a back-link carrying no attributes at all.
   */
  private isEndnotesSection(node: P5Node): boolean {
    return domTag(node) === 'section' && (this.context.attr(node, 'role') === 'doc-endnotes' || this.context.attr(node, 'data-footnotes') !== undefined)
  }

  private isExplicitFootnoteReference(anchor: P5Node): boolean {
    return this.context.attr(anchor, 'role') === 'doc-noteref' || this.context.attr(anchor, 'data-footnote-ref') !== undefined
  }

  private isFootnoteReferenceMarked(anchor: P5Node): boolean {
    if (this.isExplicitFootnoteReference(anchor)) return true
    const classes = (this.context.attr(anchor, 'class') ?? '').split(/\s+/)
    return classes.includes('footnote-ref') || classes.includes('footnoteRef')
  }

  private isFootnoteBacklinkMarked(anchor: P5Node): boolean {
    if (this.context.attr(anchor, 'role') === 'doc-backlink' || this.context.attr(anchor, 'data-footnote-backref') !== undefined) return true
    return (this.context.attr(anchor, 'class') ?? '').split(/\s+/).includes('footnote-back')
  }

  private p5Contains(ancestor: P5Node, node: P5Node, index: FootnoteTargetIndex): boolean {
    let current = domParent(node)
    for (let depth = 0; current !== undefined && depth < 8; depth++) {
      if (current === ancestor) return true
      current = domParent(current)
    }
    if (current === undefined) return false
    const ends = this.footnoteSubtreeEnds(index)
    const start = index.order.get(ancestor)
    const at = index.order.get(node)
    return start !== undefined && at !== undefined && start < at && at <= ends.get(ancestor)!
  }

  private footnoteSubtreeEnds(index: FootnoteTargetIndex): Map<P5Node, number> {
    if (index.ends === undefined) {
      index.ends = new Map(index.order)
      for (let i = index.elements.length - 1; i >= 0; i--) {
        const element = index.elements[i]!
        const parent = domParent(element)
        if (parent !== undefined && index.ends.has(parent)) {
          index.ends.set(parent, Math.max(index.ends.get(parent)!, index.ends.get(element)!))
        }
      }
    }
    return index.ends
  }

  private detachP5Nodes(nodes: Iterable<P5Node>): void {
    const iterator = nodes[Symbol.iterator]()
    const first = iterator.next()
    if (first.done) return
    const second = iterator.next()
    if (second.done) {
      const parent = domParent(first.value)
      const children = domChildren(parent)
      if (parent === undefined || children === undefined) return
      const at = children.length < 8 ? children.findIndex(child => child === first.value) : this.context.indexIn(parent, first.value)
      if (at !== -1) children.splice(at, 1)
      return
    }
    const groups = new Map<P5Node, Set<P5Node>>()
    const add = (node: P5Node): void => {
      const parent = domParent(node)
      if (parent === undefined) return
      let removed = groups.get(parent)
      if (removed === undefined) groups.set(parent, removed = new Set())
      removed.add(node)
    }
    add(first.value)
    add(second.value)
    for (let next = iterator.next(); !next.done; next = iterator.next()) add(next.value)
    for (const [parent, removed] of groups) {
      const children = domChildren(parent)
      if (children === undefined) continue
      let write = 0
      for (const child of children) if (!removed.has(child)) children[write++] = child
      children.length = write
      this.context.invalidateSiblingIndex(parent)
    }
  }

  private replaceP5Node(node: P5Node, replacement: P5Node): void {
    const parent = domParent(node)
    const siblings = domChildren(parent)
    if (siblings === undefined) return
    const index = parent === undefined ? -1 : this.context.indexIn(parent, node)
    if (index !== -1) siblings[index] = domChild(replacement)
  }

  /**
   * Remove the rule that separates the notes from the body.
   *
   * Every producer measured emits one, and it is chrome rather than content:
   * Pandoc puts `<hr />` inside the section, Word `<br clear=all><hr ...>`
   * inside the footnote-list div, Google Docs a bare `<hr class="cN">` as a
   * sibling of the notes. Only the first two would be swept up by pruning an
   * emptied container, so the separator is looked for explicitly - at the
   * first note, and at each of its ancestors, taking only what immediately
   * precedes it.
   */
  private removeFootnoteSeparator(first: P5Node): void {
    let node = first
    while (true) {
      const parent = domParent(node)
      if (parent === undefined) return
      const siblings = domChildren(parent) ?? []
      const removed: P5Node[] = []
      let stopped = false
      for (let i = this.context.indexIn(parent, node) - 1; i >= 0; i--) {
        const previous = siblings[i]!
        if (this.isFootnoteChromeNode(previous)) continue
        if (domTag(previous) === 'hr' || domTag(previous) === 'br') removed.push(previous)
        else { stopped = true; break }
      }
      this.detachP5Nodes(removed)
      if (stopped || domTag(parent) === undefined) return
      node = parent
    }
  }

  /**
   * Whether a node is part of the separator's packaging rather than content.
   *
   * Word's downlevel-revealed conditionals bracket the `<br clear=all><hr>`
   * inside the footnote-list div. `<![if ...]>` is not a comment: a parser
   * following the HTML grammar (parse5 here) reads it as a BOGUS COMMENT
   * node, and libxml hands it back as TEXT, so both spellings are recognized
   * - without this the emptied container keeps content, survives pruning, and
   * imports as a paragraph that spells the conditional out.
   */
  private isFootnoteChromeNode(node: P5Node): boolean {
    if (/^h[1-6]$/.test(domTag(node) ?? '') && (this.context.attr(node, 'class') ?? '').split(/\s+/).includes('sr-only') && this.isEndnotesSection(domParent(node)!)) return true
    if (node.nodeName === '#comment') return true
    if (node.nodeName !== '#text') return false
    const text = (domValue(node) ?? '').trim()
    return text === '' || RE_DOWNLEVEL_CONDITIONAL.test(text)
  }

  /**
   * Remove the navigation an engine regenerates: the back-link, and the
   * marker anchor Word, Google Docs and LibreOffice put it on.
   *
   * Carried into the note body it would render as a stray link to a fragment
   * that no longer exists, and the visible marker it wraps (`[1]`, `1`, the
   * return arrow) would be written into the note's own text. The third clause
   * - an anchor that IS the fragment target the reference points at, with a
   * fragment href - is what removes the marker anchor that is the note's
   * anchor and its back-link and its visible marker in one element.
   */
  private stripFootnoteBacklinks(block: P5Node, identities: string[], fragments: string[]): void {
    const references = identities.length < 8 ? undefined : new Set(identities)
    const targets = fragments.length < 8 ? undefined : new Set(fragments)
    const parents = new Set<P5Node>()
    const anchors: P5Node[] = []
    for (const anchor of this.footnoteAnchorsUnder(block)) {
      const href = this.context.attr(anchor, 'href') ?? ''
      const pointsBack = href.startsWith('#') && (references?.has(href.slice(1)) ?? identities.includes(href.slice(1)))
      const isMarker = href.startsWith('#') && (targets?.has(this.footnoteAnchorIdentity(anchor)) ?? fragments.includes(this.footnoteAnchorIdentity(anchor)))
      if (!this.isFootnoteBacklinkMarked(anchor) && !pointsBack && !isMarker) continue
      anchors.push(anchor)
      const parent = domParent(anchor)
      if (parent !== undefined && (domTag(parent) === 'sup' || domTag(parent) === 'span')) parents.add(parent)
    }
    this.detachP5Nodes(anchors)
    if (parents.size === 0) return
    const empty = new Set<P5Node>()
    for (const parent of parents) {
      if (
        (domTag(parent) === 'sup' || domTag(parent) === 'span') &&
        !(domChildren(parent) ?? []).some(
          (child) => !empty.has(child) && (domTag(child) !== undefined || (child.nodeName === '#text' && (domValue(child) ?? '').trim() !== '')),
        )
      ) empty.add(parent)
    }
    this.detachP5Nodes(empty)
  }

  /**
   * The node a reference occupies: the anchor, or the `<sup>` that holds
   * nothing but the anchor.
   *
   * Google Docs and Pandoc put the `<sup>` outside the anchor, so replacing
   * only the anchor would leave `{^...^}` wrapped around the reference. One
   * carrying anything else - an element or non-blank text - keeps its
   * content, and the reference binds inside it.
   */
  private footnoteReferenceSite(reference: P5Node): P5Node {
    const parent = domParent(reference)
    if (parent === undefined || domTag(parent) !== 'sup') return reference
    for (const child of domChildren(parent) ?? []) {
      if (domTag(child) !== undefined && child !== reference) return reference
      if (child.nodeName === '#text' && (domValue(child) ?? '').trim() !== '') return reference
    }
    return parent
  }

  /**
   * Drop a container the notes left empty, so the `<hr>` and the `<ol>` that
   * held them do not import as a thematic break beside an empty list. A
   * separator written AFTER the notes survives the explicit search and is
   * swept up here instead.
   */
  private pruneFootnoteContainers(containers: Iterable<P5Node>): void {
    type View = {
      children: P5Node[]
      positions: Map<P5Node, number>
      following: number[]
      content: number
    }
    const views = new Map<P5Node, View>()
    const removed = new Set<P5Node>()
    const changed = new Set<P5Node>()
    let placement: { parent: P5Node; index: number; marker: P5Node } | undefined
    const packaging = (node: P5Node): boolean =>
      this.isFootnoteChromeNode(node) || domTag(node) === 'hr' || domTag(node) === 'br'
    const view = (node: P5Node): View => {
      let result = views.get(node)
      if (result !== undefined) return result
      const children = domChildren(node) ?? []
      const positions = new Map(children.map((child, index) => [child, index]))
      const following = new Array<number>(children.length + 1)
      following[children.length] = children.length
      let content = 0
      for (let i = children.length - 1; i >= 0; i--) {
        const child = children[i]!
        if (!removed.has(child) && !packaging(child)) content++
        following[i] = this.isFootnoteChromeNode(child) ? following[i + 1]! : i
      }
      result = { children, positions, following, content }
      views.set(node, result)
      return result
    }
    const contentFrom = (parent: P5Node, from: number): boolean => {
      const siblings = view(parent)
      const traversed: number[] = []
      let index = siblings.following[from] ?? siblings.children.length
      while (index < siblings.children.length && removed.has(siblings.children[index]!)) {
        traversed.push(index)
        index = siblings.following[index + 1]!
      }
      for (const at of traversed) siblings.following[at] = index
      siblings.following[from] = index
      return index < siblings.children.length
    }
    const contentFollows = (parent: P5Node, from: number): boolean => {
      let node = parent
      while (true) {
        if (contentFrom(node, from)) return true
        const up = domParent(node)
        if (up === undefined) return false
        const at = view(up).positions.get(node)
        if (at === undefined || removed.has(node)) return false
        node = up
        from = at + 1
      }
    }
    for (const container of containers) {
      let node: P5Node | undefined = container
      let slot: { parent: P5Node; index: number } | undefined
      while (node !== undefined && !removed.has(node) && domTag(node) !== undefined) {
        if (domTag(node) === 'body' || domTag(node) === 'html' || view(node).content !== 0) break
        const parent = domParent(node)
        if (parent === undefined) break
        const siblings = view(parent)
        const index = siblings.positions.get(node)
        if (index === undefined) break
        removed.add(node)
        if (!packaging(node)) siblings.content--
        changed.add(parent)
        slot = { parent, index }
        node = parent
      }
      if (slot !== undefined && !this.footnotePlacementMarked && contentFollows(slot.parent, slot.index)) {
        const marker = defaultTreeAdapter.createElement('carve-footnote-placement', p5html.NS.HTML, [])
        marker.parentNode = domContainer(slot.parent)
        placement = { ...slot, marker }
        view(slot.parent).content++
        changed.add(slot.parent)
        this.footnotePlacementMarked = true
      }
    }
    for (const parent of changed) {
      const children = view(parent).children
      const kept: P5Node[] = []
      for (let i = 0; i <= children.length; i++) {
        if (placement?.parent === parent && placement.index === i) kept.push(placement.marker)
        const child = children[i]
        if (child !== undefined && !removed.has(child)) kept.push(child)
      }
      children.length = 0
      for (const child of kept) children.push(child)
      this.context.invalidateSiblingIndex(parent)
    }
  }

}
