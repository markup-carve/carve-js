import { parseFragment, serializeOuter } from 'parse5'
import type {
  Attrs,
  BlockNode,
  DefinitionItem,
  Document,
  FigureGroup,
  InlineNode,
  List,
  TableBodyGroup,
  TableCell,
  TableRow,
  TableRowGroups,
} from './ast.js'
import { renderCarve } from './render-carve.js'

export type HtmlImportMode = 'safe' | 'semantic' | 'roundtrip'
export type HtmlImportAdapter =
  | 'generic'
  | 'tiptap'
  | 'prosemirror'
  | 'ckeditor'
  | 'tinymce'
  | 'word'
  | 'google-docs'

/**
 * The diagnostic codes, as the `code` enum of the published report schema
 * (`spec/resources/html-import-schema.json`) lists them.
 *
 * A runtime list rather than a hand-written union, because the union alone is
 * a constraint nothing can check: types are gone by the time a test runs, so
 * a code added here and not to the schema - or to the schema and not here -
 * diverged in silence. Deriving `HtmlImportDiagnosticCode` from this array
 * makes the two one thing, and a test then holds this array against the
 * schema's own enum.
 *
 * Not re-exported from `index.ts`: the package publishes the TYPE, and this
 * is the machinery the type is built from.
 */
export const HTML_IMPORT_DIAGNOSTIC_CODES = [
  'element-dropped',
  'element-unwrapped',
  'attribute-dropped',
  'style-unmapped',
  'table-degraded',
  'structure-unspellable',
  'raw-preserved',
  'encoding-assumed',
  'diagnostics-truncated',
] as const

export type HtmlImportDiagnosticCode = (typeof HTML_IMPORT_DIAGNOSTIC_CODES)[number]

export interface HtmlImportDiagnostic {
  code: HtmlImportDiagnosticCode
  message: string
  severity: 'info' | 'warning' | 'error'
  path?: string
  line?: number
  column?: number
}

export interface HtmlImportOptions {
  mode?: HtmlImportMode
  adapter?: HtmlImportAdapter
  maxDepth?: number
  maxNodes?: number
  maxDiagnostics?: number
}

export interface HtmlImportResult<T> {
  value: T
  report: {
    mode: HtmlImportMode
    adapter: HtmlImportAdapter
    diagnostics: HtmlImportDiagnostic[]
  }
}

export class HtmlImportLimitError extends Error {
  constructor(public readonly limit: 'depth' | 'nodes' | 'diagnostics') {
    super(`HTML import ${limit} limit exceeded`)
    this.name = 'HtmlImportLimitError'
  }
}

interface P5Node {
  nodeName: string
  tagName?: string
  value?: string
  attrs?: Array<{ name: string; value: string }>
  childNodes?: P5Node[]
  parentNode?: P5Node
}

const ACTIVE = new Set(['script', 'style', 'template', 'noscript'])
const BLOCK = new Set([
  'address', 'article', 'aside', 'blockquote', 'details', 'div', 'dl', 'fieldset',
  'figure', 'footer', 'form', 'header', 'hgroup', 'main', 'nav', 'ol', 'p', 'pre',
  'section', 'table', 'ul', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr',
])
const ADAPTERS = new Set<HtmlImportAdapter>([
  'generic', 'tiptap', 'prosemirror', 'ckeditor', 'tinymce', 'word', 'google-docs',
])

/**
 * The import adapters whose input can carry footnote-shaped HTML.
 *
 * Word and Google Docs are the two the portable adapter list names for
 * word-processor exports, and the recognition below is shape-driven, so the
 * same pass reads LibreOffice's and pre-3.x Pandoc's spellings too. `generic`
 * deliberately stays out: it takes arbitrary HTML, where a mutually linked
 * anchor pair is not proof of a footnote, and the caller naming an adapter is
 * the declaration of provenance that makes the recognition safe.
 */
const FOOTNOTE_SHAPED_ADAPTERS = new Set<HtmlImportAdapter>(['word', 'google-docs'])

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
}

/** One recognized note: its block and every reference bound to it. */
interface FootnoteDefinitionGroup {
  block: P5Node
  refs: P5Node[]
  fragments: string[]
}

/**
 * The elements PART 9 §9 and §10 spell as an attribute on a span, so the
 * importer writes `[Tab]{kbd}` rather than unwrapping to `Tab` (carve#1140).
 *
 * Mirrors EXTENDED_SEMANTIC_SPAN_ORDER in render-html.ts.
 *
 * `mark` and `code` are not here, and their ABSENCE is not what keeps them out:
 * `inline()` maps each of them a few lines before it consults this set, so
 * adding either name changes no output at all. The rule they follow - the tier
 * split retired them from the registry and each already has its own syntax
 * (`=m=`, a code span), so importing them here as well would give one input two
 * spellings - is enforced by those earlier branches, and that is what a test
 * has to move to fail. Stated here because the comment that used to sit in this
 * spot claimed the membership was the guarantee, and a mutation that added both
 * names passed every test.
 *
 * A Set rather than an object literal, because `constructor` and `toString` are
 * tag names a fragment may carry.
 */
const SEMANTIC_SPAN_TAGS = new Set(['abbr', 'time', 'samp', 'var', 'kbd', 'cite', 'dfn'])

/**
 * Where each name's VALUE comes from in the HTML. The rest are value-less and
 * import as the bare boolean attribute (PART 11 §6c), as does one of these
 * whose source attribute is absent.
 */
const SEMANTIC_SPAN_VALUE_SOURCE = new Map([['abbr', 'title'], ['dfn', 'title'], ['time', 'datetime']])

/**
 * The `<annotation>` encodings that DECLARE their payload to be TeX.
 *
 * Matched case-insensitively against the whole attribute value, never as a
 * substring: `MathType-MTEF` and `application/mathml-content` both contain
 * neither of these as a prefix, but a substring test for `tex` accepts the
 * first of them and hands a binary blob to the math node as if it were an
 * equation.
 */
const TEX_ANNOTATION_ENCODINGS = new Set(['application/x-tex', 'text/x-tex', 'latex'])

class Importer {
  readonly mode: HtmlImportMode
  readonly adapter: HtmlImportAdapter
  readonly diagnostics: HtmlImportDiagnostic[] = []
  /** Where the import built a structure only a serializer loses (§16). */
  private readonly unspellable: Array<{ path: string; message: string }> = []
  private nodes = 0
  /** How many `<q>` elements enclose the one being read, for the mark pair. */
  private quoteDepth = 0
  private readonly maxDepth: number
  private readonly maxNodes: number
  private readonly maxDiagnostics: number

  constructor(options: HtmlImportOptions) {
    this.mode = options.mode ?? 'safe'
    this.adapter = options.adapter ?? 'generic'
    if (!ADAPTERS.has(this.adapter)) throw new TypeError(`Unknown HTML import adapter: ${this.adapter}`)
    this.maxDepth = options.maxDepth ?? 128
    this.maxNodes = options.maxNodes ?? 1_000_000
    this.maxDiagnostics = options.maxDiagnostics ?? 1_000
  }

  import(html: string): Document {
    const fragment = parseFragment(html, { sourceCodeLocationInfo: true }) as unknown as P5Node
    // Rewrite an editor's footnote-shaped HTML before the core policy reads
    // the tree, exactly as the adapter contract allows ("Adapters may
    // normalize editor-specific markup before the core policy").
    const footnoteDefs = FOOTNOTE_SHAPED_ADAPTERS.has(this.adapter)
      ? this.adapterFootnotes(fragment)
      : undefined
    const children = this.blocks(fragment.childNodes ?? [], '', 0)
    const doc: Document = { type: 'document', children }
    if (footnoteDefs && Object.keys(footnoteDefs).length > 0) doc.footnoteDefs = footnoteDefs
    return doc
  }

  private enter(depth: number): void {
    if (depth > this.maxDepth) throw new HtmlImportLimitError('depth')
    if (++this.nodes > this.maxNodes) throw new HtmlImportLimitError('nodes')
  }

  private add(code: HtmlImportDiagnosticCode, message: string, severity: HtmlImportDiagnostic['severity'], path: string): void {
    if (this.diagnostics.length >= this.maxDiagnostics) throw new HtmlImportLimitError('diagnostics')
    this.diagnostics.push({ code, message, severity, path })
  }

  private attrs(node: P5Node, path: string): Attrs | undefined {
    const attrs: Attrs = {}
    const classes: string[] = []
    const keyValues: Record<string, string> = {}
    for (const attr of node.attrs ?? []) {
      const name = attr.name.toLowerCase()
      if (name.startsWith('on')) {
        this.add('attribute-dropped', `Dropped event-handler attribute ${name} on <${node.tagName}>`, 'warning', path)
      } else if (name === 'style') {
        this.styles(attr.value, keyValues, path)
      } else if (name === 'id') {
        attrs.id = attr.value
      } else if (name === 'class') {
        classes.push(...attr.value.split(/\s+/).filter(Boolean))
      } else if (name.startsWith('data-') && !['data-djot-src', 'data-carve-src'].includes(name)) {
        keyValues[name] = attr.value
      } else if (name === 'title' && node.tagName !== 'a' && node.tagName !== 'img') {
        keyValues.title = attr.value
      } else if (name === 'open' && node.tagName === 'details') {
        // The disclosure's own state, and the one attribute of a `<details>`
        // that means something after the import: `{open}` is PART 11 §6c's
        // bare boolean, which the details extension renders back onto the tag.
        keyValues.open = ''
      } else if (name === 'scope' && node.tagName === 'th') {
        // Kept here, and dropped again in `table()` when it matches the value
        // the renderer derives from position. `colgroup` and `rowgroup` have no
        // marker spelling and no positional derivation, so an authored one is
        // the only way to reach them and nothing can reconstruct it
        // (markup-carve/carve-js#1032).
        keyValues.scope = attr.value
      } else if (!this.isSemanticHtmlAttribute(node.tagName ?? '', name)) {
        this.add('attribute-dropped', `Dropped unsupported attribute ${name} on <${node.tagName}>`, 'info', path)
      }
    }
    if (classes.length) attrs.classes = classes
    if (Object.keys(keyValues).length) attrs.keyValues = keyValues
    return attrs.id || attrs.classes || attrs.keyValues ? attrs : undefined
  }

  private isSemanticHtmlAttribute(tag: string, name: string): boolean {
    if (tag === 'a') return name === 'href'
    if (tag === 'img') return name === 'src' || name === 'alt'
    if (tag === 'ol') return name === 'start' || name === 'type'
    if (tag === 'input') return name === 'type' || name === 'checked'
    if (tag === 'td' || tag === 'th') return name === 'colspan' || name === 'rowspan'
    // `datetime` is the VALUE of the `time` span attribute, not an unsupported
    // extra: `semanticSpan()` reads it off the node and it survives the import,
    // so reporting it dropped here would be a diagnostic for a loss that no
    // longer happens. `title` needs no entry - `attrs()` already keeps it.
    if (tag === 'time') return name === 'datetime'
    // `alttext` and `display` are READ by `mathml()` and reach the math node,
    // so reporting them dropped would name a loss that does not happen.
    // `xmlns` is the MathML namespace declaration, which is what makes the
    // element MathML in the first place - it is consumed by having been
    // recognized, not discarded.
    if (tag === 'math') return name === 'alttext' || name === 'display' || name === 'xmlns'
    return false
  }

  private styles(value: string, keyValues: Record<string, string>, path: string): void {
    for (const declaration of value.split(';')) {
      const split = declaration.indexOf(':')
      if (split < 0) continue
      const property = declaration.slice(0, split).trim().toLowerCase()
      const val = declaration.slice(split + 1).trim().toLowerCase()
      if (!property) continue
      if (this.mode !== 'safe' && property === 'text-align' && ['left', 'right', 'center'].includes(val)) {
        keyValues.align = val
      } else {
        this.add('style-unmapped', `CSS declaration ${property} was not mapped`, 'info', path)
      }
    }
  }

  private attr(node: P5Node, name: string): string | undefined {
    return node.attrs?.find((a) => a.name.toLowerCase() === name)?.value
  }

