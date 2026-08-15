import { parseFragment, serializeOuter } from 'parse5'
import type {
  Attrs,
  BlockNode,
  Document,
  InlineNode,
  List,
  TableCell,
  TableRow,
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

export type HtmlImportDiagnosticCode =
  | 'element-dropped'
  | 'element-unwrapped'
  | 'attribute-dropped'
  | 'style-unmapped'
  | 'table-degraded'
  | 'structure-unspellable'
  | 'raw-preserved'
  | 'diagnostics-truncated'

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
 * The elements PART 9 §9 and §10 spell as an attribute on a span, so the
 * importer writes `[Tab]{kbd}` rather than unwrapping to `Tab` (carve#1140).
 *
 * Mirrors EXTENDED_SEMANTIC_SPAN_ORDER in render-html.ts. `mark` and `code` are
 * NOT here: the tier split retired them from the registry and each already has
 * its own syntax (`=m=`, a code span), so importing them here would give one
 * input two spellings.
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

class Importer {
  readonly mode: HtmlImportMode
  readonly adapter: HtmlImportAdapter
  readonly diagnostics: HtmlImportDiagnostic[] = []
  /** Where the import built a structure only a serializer loses (§16). */
  private readonly unspellable: string[] = []
  private nodes = 0
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
    const children = this.blocks(fragment.childNodes ?? [], '', 0)
    return { type: 'document', children }
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

  private blocks(nodes: P5Node[], parentPath: string, depth: number): BlockNode[] {
    const out: BlockNode[] = []
    let inlineBuffer: P5Node[] = []
    const flush = (): void => {
      const children = this.inlines(inlineBuffer, parentPath, depth + 1)
      inlineBuffer = []
      if (this.visible(children)) out.push({ type: 'paragraph', children })
    }
    nodes.forEach((node, index) => {
      const path = this.childPath(parentPath, node, index)
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
    if (tag === 'details') return [{ type: 'div', children: this.blocks(node.childNodes ?? [], path, depth + 1), attrs: this.mergeClass(attrs, 'details') }]
    if (tag === 'div' || ['article', 'aside', 'footer', 'header', 'main', 'nav', 'section'].includes(tag)) {
      if (tag !== 'div') this.add('element-unwrapped', `Unwrapped unsupported <${tag}> element`, 'info', path)
      const children = this.blocks(node.childNodes ?? [], path, depth + 1)
      return tag === 'div' && attrs ? [{ type: 'div', children, attrs }] : children
    }
    if (this.mode === 'roundtrip') {
      this.add('raw-preserved', `Preserved unsupported <${tag}> element as raw HTML`, 'warning', path)
      return [{ type: 'raw_block', format: 'html', content: serializeOuter(node as never) }]
    }
    this.add('element-unwrapped', `Unwrapped unsupported <${tag}> element`, 'info', path)
    return this.blocks(node.childNodes ?? [], path, depth + 1)
  }

  private list(node: P5Node, path: string, depth: number, ordered: boolean, attrs?: Attrs): List {
    const items = (node.childNodes ?? []).filter((n) => n.tagName === 'li').map((li, i) => {
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
    const start = ordered ? Number(this.attr(node, 'start') ?? '1') : undefined
    return { type: 'list', ordered, tight: false, items, ...(start !== undefined && start !== 1 ? { start } : {}), ...(attrs ? { attrs } : {}) }
  }

  private table(node: P5Node, path: string, depth: number, attrs?: Attrs): BlockNode {
    /*
     * `<caption>` is a DIRECT child of the table and holds the table's own
     * caption, which `table.caption` has a slot for and Carve spells `^ text`
     * after the rows. The row walk below looks only for `tr`, so before this
     * the element was skipped and the caption left the document silently -
     * pandoc emits exactly this shape for every captioned table.
     */
    const captionNode = (node.childNodes ?? []).find((n) => n.tagName === 'caption')
    const tr: P5Node[] = []
    const walk = (n: P5Node): void => {
      if (n.tagName === 'tr') tr.push(n)
      else for (const child of n.childNodes ?? []) walk(child)
    }
    walk(node)
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

    const rows: TableRow[] = tr.map((row, r) => ({
      type: 'table_row',
      cells: (row.childNodes ?? []).filter((n) => n.tagName === 'td' || n.tagName === 'th').map((cell, c): TableCell => {
        const cellPath = `${path}/tr[${r + 1}]/${cell.tagName}[${c + 1}]`
        if (Number(this.attr(cell, 'rowspan') ?? '1') > 1 || Number(this.attr(cell, 'colspan') ?? '1') > 1) {
          this.add('table-degraded', 'Table spans were flattened by this importer', 'warning', cellPath)
        }
        const cellAttrs = this.attrs(cell, cellPath)
        // A `scope` the renderer would regenerate from position is the
        // generator's own output, not something the author typed: importing it
        // writes it back as if they had. Only a value position cannot explain
        // survives.
        const scope = cellAttrs?.keyValues?.scope
        if (scope !== undefined) {
          const positional = r < leadingHeaderRows ? 'col' : 'row'
          // Outside the leading header run there is nowhere to put it: the
          // grammar gives `header_cell` no attribute slot (`header_cell = '=',
          // …` against `data_cell = [cell_attributes], …`), so the writer spells
          // such a cell `|{scope=…}=A|`, which re-parses as a DATA cell whose
          // content is the literal `=A`. Keeping the value there would trade a
          // header cell for an attribute. Reported rather than silently traded.
          const spellable = r < leadingHeaderRows
          if (scope === positional || !spellable) {
            delete cellAttrs!.keyValues!.scope
            if (Object.keys(cellAttrs!.keyValues!).length === 0) delete cellAttrs!.keyValues
            if (scope !== positional) {
              this.add(
                'attribute-dropped',
                `Dropped scope="${scope}" on a header cell below the header rows: Carve has no attribute slot on a header cell`,
                'warning',
                cellPath,
              )
            }
          }
        }
        const kept = cellAttrs && (cellAttrs.id || cellAttrs.classes || cellAttrs.keyValues) ? cellAttrs : undefined
        return { type: 'table_cell', header: cell.tagName === 'th', children: this.inlines(cell.childNodes ?? [], cellPath, depth + 1), ...(kept ? { attrs: kept } : {}) }
      }),
    }))
    const caption = captionNode
      ? this.inlines(captionNode.childNodes ?? [], `${path}/caption[1]`, depth + 1)
      : undefined
    return { type: 'table', rows, ...(caption ? { caption } : {}), ...(attrs ? { attrs } : {}) }
  }

  private figure(node: P5Node, path: string, depth: number, attrs?: Attrs): BlockNode[] {
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
      if (target.type === 'table') this.unspellable.push(path)
      return [{ type: 'figure', target: target as never, caption: this.inlines(captionNode?.childNodes ?? [], `${path}/figcaption[1]`, depth + 1), ...(attrs ? { attrs } : {}) }, ...targets.slice(1)]
    }
    this.add('element-unwrapped', 'Unwrapped figure without a representable target', 'warning', path)
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
    const children = this.inlines(node.childNodes ?? [], path, depth + 1)
    const attrs = this.attrs(node, path)
    if (tag === 'em' || tag === 'i') return [{ type: 'emphasis', children, ...(attrs ? { attrs } : {}) }]
    if (tag === 'strong' || tag === 'b') return [{ type: 'strong', children, ...(attrs ? { attrs } : {}) }]
    if (tag === 'del' || tag === 's' || tag === 'strike') return [{ type: 'strike', children, ...(attrs ? { attrs } : {}) }]
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
    if (SEMANTIC_SPAN_TAGS.has(tag)) return [this.semanticSpan(tag, node, children, attrs)]
    if (tag === 'span' && attrs) return [{ type: 'span', children, attrs }]
    if (this.mode === 'roundtrip') {
      this.add('raw-preserved', `Preserved unsupported <${tag}> element as raw HTML`, 'warning', path)
      return [{ type: 'raw_inline', format: 'html', content: serializeOuter(node as never) }]
    }
    this.add('element-unwrapped', `Unwrapped unsupported <${tag}> element`, 'info', path)
    return children
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

  private mergeClass(attrs: Attrs | undefined, className: string): Attrs {
    return { ...attrs, classes: [...(attrs?.classes ?? []), className] }
  }

  /**
   * The losses a WRITER takes, reported by whoever writes (PART 12 §16).
   *
   * A canonical Carve writer has no spelling for a figure wrapping a table, so
   * it emits the table and a `^ ` caption line, and that re-reads as the
   * table's own caption - `<caption>` inside the table rather than a
   * `<figcaption>` beside it. The rendering changes, so the severity is
   * `warning`, and the limit is the importer's own: these diagnostics are not
   * a second budget.
   */
  reportSerializationLosses(): void {
    for (const path of this.unspellable) {
      this.add(
        'structure-unspellable',
        'A figure wrapping a table has no Carve spelling; the caption is written on the table, which renders <caption> inside it',
        'warning',
        path,
      )
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