  private childPath(parent: string, node: P5Node, index: number): string {
    const name = node.tagName ?? (node.nodeName === '#text' ? 'text()' : node.nodeName)
    return `${parent}/${name}[${index + 1}]`
  }

  /**
   * `paths` overrides the path a node is reported under, index-parallel to
   * `nodes`. One caller needs it: a `<dl>` collects the children that are
   * neither a term nor a definition and converts them AFTER the list, and
   * rebuilding their paths from the filtered array would renumber them - a
   * `<p>` reported as `/dl[1]/p[3]` on its way out would report its own
   * attribute losses under `/dl[1]/p[1]`, so one element spoke under two names.
   */
  private blocks(nodes: P5Node[], parentPath: string, depth: number, paths?: string[]): BlockNode[] {
    const out: BlockNode[] = []
    let inlineBuffer: P5Node[] = []
    const flush = (): void => {
      const children = this.inlines(inlineBuffer, parentPath, depth + 1)
      inlineBuffer = []
      if (this.visible(children)) out.push({ type: 'paragraph', children })
    }
    nodes.forEach((node, index) => {
      const path = paths?.[index] ?? this.childPath(parentPath, node, index)
      if (node.nodeName === '#text' && !(node.value ?? '').trim()) {
        if (inlineBuffer.length) inlineBuffer.push(node)
        return
      }
      if (!node.tagName || !BLOCK.has(node.tagName)) {
        inlineBuffer.push(node)
        return
      }
      flush()
      out.push(...this.block(node, path, depth + 1))
    })
    flush()
    return out
  }

  private block(node: P5Node, path: string, depth: number): BlockNode[] {
    this.enter(depth)
    const tag = node.tagName!
    if (ACTIVE.has(tag)) {
      this.add('element-dropped', `Dropped active <${tag}> element`, 'warning', path)
      return []
    }
    const attrs = this.attrs(node, path)
    if (/^h[1-6]$/.test(tag)) return [{ type: 'heading', level: Number(tag[1]) as 1 | 2 | 3 | 4 | 5 | 6, children: this.inlines(node.childNodes ?? [], path, depth + 1), ...(attrs ? { attrs } : {}) }]
    if (tag === 'p') return [{ type: 'paragraph', children: this.inlines(node.childNodes ?? [], path, depth + 1), ...(attrs ? { attrs } : {}) }]
    if (tag === 'blockquote') return [{ type: 'block_quote', children: this.blocks(node.childNodes ?? [], path, depth + 1), ...(attrs ? { attrs } : {}) }]
    if (tag === 'ul' || tag === 'ol') return [this.list(node, path, depth, tag === 'ol', attrs)]
    if (tag === 'dl') return this.definitionList(node, path, depth, attrs)
    if (tag === 'pre') {
      const code = node.childNodes?.find((n) => n.tagName === 'code')
      const source = code ?? node
      const className = this.attr(source, 'class') ?? ''
      const lang = className.split(/\s+/).find((c) => c.startsWith('language-'))?.slice(9)
      return [{ type: 'code_block', content: this.text(source), ...(lang ? { lang } : {}), ...(attrs ? { attrs } : {}) }]
    }
    if (tag === 'hr') return [{ type: 'thematic_break', ...(attrs ? { attrs } : {}) }]
    if (tag === 'table') return [this.table(node, path, depth, attrs)]
    if (tag === 'figure') return this.figure(node, path, depth, attrs)
    if (tag === 'details') return [this.disclosure(node, path, depth, attrs)]
    if (tag === 'div' || ['article', 'aside', 'footer', 'header', 'main', 'nav', 'section'].includes(tag)) {
      if (tag !== 'div') {
        this.add('element-unwrapped', `Unwrapped unsupported <${tag}> element`, 'info', path)
        this.reportUnwrappedAttributes(attrs, tag, path)
      }
      const children = this.blocks(node.childNodes ?? [], path, depth + 1)
      return tag === 'div' && attrs ? [{ type: 'div', children, attrs }] : children
    }
    // The four block tags with no mapping: `address`, `fieldset`, `form` and
    // `hgroup`. The EMBEDS do not reach here - none of them is in `BLOCK`, so
    // they take the inline arm of this same pair of answers, where the policy
    // that covers them is written down.
    if (this.mode === 'roundtrip') {
      this.add('raw-preserved', `Preserved unsupported <${tag}> element as raw HTML`, 'warning', path)
      return [{ type: 'raw_block', format: 'html', content: serializeOuter(node as never) }]
    }
    this.add('element-unwrapped', `Unwrapped unsupported <${tag}> element`, 'info', path)
    this.reportUnwrappedAttributes(attrs, tag, path)
    return this.blocks(node.childNodes ?? [], path, depth + 1)
  }

  private list(node: P5Node, path: string, depth: number, ordered: boolean, attrs?: Attrs): List {
    const listItems = (node.childNodes ?? []).filter((n) => n.tagName === 'li')
    const items = listItems.map((li, i) => {
      const liPath = `${path}/li[${i + 1}]`
      const input = li.childNodes?.find((n) => n.tagName === 'input' && this.attr(n, 'type') === 'checkbox')
      const liAttrs = this.attrs(li, liPath)
      return {
        type: 'list_item' as const,
        ...(input ? { checked: this.attr(input, 'checked') !== undefined } : {}),
        children: this.blocks((li.childNodes ?? []).filter((n) => n !== input), liPath, depth + 1),
        ...(liAttrs ? { attrs: liAttrs } : {}),
      }
    })
    // Tightness is decided by the ITEM SHAPE (ruled; corpus-convert 27/28): a
    // bare-text `<li>one</li>` is a tight item, a block-wrapped
    // `<li><p>one</p></li>` a loose one. Tight/loose is a property of the
    // LIST, so a mixed list has to pick a side, and it normalizes TIGHT: one
    // bare item is the author's word that the list is tight, while `<p>` is
    // what serializers wrap EVERYTHING in. Every list imported loose before
    // this, whatever the source spelled.
    const tight = listItems.some((li) =>
      (li.childNodes ?? []).some(
        (child) =>
          (child.tagName !== undefined &&
            !BLOCK.has(child.tagName) &&
            !(child.tagName === 'input' && this.attr(child, 'type') === 'checkbox')) ||
          (child.nodeName === '#text' && (child.value ?? '').trim() !== ''),
      ),
    )
    const start = this.listStart(node, path, ordered)
    return { type: 'list', ordered, tight, items, ...(start !== undefined && start !== 1 ? { start } : {}), ...this.olType(node, path, ordered, items.length, start ?? 1), ...(attrs ? { attrs } : {}) }
  }

  /**
   * `<dl>` -> `definition_list` (PART 9 §4.5).
   *
   * Without this branch the tag fell through to the unwrap arm, and `dt`/`dd`
   * are not block tags, so every term and every definition landed in the SAME
   * inline buffer: `<dl><dt>Term<dd>Definition</dl>` imported as the single
   * paragraph `TermDefinition`. Not a degraded list - no list at all, and not
   * even a space between the two texts.
   *
   * A run of `<dt>` opens an entry and the `<dd>` run after it belongs to that
   * entry, so `<dt>a<dt>b<dd>c` is one entry with two terms, exactly the shape
   * `:: a` / `:: b` / `:  c` parses to. The HTML5 `<div>` wrapper (allowed
   * around a name-value group since HTML 5.2, and what several editors emit)
   * carries no meaning of its own and is walked through transparently.
   *
   * Anything else directly inside the `<dl>` has no slot in the model. It is
   * kept, as blocks AFTER the list rather than dropped, and reported: moving it
   * changes the document order, which is a smaller loss than deleting it.
   *
   * Three shapes are valid HTML that Carve SOURCE cannot spell, so they are
   * built into the AST and reported by whoever writes (§16): a `<dd>` with no
   * `<dt>` before it, an EMPTY `<dt>` and an EMPTY `<dd>`. Each one writes a
   * line the parser reads as something else, and the tests assert what it
   * reads as rather than only that a diagnostic appeared.
   *
   * `block()` has already counted this node against `maxNodes`, so this walk
   * counts only the elements it visits itself.
   */
  private definitionList(node: P5Node, path: string, depth: number, attrs?: Attrs): BlockNode[] {
    const items: DefinitionItem[] = []
    const trailing: P5Node[] = []
    const trailingPaths: string[] = []
    let current: DefinitionItem | undefined
    const openEntry = (): DefinitionItem => {
      const entry: DefinitionItem = { terms: [], definitions: [] }
      items.push(entry)
      return entry
    }
    const visit = (children: P5Node[], parentPath: string, level: number): void => {
      children.forEach((child, index) => {
        const childPath = this.childPath(parentPath, child, index)
        if (child.nodeName === '#text' && !(child.value ?? '').trim()) return
        if (child.tagName === 'div') {
          this.enter(level)
          this.entryAttributes(child, childPath, 'div')
          // The wrapper IS the group boundary (HTML 5.2), so an entry never
          // spans two of them: without the reset a `<dd>` opening the second
          // wrapper attached to the first wrapper's term, which both merges two
          // groups and suppresses the no-term diagnostic it is owed.
          current = undefined
          visit(child.childNodes ?? [], childPath, level + 1)
          current = undefined
          return
        }
        if (child.tagName === 'dt') {
          this.enter(level)
          // A term after a definition starts the next entry; a term after a
          // term joins the one being opened.
          if (current === undefined || current.definitions.length > 0) current = openEntry()
          this.entryAttributes(child, childPath, 'dt')
          const term = this.inlines(child.childNodes ?? [], childPath, level + 1)
          if (!this.visible(term)) {
            this.unspellable.push({
              path: childPath,
              message: 'An empty <dt> has no Carve spelling; the bare `::` line re-reads as a paragraph',
            })
          }
          current.terms.push(term)
          return
        }
        if (child.tagName === 'dd') {
          this.enter(level)
          // A description with no term before it: kept in the AST, where it is
          // a description of nothing, and reported when a WRITER has to spell
          // it, because `:  text` alone re-reads as a paragraph.
          if (current === undefined) {
            current = openEntry()
            this.unspellable.push({
              path: childPath,
              message: 'A <dd> with no <dt> before it has no Carve spelling; the definition line re-reads as a paragraph',
            })
          }
          this.entryAttributes(child, childPath, 'dd')
          const definition = this.blocks(child.childNodes ?? [], childPath, level + 1)
          if (this.writesNothing(definition)) {
            this.unspellable.push({
              path: childPath,
              message: 'A <dd> that writes nothing has no Carve spelling; the bare `:` line is read as more of the term above it',
            })
          }
          current.definitions.push(definition)
          return
        }
        this.add('element-unwrapped', `Moved <${child.tagName ?? child.nodeName}> content out of the <dl>: only <dt> and <dd> have a place in a definition list`, 'warning', childPath)
        trailing.push(child)
        trailingPaths.push(childPath)
      })
    }
    visit(node.childNodes ?? [], path, depth + 1)
    const list: BlockNode = { type: 'definition_list', items, ...(attrs ? { attrs } : {}) }
    return [...(items.length ? [list] : []), ...this.blocks(trailing, path, depth + 1, trailingPaths)]
  }

  /**
   * A `<dt>`, `<dd>` or group `<div>` carries attributes and the model has
   * nowhere to put them: PART 12 gives `definition_list` an `attrs` slot and
   * its ENTRIES none, so an `id` an anchor points at, a class a stylesheet
   * selects on and a `data-` pair an editor round-trips all end here. An
   * ordinary `<div>` keeps its attributes by becoming a `div` node; the wrapper
   * inside a `<dl>` cannot, because it is walked through.
   *
   * `attrs()` is still called for its diagnostics: it is where an event-handler
   * attribute is reported, and skipping the call made these three the only
   * places in the importer where active markup was dropped in silence.
   */
  private entryAttributes(node: P5Node, path: string, tag: 'dt' | 'dd' | 'div' | 'summary', noun?: string): void {
    const attrs = this.attrs(node, path)
    if (attrs === undefined) return
    const slot = noun ?? `a definition ${tag === 'dt' ? 'term' : tag === 'dd' ? 'description' : 'group'}`
    this.add('attribute-dropped', `Dropped ${this.attrNames(attrs).join(', ')} on <${tag}>: ${slot} has no attribute slot`, 'warning', path)
  }

  private attrNames(attrs: Attrs): string[] {
    return [
      ...(attrs.id ? ['id'] : []),
      ...(attrs.classes ? ['class'] : []),
      ...Object.keys(attrs.keyValues ?? {}),
    ]
  }

  /**
   * The attributes an UNWRAPPED element takes with it.
   *
   * `attrs()` reports the ones it cannot represent, and keeps the rest - an id
   * an anchor points at, a class a stylesheet selects on, a `data-` pair an
   * editor round-trips. When the element itself is then unwrapped there is
   * nothing left to hang them on, and they went in silence: a
   * `<video id="player">` reported that the element was unwrapped and never
   * that the id had gone with it.
   */
  private reportUnwrappedAttributes(attrs: Attrs | undefined, tag: string, path: string): void {
    if (attrs === undefined) return
    this.add('attribute-dropped', `Dropped ${this.attrNames(attrs).join(', ')} with the unwrapped <${tag}>: there is no element left to carry them`, 'warning', path)
  }

  /**
   * Whether a description's blocks reach the written source at all.
   *
   * An empty ARRAY is the obvious case, and it is not the only one: the two
   * further shapes measured against the writer are a paragraph with no visible
   * text (`<dd><p></p></dd>`) and a list with no items (`<dd><ul></ul></dd>`).
   * Both write a bare `:` line that the term above absorbs. Everything else
   * writes something the reparse keeps - an empty `<li>` comes back as `:  - +`
   * and an empty `<blockquote>` as `:  >`, which are descriptions, not losses.
   */
  private writesNothing(blocks: BlockNode[]): boolean {
    return blocks.every(
      (block) =>
        (block.type === 'paragraph' && !this.visible(block.children)) ||
        (block.type === 'list' && block.items.length === 0),
    )
  }

  /**
   * `<ol type>` -> `olType`, the marker alphabet the list counts in.
   *
   * The attribute was already exempt from the unsupported-attribute report, so
   * `<ol type="a">` looked like something the importer handled - and nothing
   * read it, so the list came back counting `1.` `2.` `3.` with no diagnostic
   * anywhere. HTML's five values map exactly onto Carve's four plus the
   * default: `1` IS the default and carries no field, so it is not a loss.
   *
   * A value that is none of the five is not HTML's, so nothing can be derived
   * from it and it is reported here rather than exempted into silence.
   *
   * The FIELD survives every time; the written MARKER does not, and the two
   * shapes where it does not are reported as serialization losses (§16) rather
   * than traded for a silently different list. Both were measured against the
   * writer and the parser over every start from 1 to 60 in each alphabet:
   *
   * - an alphabetic list starting past the 26th letter. Carve's grammar has no
   *   multi-letter alphabetic marker at all - `aa. x` is a paragraph - so the
   *   writer's marker wraps and the list restarts at `a`.
   * - a ONE-ITEM list whose only marker is a letter the other alphabet claims.
   *   A single `i` reads as the roman numeral and every other single letter as
   *   the alphabetic one, so alphabetic 9 and roman 5, 10, 50, 100, 500 and
   *   1000 come back as the other kind. A second item settles it - `v.` `vi.`
   *   is roman 5 - which is why the count is part of the question.
   */
  /**
   * `<ol start>` under HTML's own rules for parsing integers: optional sign,
   * then digits, within a signed 32-bit range. Anything else is not a number
   * the attribute defines and the default stands, which is what a browser does
   * with it too.
   *
   * `Number()` stood here and accepts what HTML does not: `2.9` opened a list
   * at 2.9 and `1e3` at 1000, both written back as their own marker, and `foo`
   * became NaN, which the writer spelled `NaN. x`. None of it was reported.
   */
  private listStart(node: P5Node, path: string, ordered: boolean): number | undefined {
    if (!ordered) return undefined
    const raw = this.attr(node, 'start')
    if (raw === undefined) return 1
    const value = Number(raw.trim())
    if (/^[+-]?\d+$/.test(raw.trim()) && Number.isSafeInteger(value) && value >= -2_147_483_648 && value <= 2_147_483_647) return value
    this.add('attribute-dropped', `Dropped start="${raw}" on <ol>: not an integer HTML defines, so the list starts where it would without it`, 'warning', path)
    return 1
  }

  private olType(node: P5Node, path: string, ordered: boolean, items: number, start: number): Record<string, never> | { olType: NonNullable<List['olType']> } {
    const value = ordered ? this.attr(node, 'type') : undefined
    if (value === undefined || value === '1') return {}
    if (value !== 'a' && value !== 'A' && value !== 'i' && value !== 'I') {
      this.add('attribute-dropped', `Dropped type="${value}" on <ol>: an ordered list counts in 1, a, A, i or I`, 'warning', path)
      return {}
    }
    const alphabetic = value === 'a' || value === 'A'
    // An alphabet counts from ONE. `start="0"` and a negative start are valid
    // HTML and there is no letter at those positions, so this is not a marker
    // the writer loses - it is a value the mapping has no image for, and the
    // list stays the decimal one it already was. Keeping the alphabet here
    // would be worse than the loss it reports: the writer derives its letter
    // arithmetically, so zero comes out as a BACKTICK and -3 as `]`, putting
    // characters in the document that can pair with a later one.
    if (start < 1) {
      this.add('attribute-dropped', `Dropped type="${value}" on <ol> with start="${start}": an alphabet has no letter before the first`, 'warning', path)
      return {}
    }
    // Roman notation ends at 3999. Past it the writer has no numeral and
    // repeats the thousands letter instead, so `start="1000000000"` is a
    // 40-byte input asking for a million characters PER ITEM - the kind of
    // amplification `maxNodes` and `maxDepth` are here to refuse. The LAST
    // item is the one to ask about, not the first: a list opened at 3999 and
    // run long crosses the same boundary from inside, and its output then
    // grows as the square of its length. The list keeps its decimal counting,
    // which spells any position in its own digits.
    const last = start + Math.max(items, 1) - 1
    if (!alphabetic && last > 3999) {
      this.add('attribute-dropped', `Dropped type="${value}" on <ol> reaching ${last}: roman notation has no numeral above 3999`, 'warning', path)
      return {}
    }
    if (alphabetic && start > 26) {
      this.unspellable.push({
        path,
        message: `An alphabetic list starting at ${start} has no Carve spelling; there is no multi-letter marker, so the written list restarts at the first letter`,
      })
    } else if (items === 1 && (alphabetic ? start === 9 : [5, 10, 50, 100, 500, 1000].includes(start))) {
      this.unspellable.push({
        path,
        message: `A one-item ${alphabetic ? 'alphabetic' : 'roman'} list starting at ${start} has no Carve spelling; its only marker is a letter the other alphabet claims, and nothing follows it to settle which`,
      })
    }
    return { olType: value }
  }

  /**
   * `<details>/<summary>` -> the `details` admonition (`::: details "Summary"`).
   *
   * It used to become a generic `div` carrying a `details` CLASS, and the
   * `<summary>` was not recognized at all: it unwrapped into the body, so the
   * label of the disclosure became its first paragraph and re-rendered inside
   * the box rather than on it. Nothing round-tripped - `<div class="details">`
   * is not a disclosure element, and a reader had no way back to one.
   *
   * The admonition is what the `details()` extension renders as a real
   * `<details>`, with the title as the `<summary>`, so the import lands on the
   * form Carve already has for this rather than on a container that resembles
   * it. A `<details>` with no `<summary>` keeps the extension's default label,
   * which is what the element itself does in a browser.
   */
  private disclosure(node: P5Node, path: string, depth: number, attrs?: Attrs): BlockNode {
    const children0 = node.childNodes ?? []
    const summaryIndex = children0.findIndex((n) => n.tagName === 'summary')
    const summary = summaryIndex < 0 ? undefined : children0[summaryIndex]
    // The paths stay the ones the elements arrived under. Filtering the summary
    // out renumbers everything after it, so a `<script>` at `/details[1]/
    // script[2]` would be reported at `script[1]` - and a summary that is not
    // first is not `summary[1]` either.
    const summaryPath = summary ? this.childPath(path, summary, summaryIndex) : ''
    const body: P5Node[] = []
    const bodyPaths: string[] = []
    children0.forEach((child, index) => {
      if (child === summary) return
      body.push(child)
      bodyPaths.push(this.childPath(path, child, index))
    })
    let title: InlineNode[] | undefined
    if (summary) {
      // The element itself, not only its children: an empty `<summary>` is a
      // DOM node the caller's `maxNodes` is counting, and reading straight past
      // it let a document process more nodes than the limit allows.
      this.enter(depth + 1)
      this.entryAttributes(summary, summaryPath, 'summary', 'a disclosure label')
      title = this.inlines(summary.childNodes ?? [], summaryPath, depth + 2)
    }
    const children = this.blocks(body, path, depth + 1, bodyPaths)
    if (title && this.visible(title) && !this.spellableTitle(title)) {
      // Kept as the body's first paragraph rather than as the title. This is
      // the one place the import degrades the TREE instead of recording a
      // writer loss, because the written form here is not a degraded document
      // but a destroyed one: an unspellable title makes the opening line
      // ordinary text, and the whole disclosure - body included - re-reads as
      // one paragraph. The label survives as a paragraph instead, which is
      // where it landed before this mapping existed anyway.
      this.add(
        'element-unwrapped',
        'Unwrapped a <summary> into the body: a disclosure title cannot spell a double quote or a line break, and writing one makes the whole block a paragraph',
        'warning',
        summaryPath,
      )
      return { type: 'admonition', kind: 'details', children: [{ type: 'paragraph', children: title }, ...children], ...(attrs ? { attrs } : {}) }
    }
    return {
      type: 'admonition',
      kind: 'details',
      ...(title && this.visible(title) ? { title } : {}),
      children,
      ...(attrs ? { attrs } : {}),
    }
  }

  /**
   * Whether the writer can put these inlines in the quoted title slot.
   *
   * The slot is delimited by `"` and the grammar gives it no escape, so a
   * double quote ends the title early and the opener stops being one. A line
   * break does the same thing for the same reason: the opener is a LINE.
   *
   * The question is asked of the WRITTEN form, not of the text nodes. A quote
   * reaches the title through more than its own text - an attribute VALUE is
   * written quoted, so `<span title='a"b'>hi</span>` is spelled
   * `[hi]{title="a\"b"}` and carries three of them - and enumerating the
   * spellings that can produce one is the kind of second copy of the grammar
   * that goes stale the next time a spelling is added. Rendering the inlines
   * asks the writer itself.
   */
  private spellableTitle(title: InlineNode[]): boolean {
    const written = renderCarve({ type: 'document', children: [{ type: 'paragraph', children: title }] })
    return !written.includes('"') && !written.trimEnd().includes('\n')
  }

  /**
   * A `colspan`/`rowspan` value, by HTML's rules: a non-negative integer,
   * clamped to the attribute's own maximum, defaulting when it is not one.
   *
   * The clamp is not decoration. Each unit of a span becomes a CELL below, so
   * an unclamped `colspan="1000000000"` is a 30-byte input asking for a billion
   * of them; the generated cells are charged to `maxNodes` on top of this, so
   * the two together bound what a table can cost.
   */
  private spanCount(cell: P5Node, name: 'colspan' | 'rowspan', max: number, min: number): number {
    const raw = this.attr(cell, name)
    if (raw === undefined) return 1
    const value = Number(raw.trim())
    if (!/^\d+$/.test(raw.trim()) || !Number.isSafeInteger(value)) return 1
    return Math.min(Math.max(value, min), max)
  }

  /**
   * The imported cells, laid out with the continuation cells Carve spells `^`
   * (this cell continues the one above) and `<` (it continues the one to its
   * left).
   *
   * The model already carried both - `table_cell.span` is in PART 12 and the
   * HTML renderer derives `rowspan`/`colspan` from a run of them - and the
   * import simply threw them away: a spanning cell was written as an ordinary
   * one and the row came up short, so `<td colspan="2">` produced a 1-cell row
   * under a 2-column header, with `table-degraded` as the only trace.
   *
   * The renderer resolves a continuation by POSITION IN THE ROW'S CELL ARRAY,
   * not by grid column - `^` attaches to the nearest row above whose cell at
   * the same index is not itself a continuation - so a carried span occupies
   * ONE array slot however many columns it covers, and the cells after it in
   * the row shift left by the rest. Placing the carried marks first and filling
   * the row's own cells around them is what keeps those indexes aligned.
   */
  private spanGrid(
    built: Array<Array<{ cell: TableCell; colspan: number; rowspan: number }>>,
    rowAttrs: Array<Attrs | undefined>,
    path: string,
    depth: number,
  ): TableRow[] {
    let carried: Array<{ index: number; rows: number }> = []
    const rows: TableRow[] = []
    built.forEach((sourceCells, r) => {
      const marks = new Set(carried.map((entry) => entry.index))
      const cells: TableCell[] = []
      const opened: Array<{ index: number; rows: number }> = []
      const continuation = (span: 'rowspan' | 'colspan', header: boolean): TableCell => {
        this.enter(depth)
        return { type: 'table_cell', header, span, children: [] }
      }
      const fillMarks = (): void => {
        while (marks.has(cells.length)) cells.push(continuation('rowspan', false))
      }
      for (const { cell, colspan, rowspan } of sourceCells) {
        fillMarks()
        const columns: number[] = [cells.length]
        cells.push(cell)
        for (let k = 1; k < colspan; k++) {
          fillMarks()
          columns.push(cells.length)
          cells.push(continuation('colspan', cell.header))
        }
        // A cell spanning BOTH ways carries a mark into EACH column it covers,
        // not one for its origin. The renderer resolves a `^` against the cell
        // at the same index above it, so a single mark left the next rowspan in
        // the row resolving against a column it does not own: the gap between
        // them was filled with a cell the source did not have, reported as an
        // invention, and rendered as a `<td>` the table does not have.
        if (rowspan > 1) for (const index of columns) opened.push({ index, rows: rowspan - 1 })
      }
      // A mark past the end of this row's own cells. Placing it still costs
      // nothing - it is a cell the span already owns - but a GAP before it does:
      // the index has to be kept, and an empty cell there is one the source did
      // not have. Only that invention is reported.
      const furthest = marks.size === 0 ? -1 : Math.max(...marks)
      let invented = false
      while (cells.length <= furthest) {
        if (marks.has(cells.length)) cells.push(continuation('rowspan', false))
        else {
          this.enter(depth)
          cells.push({ type: 'table_cell', header: false, children: [] })
          invented = true
        }
      }
      if (invented) {
        this.add('table-degraded', 'Filled a row that is shorter than the spans reaching into it, with a cell the source did not have', 'warning', `${path}/tr[${r + 1}]`)
      }
      rows.push({ type: 'table_row', cells, ...(rowAttrs[r] ? { attrs: rowAttrs[r] } : {}) })
      carried = [...carried.map((entry) => ({ ...entry, rows: entry.rows - 1 })).filter((entry) => entry.rows > 0), ...opened]
    })
    return rows
  }

  private table(node: P5Node, path: string, depth: number, attrs?: Attrs): BlockNode {
    /*
     * `<caption>` is a DIRECT child of the table and holds the table's own
     * caption, which `table.caption` has a slot for and Carve spells `^ text`
     * after the rows. The row walk below looks only for `tr`, so before this
     * the element was skipped and the caption left the document silently -
     * pandoc emits exactly this shape for every captioned table.
     */
    const captions = (node.childNodes ?? []).filter((n) => n.tagName === 'caption')
    const captionNode = captions[0]
    // The PARSER keeps the first `^ ` line and reads the second as a paragraph,
    // so a table that arrives with two captions loses one either way. Reported
    // rather than dropped in silence, and the same rule as the parser's, so the
    // import and a re-read of its own output agree on which one survives.
    for (const extra of captions.slice(1)) {
      this.add(
        'table-degraded',
        'Dropped a second <caption>: a table has one caption, and the first one wins',
        'warning',
        this.childPath(path, extra, (node.childNodes ?? []).indexOf(extra)),
      )
    }
    /*
     * `<colgroup>` has nowhere to land at all. Carve has no column model, and
     * whether it should get one is a language question (carve#1092) rather than
     * this importer's to answer - but the drop can say so meanwhile, and the
     * walk below said nothing: it looks for `tr`, descends through the element
     * and finds none.
     *
     * Only `<colgroup>` is scanned for. "In table" insertion mode answers a
     * `col` start tag by inserting an implied `<colgroup>` first, so
     * `<table><col span="2"><col>` arrives as one wrapper holding both and a
     * `<col>` is never a direct child of a `<table>` after parsing. A `col` arm
     * here could match nothing on any input - the check that cannot fail
     * (carve#755) - so the shape is pinned by a test instead.
     */
    ;(node.childNodes ?? []).forEach((child, index) => {
      if (child.tagName !== 'colgroup') return
      this.add(
        'element-dropped',
        "Dropped <colgroup>: Carve has no column model, and a table's columns are only the cells its rows carry",
        'warning',
        this.childPath(path, child, index),
      )
    })
    const tr: P5Node[] = []
    const group = new Map<P5Node, P5Node>()
    // The sections in document order, collected on the way through rather than
    // read back off the rows: a section with NO rows is one of the table's
    // sections too, and deriving the list from the rows left its attributes
    // unread and unreported.
    const sectionNodes: P5Node[] = []
    const walk = (n: P5Node, section?: P5Node): void => {
      if (n.tagName === 'tr') {
        tr.push(n)
        if (section) group.set(n, section)
        return
      }
      const isSection = ['thead', 'tbody', 'tfoot'].includes(n.tagName ?? '')
      if (isSection) sectionNodes.push(n)
      for (const child of n.childNodes ?? []) walk(child, isSection ? n : section)
    }
    walk(node)
    // The attributes of the SECTIONS, read once and in document order. Only a
    // `<tbody>` has a slot for them - the body group `rowGroups` states - so
    // `rowGroups` takes what it places out of this map and whatever is left is
    // reported. Nothing read them before: a `<tbody id="totals">` fell into the
    // empty `attrs` slot with no diagnostic at all (carve#1210).
    const sectionAttrs = new Map<P5Node, { attrs: Attrs; path: string }>()
    for (const section of sectionNodes) {
      const sectionPath = this.childPath(path, section, (node.childNodes ?? []).indexOf(section))
      const sectionOwn = this.attrs(section, sectionPath)
      if (sectionOwn) sectionAttrs.set(section, { attrs: sectionOwn, path: sectionPath })
    }
    // The leading run of all-header rows is what PART 10 §T9 gives `scope="col"`;
    // a header cell below it gets `scope="row"`. Computed over the rows rather
    // than per cell, because the run ENDS at the first row carrying a `td` and
    // a cell cannot see that on its own.
    const headerCells = (row: P5Node): P5Node[] =>
      (row.childNodes ?? []).filter((n) => n.tagName === 'td' || n.tagName === 'th')
    let leadingHeaderRows = 0
    for (const row of tr) {
      const cells = headerCells(row)
      if (cells.length === 0 || !cells.every((n) => n.tagName === 'th')) break
      leadingHeaderRows += 1
    }

    // How many rows are left in each row's own group, INCLUDING it. Computed
    // once: asking per cell meant scanning the whole table for each one, which
    // is quadratic in the row count and showed as 3000 rows in 299 ms against
    // 6000 in 852 ms.
    const remainingInGroup = new Map<P5Node, number>()
    const groupTotals = new Map<P5Node | undefined, number>()
    for (const row of tr) groupTotals.set(group.get(row), (groupTotals.get(group.get(row)) ?? 0) + 1)
    const groupSeen = new Map<P5Node | undefined, number>()
    for (const row of tr) {
      const section = group.get(row)
      const index = groupSeen.get(section) ?? 0
      groupSeen.set(section, index + 1)
      remainingInGroup.set(row, (groupTotals.get(section) ?? 1) - index)
    }

    const built: Array<Array<{ cell: TableCell; colspan: number; rowspan: number }>> = tr.map((row, r) =>
      (row.childNodes ?? []).filter((n) => n.tagName === 'td' || n.tagName === 'th').map((cell, c) => {
        const cellPath = `${path}/tr[${r + 1}]/${cell.tagName}[${c + 1}]`
        const colspan = this.spanCount(cell, 'colspan', 1000, 1)
        // A rowspan stops at its ROW GROUP in HTML, and `rowspan="0"` means
        // exactly "to the end of it". Both are resolved against the group the
        // row is actually in, so a `<tfoot>` below the body is not swallowed by
        // a cell the layout stops at the body's last row - not only the `0`
        // form, which was the half this handled first.
        const declaredRowspan = this.spanCount(cell, 'rowspan', 65534, 0)
        const left = remainingInGroup.get(row) ?? 1
        let rowspan = declaredRowspan === 0 ? left : Math.min(declaredRowspan, left)
        // And it stops at the head the RENDERER will synthesize. Carve derives
        // the head from the leading run of all-header rows, so a span reaching
        // out of that run lands in a `<thead>` with its other rows in the
        // `<tbody>` - which browsers clip, making the written table say
        // something the source table did not. Clipped here instead, where it
        // can be reported: the alternative is a document that claims a grid it
        // does not render.
        if (r < leadingHeaderRows && r + rowspan > leadingHeaderRows) {
          this.add(
            'table-degraded',
            'Clipped a rowspan at the header rows: Carve derives the head from the leading header rows, and a span leaving them crosses a boundary browsers clip anyway',
            'warning',
            cellPath,
          )
          rowspan = leadingHeaderRows - r
        }
        const cellAttrs = this.attrs(cell, cellPath)
        // A `scope` the renderer would regenerate from position is the
        // generator's own output, not something the author typed: importing it
        // writes it back as if they had. Only a value position cannot explain
        // survives.
        const scope = cellAttrs?.keyValues?.scope
        if (scope !== undefined) {
          const positional = r < leadingHeaderRows ? 'col' : 'row'
          // Only the POSITIONAL value goes. Every other one is kept wherever
          // the cell sits, including below the header rows: `header_cell` has
          // an attribute slot now, after its markers (§5 T10), so such a cell
          // is spelled `|={scope=rowgroup}A|` and re-reads as the header cell
          // it was. It used to be dropped and reported, because the only shape
          // available then was `|{scope=…}=A|` - a DATA cell whose content is
          // the literal `=A` - and keeping the value there traded a header cell
          // for an attribute.
          if (scope === positional) {
            delete cellAttrs!.keyValues!.scope
            if (Object.keys(cellAttrs!.keyValues!).length === 0) delete cellAttrs!.keyValues
          }
        }
        const kept = cellAttrs && (cellAttrs.id || cellAttrs.classes || cellAttrs.keyValues) ? cellAttrs : undefined
        return {
          cell: { type: 'table_cell' as const, header: cell.tagName === 'th', children: this.inlines(cell.childNodes ?? [], cellPath, depth + 1), ...(kept ? { attrs: kept } : {}) },
          colspan,
          rowspan,
        }
      }),
    )
    // A `<tr>`'s own attributes have a slot - `table_row.attrs`, which the
    // writer spells on the closing pipe and every renderer emits on the `<tr>`
    // - and went in silence before this.
    const rowAttrs = tr.map((row, r) => this.attrs(row, `${path}/tr[${r + 1}]`))
    const rows = this.spanGrid(built, rowAttrs, path, depth)
    const rowGroups = this.rowGroups(tr, rows, group, leadingHeaderRows, path, sectionAttrs)
    // Whatever `rowGroups` did not place. A `<thead>` and a `<tfoot>` have no
    // slot at all - the field states the head and foot as COUNTS - and a
    // `<tbody>`'s attributes reach nothing when the field itself is not kept.
    const sectionsWithRows = new Set(tr.map((row) => group.get(row)))
    for (const [section, own] of sectionAttrs) {
      const tag = section.tagName ?? 'tbody'
      // A body group IS the run of rows it consumes, so a section with none is
      // not a group and has nowhere to put them. Stating it as a zero-count
      // group would put a body in the partition that describes no rows.
      const reason = tag !== 'tbody'
        ? `a table's ${tag === 'thead' ? 'head' : 'foot'} is stated as a row count and has no attribute slot`
        : sectionsWithRows.has(section)
          ? 'the row grouping this body belongs to was not kept, and nothing else holds it'
          : 'a body group is the rows it consumes, and this one has none'
      this.add('attribute-dropped', `Dropped ${this.attrNames(own.attrs).join(', ')} on <${tag}>: ${reason}`, 'warning', own.path)
    }
    const caption = captionNode
      ? this.inlines(captionNode.childNodes ?? [], `${path}/caption[1]`, depth + 1)
      : undefined
    return { type: 'table', rows, ...(rowGroups ? { rowGroups } : {}), ...(caption ? { caption } : {}), ...(attrs ? { attrs } : {}) }
  }

  /**
   * `<thead>/<tbody>/<tfoot>` -> `table.rowGroups`, when the partition says
   * something a reader cannot derive (carve#1210 D1, ruled as (b)).
   *
   * Every renderer already derives a structure from the rows alone: the leading
   * run of all-header rows is the head, everything after it is one body, there
   * is no foot and there are no row-head columns. A `<thead>` over a `<tbody>`
   * is exactly that, so emitting the field for it would put structure into
   * every imported table that the source form cannot spell and hand-written
   * Carve never carries - which is what (a) was and what (b) rejects.
   *
   * So it is emitted only where the two DISAGREE: a `<tfoot>`, a second
   * `<tbody>`, a body with its own intermediate header rows, a body with
   * row-head columns, or a `<thead>` whose rows are not all header cells (Word
   * and pandoc both emit `<thead><tr><td>`), where the derived head is empty
   * and the stated one is not.
   *
   * A `<tbody>`'s own attributes are one of those disagreements: the derived
   * structure has no way to say them, so a body carrying any is not derivable
   * and the field is emitted to hold them in the body group's `attrs`. Only a
   * BODY has that slot - the head and the foot are stated as counts - so a
   * `<thead>` or `<tfoot>` that carries attributes is reported by the caller,
   * along with a `<tbody>` whose group was dropped for another reason.
   *
   * The counts are not checked against `rows.length` here. They are built from
   * the same row list the rows are built from, so a check at this point cannot
   * fail; PART 12 §15's MUST is enforced where a payload arrives from
   * elsewhere, in `fromAstJson`.
   */
  private rowGroups(
    tr: P5Node[],
    rows: TableRow[],
    group: Map<P5Node, P5Node>,
    leadingHeaderRows: number,
    path: string,
    sectionAttrs: Map<P5Node, { attrs: Attrs; path: string }>,
  ): TableRowGroups | undefined {
    if (tr.length === 0) return undefined
    const sectionOf = (row: P5Node): string => group.get(row)?.tagName ?? 'tbody'
    const isHeaderRow = (row: P5Node): boolean => {
      const cells = (row.childNodes ?? []).filter((n) => n.tagName === 'td' || n.tagName === 'th')
      return cells.length > 0 && cells.every((n) => n.tagName === 'th')
    }
    // The head is a PREFIX of `rows` and the foot a SUFFIX, which is what the
    // field can express. A `<thead>` that is not first, or a `<tfoot>` with
    // rows after it, is a table this cannot describe.
    const sections = tr.map(sectionOf)
    const headRows = sections.findIndex((name) => name !== 'thead') === -1 ? tr.length : sections.findIndex((name) => name !== 'thead')
    let footRows = 0
    while (footRows < tr.length - headRows && sections[tr.length - 1 - footRows] === 'tfoot') footRows += 1
    const middle = tr.slice(headRows, tr.length - footRows)
    if (middle.some((row) => sectionOf(row) === 'thead' || sectionOf(row) === 'tfoot')) {
      this.add(
        'table-degraded',
        'Dropped the row grouping of a table whose <thead> or <tfoot> is not at the edge of its rows: the head is a prefix of the rows and the foot a suffix',
        'warning',
        path,
      )
      return undefined
    }

    const bodies: TableBodyGroup[] = []
    let index = 0
    while (index < middle.length) {
      const section = group.get(middle[index]!)
      const groupRows: P5Node[] = []
      while (index < middle.length && group.get(middle[index]!) === section) groupRows.push(middle[index++]!)
      let groupHead = 0
      while (groupHead < groupRows.length && isHeaderRow(groupRows[groupHead]!)) groupHead += 1
      // A group whose rows are ALL header rows is an intermediate header with
      // nothing under it, which is what the counts say and not something to
      // reinterpret.
      const first = tr.indexOf(groupRows[groupHead] ?? groupRows[0]!)
      const rowHeadColumns = groupHead < groupRows.length
        ? this.rowHeadColumns(rows.slice(first, first + groupRows.length - groupHead), rows, first)
        : 0
      // The `<tbody>`'s own attributes: the body group is where the exchanged
      // model puts them, and it is the only section with a slot.
      const own = section ? sectionAttrs.get(section) : undefined
      bodies.push({ headRows: groupHead, bodyRows: groupRows.length - groupHead, ...(rowHeadColumns > 0 ? { rowHeadColumns } : {}), ...(own ? { attrs: own.attrs } : {}) })
      // Claimed here rather than after the return below, because a body
      // carrying attributes is never DERIVABLE - that is what the clause on
      // `derivable` says - so the field is returned whenever one was claimed,
      // and the only return that skips this point is the one before the loop.
      // A deferral for it was here and no mutation of it could change an
      // output.
      if (section && own) sectionAttrs.delete(section)
    }

    // No `<thead>` at all: the leading run of header rows is what every renderer
    // reads as the head, so it is counted as one here too. Without this, the
    // ORDINARY table - a header row and some data rows, with only the implicit
    // `<tbody>` the HTML parser inserts - came out with an intermediate header
    // and no head, which is a different statement about the same table and puts
    // the field on nearly every document. That is exactly what (b) rejects.
    let headRows2 = headRows
    // ONE body only. With a second one, the header-only first body is a
    // BOUNDARY the field exists to record, and absorbing it away left a single
    // ordinary body that the derivation reproduces - so the two bodies went
    // silently, which is the opposite of the point.
    if (headRows2 === 0 && bodies.length === 1 && leadingHeaderRows > 0) {
      const absorbed = Math.min(leadingHeaderRows, bodies[0]!.headRows)
      headRows2 = absorbed
      bodies[0] = { ...bodies[0]!, headRows: bodies[0]!.headRows - absorbed }
      // A group carrying attributes is not empty, whatever its counts say:
      // dropping it here would drop them with it.
      if (bodies[0]!.headRows === 0 && bodies[0]!.bodyRows === 0 && bodies[0]!.rowHeadColumns === undefined && bodies[0]!.attrs === undefined) bodies.shift()
    }

    const derivable =
      headRows2 === leadingHeaderRows &&
      footRows === 0 &&
      bodies.length <= 1 &&
      bodies.every((body) => body.headRows === 0 && (body.rowHeadColumns ?? 0) === 0 && body.attrs === undefined)
    if (derivable) return undefined
    // Carve SOURCE has no spelling for the field, so a writer loses it. The
    // AST keeps it and `htmlToCarve` reports it, which is the split §16 draws.
    this.unspellable.push({
      path,
      message: 'A table with an explicit head/body/foot grouping has no Carve spelling; the written table keeps only the structure a reader derives from its rows',
    })
    return { headRows: headRows2, bodies, footRows }
  }

  /**
   * Leading COLUMNS that are header cells in every row of the group.
   *
   * Counted over the expanded grid rather than over the source cells, because
   * columns and cells are not the same thing: `<th colspan="2">` is one element
   * and two columns, and a `<th rowspan="2">` leaves the row below it starting
   * with a data ELEMENT while a header still occupies the column. Both made the
   * count wrong in a table that carries them.
   *
   * A continuation resolves the way the renderer resolves it: `<` to the
   * nearest cell to its left that is not one, `^` to the nearest row above
   * whose cell at the same index is not itself a `^`.
   */
  private rowHeadColumns(groupRows: TableRow[], allRows: TableRow[], firstIndex: number): number {
    if (groupRows.length === 0) return 0
    const headerAt = (r: number, c: number): boolean => {
      const cell = allRows[r]?.cells[c]
      if (cell === undefined) return false
      // A `<` needs no resolution: `spanGrid` builds a colspan continuation
      // carrying its ORIGIN's header flag, so reading the flag off the
      // continuation gives the same answer as walking left to the origin. A
      // branch for it was here and no mutation of it could change an output.
      // A `^` is different - it is built with the flag cleared, because the
      // cell it continues is in another row - so that one is resolved.
      if (cell.span === 'rowspan') {
        // Only a `^` is walked past. The cell above may be a `<`, and that one
        // ALREADY carries its origin's header flag, so reading the flag off it
        // is the answer; walking past it reached the cell two rows up, which
        // says nothing about this column and reported a header column short
        // under a `<th rowspan colspan>`.
        let up = r - 1
        while (up >= 0 && allRows[up]!.cells[c]?.span === 'rowspan') up -= 1
        return up >= 0 ? headerAt(up, c) : false
      }
      return cell.header
    }
    // Every slot is exactly one COLUMN: a source cell contributes its origin
    // plus a `<` per further column, and a carried span contributes a `^` per
    // column it covers, so the array index a continuation resolves by IS the
    // grid column here.
    const leading = (row: TableRow, r: number): number => {
      let slot = 0
      while (slot < row.cells.length && headerAt(r, slot)) slot += 1
      // An all-header row would say every column is a row head, which is what
      // an intermediate HEADER row is, not a row-head column.
      return slot === row.cells.length ? 0 : slot
    }
    return Math.min(...groupRows.map((row, offset) => leading(row, firstIndex + offset)))
  }

  private figure(node: P5Node, path: string, depth: number, attrs?: Attrs): BlockNode[] {
    // Our own composite-figure shape (PART 9 §4c): the group class marks the
    // wrapper, the panels div holds the children. Own-output round trip only;
    // a foreign nested figure without the class keeps the unwrap below.
    if ((this.attr(node, 'class') ?? '').split(/\s+/).includes('carve-figure-group')) {
      return this.figureGroup(node, path, depth, attrs)
    }
    const captionNode = node.childNodes?.find((n) => n.tagName === 'figcaption')
    const body = (node.childNodes ?? []).filter((n) => n !== captionNode)
    const targets = this.blocks(body, path, depth + 1)
    const target = targets[0]
    if (target && ['image', 'block_quote', 'table', 'code_block', 'paragraph'].includes(target.type)) {
      /*
       * A table brings its own caption slot, so a figure-wrapped table can
       * arrive carrying TWO captions - its own `<caption>` and the figure's
       * `<figcaption>`. Carve spells one `^ ` line per host, and the wrapper
       * itself has no spelling at all, so the figure's caption is the one that
       * cannot survive. Keeping both wrote two `^ ` lines, and the second
       * re-read as a literal paragraph.
       */
      if (target.type === 'table' && (target as { caption?: unknown }).caption && captionNode) {
        this.add(
          'table-degraded',
          'Dropped a <figcaption> from a figure wrapping a table that carries its own <caption>: Carve spells one caption per table',
          'warning',
          `${path}/figcaption[1]`,
        )
        return [target, ...targets.slice(1)]
      }
      /*
       * PART 12 §16: the wrapper around a TABLE is the one figure this import
       * produces that Carve source cannot spell, so it survives in the AST and
       * not in the written source. Recorded rather than reported here -
       * `htmlToAst` loses nothing, and `htmlToCarve` is where the loss happens.
       *
       * Reached only when a figure is actually built: the branch above returns
       * the table itself when it already carries a caption, and no wrapper
       * exists to lose in that case.
       */
      if (target.type === 'table') {
        this.unspellable.push({
          path,
          message: 'A figure wrapping a table has no Carve spelling; the caption is written on the table, which renders <caption> inside it',
        })
      }
      return [{ type: 'figure', target: target as never, caption: this.inlines(captionNode?.childNodes ?? [], `${path}/figcaption[1]`, depth + 1), ...(attrs ? { attrs } : {}) }, ...targets.slice(1)]
    }
    this.add('element-unwrapped', 'Unwrapped figure without a representable target', 'warning', path)
    this.reportUnwrappedAttributes(attrs, 'figure', path)
    return [...targets, ...(captionNode ? [{ type: 'paragraph' as const, children: this.inlines(captionNode.childNodes ?? [], path, depth + 1) }] : [])]
  }

  private inlines(nodes: P5Node[], parentPath: string, depth: number): InlineNode[] {
    const out: InlineNode[] = []
    nodes.forEach((node, index) => out.push(...this.inline(node, this.childPath(parentPath, node, index), depth)))
    const merged: InlineNode[] = []
    for (const node of out) {
      const last = merged.at(-1)
      if (node.type === 'text' && last?.type === 'text') last.value += node.value
      else merged.push(node)
    }
    return merged
  }

  private inline(node: P5Node, path: string, depth: number): InlineNode[] {
    this.enter(depth)
    if (node.nodeName === '#text') return [{ type: 'text', value: (node.value ?? '').replace(/\s+/g, ' ') }]
    const tag = node.tagName
    if (!tag) return []
    if (ACTIVE.has(tag)) {
      this.add('element-dropped', `Dropped active <${tag}> element`, 'warning', path)
      return []
    }
    // Not in `roundtrip`, which raw-preserves what Carve CANNOT express. The
    // seven semantic elements are mapped in every mode because their spelling
    // renders back as the element itself; the marks do not - a `<q>` becomes
    // text and its `cite` goes with it - so this mapping is the safe/semantic
    // answer and the raw fallback is the round-tripping one.
    if (tag === 'q' && this.mode !== 'roundtrip') return this.quotation(node, path, depth)
    /*
     * MathML -> `math`, as carve#1210's D6 rules it: a three-tier lookup for
     * TeX that is already in the source, and no MathML-to-TeX converter.
     *
     * THE DECISION IS THE THIRD TIER, and it is a drop rather than a degrade.
     * MathML's children are a token stream, so concatenating them is not a
     * lossy rendering of the equation but a different value: the children of
     * `<math><mfrac><mn>1</mn><mn>2</mn></mfrac></math>` concatenate to `12`,
     * which is what this importer wrote before this branch existed. One half
     * arriving as twelve is a plausible wrong value, and a plausible wrong
     * value survives review, where a missing equation and a warning naming it
     * do not. This is the line between math and the EMBEDS below: a `<video>`'s
     * children are fallback content the author wrote for exactly this case.
     *
     * `roundtrip` keeps the whole element instead, through the raw arm at the
     * end of this method, which is where a `<math>` already went - Carve's own
     * HTML spells math as `<span class="math">`, so a `<math>` in that mode's
     * input is foreign markup by definition and the mode's contract is to
     * preserve it verbatim.
     */
    if (tag === 'math') {
      /*
       * Charged once, before anything reads the subtree: every arm below
       * returns without walking the children, so `inlines()` never counts a
       * descendant, and `maxNodes`/`maxDepth` must not depend on which branch
       * an element takes. Before the counter, so a limit is reached by the
       * counter rather than by the read - and once, because charging in the
       * tier lookup as well counted an empty-annotation element's descendants
       * twice.
       */
      this.budget(node, depth)
      const math = this.mathml(node, path)
      if (math) return [math]
      if (this.mode === 'roundtrip') {
        // The same answer the generic arm below gave a `<math>` before this
        // branch existed, and byte for byte the same output. Reported once for
        // the element rather than once per descendant, because the descendants
        // are not preserved separately - they are inside this one raw span.
        this.add('raw-preserved', 'Preserved unsupported <math> element as raw HTML', 'warning', path)
        return [{ type: 'raw_inline', format: 'html', content: serializeOuter(node as never) }]
      }
      this.add('element-dropped', 'Dropped <math>: no TeX annotation and no alttext, and its children are a token stream, not an equation', 'warning', path)
      return []
    }
    const children = this.inlines(node.childNodes ?? [], path, depth + 1)
    const attrs = this.attrs(node, path)
    if (tag === 'em' || tag === 'i') return [{ type: 'emphasis', children, ...(attrs ? { attrs } : {}) }]
    if (tag === 'strong' || tag === 'b') return [{ type: 'strong', children, ...(attrs ? { attrs } : {}) }]
    /*
     * `<del>` and `<ins>` are HTML's change-tracking PAIR and Carve spells that
     * pair `{-x-}` / `{+x+}`, which render back as `<del>` and `<ins>`.
     * `<s>` and `<strike>` are the other thing - content no longer accurate,
     * with no edit implied - and that is `~x~`, which renders `<s>`.
     *
     * `<del>` used to import as `strike`, so a tracked deletion came back as
     * `<s>` while `<ins>` was unwrapped to its text outright. Importing `<ins>`
     * without moving `<del>` would have made that asymmetry worse: the
     * insertion of an edit surviving as an edit and the deletion beside it not.
     */
    if (tag === 'del') return [{ type: 'delete', children, ...(attrs ? { attrs } : {}) }]
    if (tag === 'ins') return [{ type: 'insert', children, ...(attrs ? { attrs } : {}) }]
    if (tag === 's' || tag === 'strike') return [{ type: 'strike', children, ...(attrs ? { attrs } : {}) }]
    if (tag === 'u') return [{ type: 'underline', children, ...(attrs ? { attrs } : {}) }]
    if (tag === 'mark') return [{ type: 'highlight', children, ...(attrs ? { attrs } : {}) }]
    if (tag === 'sub') return [{ type: 'subscript', children, ...(attrs ? { attrs } : {}) }]
    if (tag === 'sup') return [{ type: 'superscript', children, ...(attrs ? { attrs } : {}) }]
    if (tag === 'code') return [{ type: 'code', value: this.text(node), ...(attrs ? { attrs } : {}) }]
    if (tag === 'a') {
      const title = this.attr(node, 'title')
      return [{ type: 'link', href: this.attr(node, 'href') ?? '', children, ...(title ? { title } : {}), ...(attrs ? { attrs } : {}) }]
    }
    if (tag === 'img') {
      const title = this.attr(node, 'title')
      return [{ type: 'image', src: this.attr(node, 'src') ?? '', alt: this.attr(node, 'alt') ?? '', ...(title ? { title } : {}), ...(attrs ? { attrs } : {}) }]
    }
    if (tag === 'br') return [{ type: 'hard_break' }]
    // The synthetic element the adapter footnote pass leaves at each
    // reference site (adapterFootnotes); never present in real HTML input.
    if (tag === 'carve-footnote-ref') {
      return [{ type: 'footnote_ref', id: this.attr(node, 'label') ?? '' }]
    }
    if (SEMANTIC_SPAN_TAGS.has(tag)) return [this.semanticSpan(tag, node, children, attrs)]
    if (tag === 'span' && attrs) return [{ type: 'span', children, attrs }]
    /*
     * THE EMBEDS END HERE, AND THAT IS THE POLICY (carve#1210 P10).
     *
     * `video`, `audio`, `iframe`, `svg`, `object`, `embed` and `canvas` are
     * none of them in `BLOCK`, so they arrive at THIS arm and take its two
     * answers: unwrapped to their fallback content in `safe` and `semantic`,
     * raw-preserved in `roundtrip`. Their `src`, and every other attribute, is
     * reported dropped on the way past.
     *
     * Not an oversight and not a to-do. Carve has no embed node, and giving it
     * one is a SPEC question - which media types, which attributes, what a
     * non-HTML renderer does with them, what a `src` means for a document that
     * has to be safe to render from an untrusted source - decided in the spec
     * repo rather than by whichever importer needed it first. Until then the
     * honest import is the one that keeps the fallback content the author wrote
     * for exactly this case, says what it dropped, and keeps the markup
     * verbatim in the mode whose contract is Carve-produced HTML.
     */
    if (this.mode === 'roundtrip') {
      this.add('raw-preserved', `Preserved unsupported <${tag}> element as raw HTML`, 'warning', path)
      return [{ type: 'raw_inline', format: 'html', content: serializeOuter(node as never) }]
    }
    this.add('element-unwrapped', `Unwrapped unsupported <${tag}> element`, 'info', path)
    this.reportUnwrappedAttributes(attrs, tag, path)
    return children
  }

  /**
   * Tiers 1 and 2 of D6: the TeX the producer already put in the element.
   *
   * 1. an `<annotation>` whose encoding DECLARES TeX, taken verbatim;
   * 2. else the `alttext` attribute, plus an `encoding-assumed` recording
   *    that its encoding was guessed - MathML does not declare what `alttext`
   *    holds, and `<math alttext="x squared">` is as valid as one holding TeX.
   *
   * Tier 2 reports `encoding-assumed` and not `element-unwrapped` because the
   * two say different things. Unwrapping describes the INPUT's structure and
   * loses no meaning; an assumed encoding is a claim about the OUTPUT, which
   * is only correct while the guess holds. A consumer told that an element is
   * gone cannot separate a harmless structural event from a math node whose
   * content may not be TeX at all, and that second one is the signal it could
   * act on.
   *
   * Annotation first, and the order carries a ruling: where the two disagree,
   * a declared encoding beats an undeclared attribute. carve-php's own
   * docblock documents the reverse order and is corrected to this one.
   *
   * The content keeps the TeX byte for byte, `{\displaystyle …}` wrapper and
   * all: Carve's math content is opaque TeX and unwrapping it would be a
   * second decision. Only the surrounding whitespace goes, which is the
   * pretty-printer's and not the equation's - and carve-php, which shipped
   * this ruling first, trims it too, so the two engines write one byte
   * sequence for one input.
   *
   * Whitespace-only content is treated as absent, because it is: an empty
   * `alttext` or a pretty-printed empty annotation says nothing about the
   * equation, and falling to the next tier reports the loss instead of
   * writing an empty math node.
   *
   * Returns `undefined` for tier 3, whose two answers are the caller's.
   */
  private mathml(node: P5Node, path: string): InlineNode | undefined {
    const annotated = this.texAnnotation(node)
    const content = (annotated ?? this.attr(node, 'alttext') ?? '').trim()
    if (content === '') return undefined
    // After the tier is settled, so a dropped element does not also report
    // attributes on its way out: the `element-dropped` warning covers it.
    const attrs = this.attrs(node, path)
    // On which tier SUPPLIED the content, not on which one was available: an
    // annotation that held only whitespace falls through to `alttext`, and
    // reading the presence of the element would make that fall-through the one
    // tier-2 read that says nothing.
    if (annotated === undefined) {
      this.add('encoding-assumed', 'Read <math> through its alttext: MathML does not declare the encoding of alttext, so TeX is assumed', 'info', path)
    }
    return { type: 'math', display: this.attr(node, 'display') === 'block', content, ...(attrs ? { attrs } : {}) }
  }

  /**
   * The `<annotation>` a `<semantics>` carries, if it declares TeX.
   *
   * Both hops are DIRECT children - `<semantics>` of the `<math>`, the
   * annotation of that `<semantics>`. A recursive search reaches the
   * `<annotation>` nested inside an `<annotation-xml>` payload, which is
   * markup describing the equation in some other language and not a
   * presentation of the outer element at all.
   *
   * An annotation that declares TeX and then holds nothing does not settle the
   * tier: the search continues, because a later sibling may hold the equation
   * and stopping at the empty one would answer with the wrong tier.
   */
  private texAnnotation(node: P5Node): string | undefined {
    for (const semantics of node.childNodes ?? []) {
      if (semantics.tagName !== 'semantics') continue
      for (const child of semantics.childNodes ?? []) {
        if (child.tagName !== 'annotation') continue
        const encoding = this.attr(child, 'encoding')
        if (encoding === undefined || !TEX_ANNOTATION_ENCODINGS.has(encoding.trim().toLowerCase())) continue
        const text = this.flatText(child).trim()
        if (text !== '') return text
      }
    }
    return undefined
  }

  /**
   * Charge a subtree the import will not walk against the budgets one it walks
   * would pay, and check its depth while doing so.
   *
   * Explicit stack rather than recursion: this runs on input the DOM parser
   * accepted at any depth, and its whole point is to reach `maxDepth` before
   * something that recurses does.
   */
  /**
   * `text()` without its recursion, for the annotation - which is read to
   * settle the tier, so it is read before any depth counter has seen it. At a
   * caller-raised `maxDepth` a recursive read is the thing that fails first,
   * and a `RangeError` is not the typed error the API promises. Document order
   * is kept by pushing the children in reverse.
   */
  private flatText(node: P5Node): string {
    let text = ''
    const pending: P5Node[] = [node]
    while (pending.length) {
      const current = pending.pop()!
      if (current.nodeName === '#text') text += current.value ?? ''
      const children = current.childNodes ?? []
      for (let index = children.length - 1; index >= 0; index -= 1) pending.push(children[index]!)
    }
    return text
  }

  private budget(node: P5Node, depth: number): void {
    const pending: Array<[P5Node, number]> = [[node, depth]]
    while (pending.length) {
      const [current, currentDepth] = pending.pop()!
      for (const child of current.childNodes ?? []) {
        this.enter(currentDepth + 1)
        pending.push([child, currentDepth + 1])
      }
    }
  }

  /**
   * `<q>` -> the quotation marks a browser draws for it.
   *
   * Carve has no quotation element and needs none: the element's whole rendered
   * effect is the pair of marks, which are ordinary text. So this is a MAPPING
   * rather than the unwrap it used to be - the same content reached the
   * document before, without the marks that made it a quotation.
   *
   * The marks alternate by nesting depth, as a browser's do: double outside,
   * single inside. They are the typographic characters rather than `"`, which
   * the writer escapes back to a straight quote (PART 11 §5 keeps a quote that
   * reached it as TEXT), so the curly pair is both what the element renders as
   * and what survives being written.
   *
   * Still reported, at `info`: the ELEMENT does not come back, and a converter
   * going the other way sees text where a `<q>` was. The message says the
   * mapping was deliberate rather than claiming something was unwrapped.
   */
  private quotation(node: P5Node, path: string, depth: number): InlineNode[] {
    const [open, close] = this.quoteDepth % 2 === 0 ? ['\u201c', '\u201d'] : ['\u2018', '\u2019']
    this.quoteDepth += 1
    try {
      const children = this.inlines(node.childNodes ?? [], path, depth + 1)
      const attrs = this.attrs(node, path)
      const quoted: InlineNode[] = [{ type: 'text', value: open! }, ...children, { type: 'text', value: close! }]
      this.add('element-unwrapped', 'Read <q> as quotation marks: Carve has no quotation element, so the marks are the mapping', 'info', path)
      return attrs ? [{ type: 'span', children: quoted, attrs }] : quoted
    } finally {
      this.quoteDepth -= 1
    }
  }

  /**
   * One of the seven semantic elements, as the span attribute that spells it.
   *
   * `<kbd>Tab</kbd>` -> `[Tab]{kbd}`, `<abbr title="X">c</abbr>` -> `[c]{abbr="X"}`,
   * `<time datetime="X">c</time>` -> `[c]{time="X"}` (carve#1140). The compact
   * form, not `:kbd[…]`: the generic spelling has no core handler and is the
   * extension's soft-deprecated compatibility form, so importing into it would
   * write a form scheduled for removal into freshly migrated documents.
   *
   * Placed with the other mapped elements rather than behind a mode branch:
   * `roundtrip` raw-preserves only what Carve CANNOT express, so an element
   * that now has a spelling is spelled in every mode - the same treatment
   * `<mark>` and `<em>` already get.
   *
   * `samp`, `var`, `cite` and `dfn` belong to the SemanticSpan extension, so a
   * CORE render returns `<span samp="">out</span>` rather than `<samp>`. Still
   * strictly better than the unwrap it replaces, where the semantic was
   * discarded outright, but it is a real difference and the tests show it.
   */
  private semanticSpan(tag: string, node: P5Node, children: InlineNode[], attrs?: Attrs): InlineNode {
    const source = SEMANTIC_SPAN_VALUE_SOURCE.get(tag)
    const value = source === undefined ? '' : this.attr(node, source) ?? ''
    const keyValues: Record<string, string> = { ...attrs?.keyValues }
    // A `title` on `<abbr>`/`<dfn>` IS the value here, not a leftover to ride
    // along: `attrs()` collected it before the tag was known, and keeping both
    // would render the same attribute onto the element twice over.
    if (source === 'title') delete keyValues.title
    keyValues[tag] = value
    return { type: 'span', children, attrs: { ...attrs, keyValues } }
  }

  private text(node: P5Node): string {
    if (node.nodeName === '#text') return node.value ?? ''
    return (node.childNodes ?? []).map((child) => this.text(child)).join('')
  }

  private visible(nodes: InlineNode[]): boolean {
    return nodes.some((node) => node.type !== 'text' || node.value.trim() !== '')
  }

  /**
   * The losses a WRITER takes, reported by whoever writes (PART 12 §16).
   *
   * A canonical Carve writer has no spelling for a figure wrapping a table, so
   * it emits the table and a `^ ` caption line, and that re-reads as the
   * table's own caption - `<caption>` inside the table rather than a
   * `<figcaption>` beside it. A description with no term before it is the same
   * kind of loss: `:  text` on its own is a paragraph, not a definition list.
   * The rendering changes in both cases, so the severity is `warning`, and the
   * limit is the importer's own: these diagnostics are not a second budget.
   */
  reportSerializationLosses(): void {
    for (const { path, message } of this.unspellable) {
      this.add('structure-unspellable', message, 'warning', path)
    }
  }

  /** A copy of `attrs` without one class, `undefined` when nothing remains. */
  private stripClass(attrs: Attrs | undefined, className: string): Attrs | undefined {
    if (!attrs?.classes) return attrs
    const classes = attrs.classes.filter((c) => c !== className)
    const next: Attrs = { ...attrs }
    if (classes.length) next.classes = classes
    else delete next.classes
    if (next.id === undefined && next.classes === undefined && next.keyValues === undefined) {
      return undefined
    }
    return next
  }

  /**
   * Our own `carve-figure-group` output back to a `figure_group` node (PART 9
   * §4c). The FLAT shape: panels and stray content are direct children of the
   * group figure, with the group's own figcaption LAST - a panel figure's
   * figcaption is nested a level down and never read as the group's. A
   * `carve-figure-panel` figure comes back as the panel it rendered from; a
   * bare `<figure><table/></figure>` wrapper (the table panel, which carries
   * no figcaption) unwraps to the table so the table's own caption and attrs
   * stay its own.
   */
  private figureGroup(node: P5Node, path: string, depth: number, attrs?: Attrs): BlockNode[] {
    const captionNode = node.childNodes?.filter((n) => n.tagName === 'figcaption').pop()
    const bodyNodes = (node.childNodes ?? []).filter((n) => n !== captionNode)
    const children = this.blocks(bodyNodes, path, depth + 1)
    for (let i = 0; i < children.length; i++) {
      const child = children[i]!
      if (child.type !== 'figure' || !child.attrs?.classes?.includes('carve-figure-panel')) continue
      const stripped = this.stripClass(child.attrs, 'carve-figure-panel')
      if (stripped) child.attrs = stripped
      else delete child.attrs
      // The explicit table-panel wrapper renders with no figcaption; the
      // generic figure import gave it an empty caption, which is not a shape
      // the parser produces - unwrap back to the table itself.
      if (child.target.type === 'table' && child.caption.length === 0 && child.attrs === undefined) {
        children[i] = child.target
      }
    }
    const group: FigureGroup = { type: 'figure_group', children }
    if (captionNode) {
      group.caption = this.inlines(captionNode.childNodes ?? [], `${path}/figcaption[1]`, depth + 1)
    }
    const groupAttrs = this.stripClass(attrs, 'carve-figure-group')
    if (groupAttrs) group.attrs = groupAttrs
    return [group]
  }

  // --------------------------------------------------------------------------
  // Adapter footnotes: word-processor footnote-shaped HTML to footnote nodes.
  //
  // Ports markup-carve/carve-php#1303 (and the branch pins of #1307). The
  // shapes were measured, not recalled - Word's two saves, Google Docs,
  // LibreOffice and Pandoc 1.x agree on almost nothing, and what all of them
  // do have is a MUTUALLY LINKED ANCHOR PAIR: the body reference addresses
  // the note and the note addresses the reference back. That pair, not a
  // vendor class name and not the `fn1`/`fnref1` id convention, is the
  // signature this matches.
  //
  // The spec permits this shape of work - "Adapters may normalize
  // editor-specific markup before the core policy" (docs/html-import.md,
  // "Required API surface") - but it does not rule on footnote import, so
  // every decision below is this importer's, written down rather than left
  // silent. No diagnostics on the edge cases, deliberately: in each of them
  // the Carve source keeps what the HTML said, so there is nothing lossy to
  // report.
  // --------------------------------------------------------------------------

  /**
   * Recognize footnote pairs, rewrite each reference site to a synthetic
   * reference element `inline()` reads as a `footnote_ref`, detach the note
   * blocks, and return their bodies keyed 1..N by document order.
   *
   * Labels are assigned 1..N over the notes in document order rather than
   * parsed out of the ids: an id is generated navigation an engine
   * regenerates, and `_ftn1` or `sdfootnote1sym` is not a label any Carve
   * source could carry anyway.
   */
  private adapterFootnotes(root: P5Node): Record<string, BlockNode[]> | undefined {
    const elements = this.footnoteDocumentElements(root)
    const order = new Map<P5Node, number>()
    elements.forEach((element, index) => order.set(element, index))

    const targets = this.footnoteFragmentTargets(elements)
    const candidates = this.resolveFootnotePairDirection(
      this.footnotePairCandidates(elements, targets),
      order,
    )
    if (candidates.length === 0) return undefined

    const definitions = this.attachRemainingFootnoteReferences(
      elements,
      this.groupFootnoteDefinitions(candidates, order),
    )

    const defs: Record<string, BlockNode[]> = {}
    const containers = new Set<P5Node>()
    definitions.forEach((definition, index) => {
      const label = String(index + 1)
      const block = definition.block
      if (index === 0) this.removeFootnoteSeparator(block)

      const identities = definition.refs
        .map((reference) => this.footnoteAnchorIdentity(reference))
        .filter((identity) => identity !== '')
      this.stripFootnoteBacklinks(block, identities, definition.fragments)

      defs[label] = this.blocks(block.childNodes ?? [], `footnote[${label}]`, 1)

      for (const reference of definition.refs) {
        const site = this.footnoteReferenceSite(reference)
        const replacement: P5Node = {
          nodeName: 'carve-footnote-ref',
          tagName: 'carve-footnote-ref',
          attrs: [{ name: 'label', value: label }],
          childNodes: [],
        }
        if (site.parentNode !== undefined) replacement.parentNode = site.parentNode
        this.replaceP5Node(site, replacement)
      }

      if (block.parentNode) containers.add(block.parentNode)
      this.detachP5Node(block)
    })

    // Keyed by identity, because every note in one list names the SAME
    // container: pruning it once per note walked that list's children once
    // per note, which is quadratic on a document that is mostly notes.
    for (const container of containers) this.pruneEmptyFootnoteContainer(container)

    return defs
  }

  /** Every element in the subtree, in document order. */
  private footnoteDocumentElements(root: P5Node): P5Node[] {
    const elements: P5Node[] = []
    const walk = (node: P5Node): void => {
      for (const child of node.childNodes ?? []) {
        if (child.tagName !== undefined) {
          elements.push(child)
          walk(child)
        }
      }
    }
    walk(root)
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
      const id = this.attr(element, 'id')
      if (id && !targets.has(id)) targets.set(id, element)
    }
    for (const element of elements) {
      if (element.tagName !== 'a') continue
      const name = this.attr(element, 'name')
      if (name && !targets.has(name)) targets.set(name, element)
    }
    return targets
  }

  /**
   * Every anchor that could be a footnote reference, with the block it would
   * bind to. A candidate needs the mutual back-link or an explicit reference
   * marker; an anchor inside its own would-be note is never one.
   */
  private footnotePairCandidates(elements: P5Node[], targets: Map<string, P5Node>): FootnoteCandidate[] {
    const anchors: Array<{ anchor: P5Node; fragment: string }> = []
    const used = new Set<string>()
    for (const element of elements) {
      if (element.tagName !== 'a') continue
      const href = this.attr(element, 'href') ?? ''
      if (!href.startsWith('#')) continue
      const fragment = href.slice(1)
      if (fragment === '' || !targets.has(fragment)) continue
      anchors.push({ anchor: element, fragment })
      used.add(fragment)
    }

    const candidates: FootnoteCandidate[] = []
    for (const { anchor, fragment } of anchors) {
      const block = this.resolveFootnoteDefinitionBlock(targets.get(fragment)!, used)
      if (block === null || this.p5Contains(block, anchor)) continue

      const identity = this.footnoteAnchorIdentity(anchor)
      const mutual = identity !== '' && this.footnoteBlockLinksTo(block, identity)
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
  private resolveFootnoteDefinitionBlock(target: P5Node, used: Set<string>): P5Node | null {
    let block = target
    while (block.tagName === undefined || !FOOTNOTE_DEFINITION_BLOCKS.has(block.tagName)) {
      const parent = block.parentNode
      if (parent === undefined || parent.tagName === undefined) return null
      block = parent
    }

    const parent = block.parentNode
    if (
      parent !== undefined &&
      parent.tagName !== undefined &&
      FOOTNOTE_WRAPPER_BLOCKS.has(parent.tagName) &&
      (this.attr(parent, 'id') ?? '') !== '' &&
      this.countFootnoteTargets(parent, used) === 1
    ) {
      block = parent
    }
    return block
  }

  /** How many referenced fragment targets this element holds, itself included. */
  private countFootnoteTargets(node: P5Node, used: Set<string>): number {
    let count = this.isFootnoteFragmentTarget(node, used) ? 1 : 0
    for (const child of node.childNodes ?? []) {
      if (child.tagName !== undefined) count += this.countFootnoteTargets(child, used)
    }
    return count
  }

  private isFootnoteFragmentTarget(node: P5Node, used: Set<string>): boolean {
    const id = this.attr(node, 'id')
    if (id && used.has(id)) return true
    if (node.tagName !== 'a') return false
    const name = this.attr(node, 'name')
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
  ): FootnoteCandidate[] {
    const byReference = new Map<P5Node, FootnoteCandidate>()
    for (const candidate of candidates) byReference.set(candidate.ref, candidate)

    return candidates.filter((candidate) => {
      const inverse = this.inverseFootnoteCandidate(byReference, candidate)
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
  ): FootnoteCandidate | null {
    const identity = this.footnoteAnchorIdentity(candidate.ref)
    if (identity === '') return null

    for (const anchor of this.footnoteAnchorsUnder(candidate.block)) {
      if (this.attr(anchor, 'href') !== `#${identity}`) continue
      const inverse = byReference.get(anchor)
      if (inverse === undefined) continue
      if (this.p5Contains(inverse.block, candidate.ref)) return inverse
    }
    return null
  }

  private footnoteReferenceSideWins(
    first: FootnoteCandidate,
    second: FootnoteCandidate,
    order: Map<P5Node, number>,
  ): boolean {
    const firstMarked = this.isFootnoteReferenceMarked(first.ref)
    const secondMarked = this.isFootnoteReferenceMarked(second.ref)
    if (firstMarked !== secondMarked) return firstMarked

    const firstBack = this.isFootnoteBacklinkMarked(first.ref)
    const secondBack = this.isFootnoteBacklinkMarked(second.ref)
    if (firstBack !== secondBack) return secondBack

    return (order.get(first.ref) ?? 0) < (order.get(second.ref) ?? 0)
  }

  /**
   * One entry per definition block, carrying every reference bound to it. A
   * block that contains another definition block is a container, not a note:
   * keeping both would move a subtree into two places at once. The containers
   * are found by climbing from each block, one walk per note rather than one
   * per PAIR of notes.
   */
  private groupFootnoteDefinitions(
    candidates: FootnoteCandidate[],
    order: Map<P5Node, number>,
  ): FootnoteDefinitionGroup[] {
    const groups = new Map<P5Node, FootnoteDefinitionGroup>()
    for (const candidate of candidates) {
      let group = groups.get(candidate.block)
      if (group === undefined) {
        group = { block: candidate.block, refs: [], fragments: [] }
        groups.set(candidate.block, group)
      }
      group.refs.push(candidate.ref)
      if (!group.fragments.includes(candidate.fragment)) group.fragments.push(candidate.fragment)
    }

    for (const group of [...groups.values()]) {
      let ancestor = group.block.parentNode
      while (ancestor !== undefined) {
        if (groups.has(ancestor)) groups.delete(ancestor)
        ancestor = ancestor.parentNode
      }
    }

    return [...groups.values()].sort(
      (first, second) => (order.get(first.block) ?? 0) - (order.get(second.block) ?? 0),
    )
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
  ): FootnoteDefinitionGroup[] {
    const byFragment = new Map<string, FootnoteDefinitionGroup>()
    for (const definition of definitions) {
      for (const fragment of definition.fragments) byFragment.set(fragment, definition)
    }

    // Which elements sit inside a note, computed once: asking each anchor
    // whether it is inside any note walked the tree once per anchor and per
    // note, which is quadratic on a document that is mostly notes.
    const inside = new Set<P5Node>()
    const markInside = (node: P5Node): void => {
      inside.add(node)
      for (const child of node.childNodes ?? []) markInside(child)
    }
    for (const definition of definitions) markInside(definition.block)

    for (const element of elements) {
      if (element.tagName !== 'a') continue
      const href = this.attr(element, 'href') ?? ''
      if (!href.startsWith('#')) continue
      const definition = byFragment.get(href.slice(1))
      if (definition === undefined || inside.has(element)) continue
      if (!definition.refs.includes(element)) definition.refs.push(element)
    }

    return definitions
  }

  private footnoteAnchorIdentity(anchor: P5Node): string {
    const id = this.attr(anchor, 'id')
    return id !== undefined && id !== '' ? id : this.attr(anchor, 'name') ?? ''
  }

  private footnoteBlockLinksTo(block: P5Node, fragment: string): boolean {
    for (const anchor of this.footnoteAnchorsUnder(block)) {
      if (this.attr(anchor, 'href') === `#${fragment}`) return true
    }
    return false
  }

  private footnoteAnchorsUnder(node: P5Node): P5Node[] {
    const anchors: P5Node[] = []
    const walk = (current: P5Node): void => {
      for (const child of current.childNodes ?? []) {
        if (child.tagName === 'a') anchors.push(child)
        if (child.tagName !== undefined) walk(child)
      }
    }
    walk(node)
    return anchors
  }

  /**
   * `footnoteRef` is Pandoc 1.x's spelling of `footnote-ref`, which it used
   * together with a back-link carrying no attributes at all.
   */
  private isFootnoteReferenceMarked(anchor: P5Node): boolean {
    if (this.attr(anchor, 'role') === 'doc-noteref') return true
    const classes = (this.attr(anchor, 'class') ?? '').split(/\s+/)
    return classes.includes('footnote-ref') || classes.includes('footnoteRef')
  }

  private isFootnoteBacklinkMarked(anchor: P5Node): boolean {
    if (this.attr(anchor, 'role') === 'doc-backlink') return true
    return (this.attr(anchor, 'class') ?? '').split(/\s+/).includes('footnote-back')
  }

  private p5Contains(ancestor: P5Node, node: P5Node): boolean {
    let current = node.parentNode
    while (current !== undefined) {
      if (current === ancestor) return true
      current = current.parentNode
    }
    return false
  }

  private detachP5Node(node: P5Node): void {
    const siblings = node.parentNode?.childNodes
    if (siblings === undefined) return
    const index = siblings.indexOf(node)
    if (index !== -1) siblings.splice(index, 1)
  }

  private replaceP5Node(node: P5Node, replacement: P5Node): void {
    const siblings = node.parentNode?.childNodes
    if (siblings === undefined) return
    const index = siblings.indexOf(node)
    if (index !== -1) siblings[index] = replacement
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
      let previous = this.p5PreviousSibling(node)
      while (previous !== undefined && this.isFootnoteChromeNode(previous)) {
        previous = this.p5PreviousSibling(previous)
      }

      if (previous !== undefined && (previous.tagName === 'hr' || previous.tagName === 'br')) {
        this.detachP5Node(previous)
        continue
      }
      if (previous !== undefined) return

      const parent = node.parentNode
      if (parent === undefined || parent.tagName === undefined) return
      node = parent
    }
  }

  private p5PreviousSibling(node: P5Node): P5Node | undefined {
    const siblings = node.parentNode?.childNodes
    if (siblings === undefined) return undefined
    const index = siblings.indexOf(node)
    return index > 0 ? siblings[index - 1] : undefined
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
    if (node.nodeName === '#comment') return true
    if (node.nodeName !== '#text') return false
    const text = (node.value ?? '').trim()
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
    for (const anchor of this.footnoteAnchorsUnder(block)) {
      const href = this.attr(anchor, 'href') ?? ''
      const pointsBack = href.startsWith('#') && identities.includes(href.slice(1))
      const isMarker = href.startsWith('#') && fragments.includes(this.footnoteAnchorIdentity(anchor))
      if (!this.isFootnoteBacklinkMarked(anchor) && !pointsBack && !isMarker) continue

      const parent = anchor.parentNode
      this.detachP5Node(anchor)
      if (
        parent !== undefined &&
        (parent.tagName === 'sup' || parent.tagName === 'span') &&
        !(parent.childNodes ?? []).some(
          (child) => child.tagName !== undefined || (child.nodeName === '#text' && (child.value ?? '').trim() !== ''),
        )
      ) {
        this.detachP5Node(parent)
      }
    }
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
    const parent = reference.parentNode
    if (parent === undefined || parent.tagName !== 'sup') return reference
    for (const child of parent.childNodes ?? []) {
      if (child.tagName !== undefined && child !== reference) return reference
      if (child.nodeName === '#text' && (child.value ?? '').trim() !== '') return reference
    }
    return parent
  }

  /**
   * Drop a container the notes left empty, so the `<hr>` and the `<ol>` that
   * held them do not import as a thematic break beside an empty list. A
   * separator written AFTER the notes survives the explicit search and is
   * swept up here instead.
   */
  private pruneEmptyFootnoteContainer(node: P5Node | undefined): void {
    while (node !== undefined && node.tagName !== undefined) {
      if (node.tagName === 'body' || node.tagName === 'html') return
      for (const child of node.childNodes ?? []) {
        if (this.isFootnoteChromeNode(child)) continue
        if (child.tagName === 'hr' || child.tagName === 'br') continue
        return
      }
      const parent = node.parentNode
      this.detachP5Node(node)
      node = parent
    }
  }
}

export function htmlToAst(html: string, options: HtmlImportOptions = {}): HtmlImportResult<Document> {
  const importer = new Importer(options)
  const value = importer.import(html)
  return { value, report: { mode: importer.mode, adapter: importer.adapter, diagnostics: importer.diagnostics } }
}

export function htmlToCarve(html: string, options: HtmlImportOptions = {}): HtmlImportResult<string> {
  const importer = new Importer(options)
  const value = importer.import(html)
  // The loss belongs to serialization, not to the import: a consumer that keeps
  // the AST `htmlToAst` returns keeps the figure wrapper and loses nothing. So
  // the importer records where it built one and only this function reports it.
  importer.reportSerializationLosses()
  return { value: renderCarve(value), report: { mode: importer.mode, adapter: importer.adapter, diagnostics: importer.diagnostics } }
}
