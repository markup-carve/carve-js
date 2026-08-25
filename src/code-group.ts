import type { Admonition, Attrs, BlockNode, CodeBlock, Div } from './ast.js'
import type { BlockExtensionRenderContext, CarveExtension } from './extension.js'
import { applySingleSelection, resolveTabsMode, type TabsMode } from './tabs.js'

/** Options for the {@link codeGroup} extension. */
export interface CodeGroupOptions {
  /**
   * `'css'` (default, no JS) or `'aria'` (semantic roles, requires JS).
   *
   * THE SAME OPTION TABS CARRIES, and the same type, because PART 11 §13 binds
   * both: two constructs of the same shape do not get different accessibility
   * ceilings because one of them was written second. It was accepted and
   * SILENTLY IGNORED before this existed - `codeGroup({ mode: 'aria' })`
   * rendered the radio markup byte for byte (carve-js#1265).
   *
   * `css` is the default and an unknown value is refused; see
   * {@link resolveTabsMode}.
   */
  mode?: TabsMode
  /** CSS class on the wrapper. Default `'code-group'`. */
  wrapperClass?: string
  /** CSS class on each code panel. Default `'code-group-panel'`. */
  panelClass?: string
  /** CSS class on each tab label. Default `'code-group-label'`. */
  labelClass?: string
  /** CSS class on each radio input. Default `'code-group-radio'`. */
  radioClass?: string
  /** Prefix for generated ids/names. Default `'codegroup'`. */
  idPrefix?: string
  /**
   * Accessible name for the code group AS A WHOLE.
   *
   * Each tab was already named by its own `<label>`; the GROUP was anonymous
   * (carve#1468). Left unset the string comes from the render's `labels` map
   * under `codeGroup` (default `'Code examples'`), so one map localizes the
   * whole document; set here to override the map for this instance.
   */
  groupLabel?: string
  /**
   * Optional syntax highlighter. Receives the code text and language; returns
   * the full HTML for the code (replacing the default `<pre><code>` markup).
   */
  highlighter?: (code: string, lang: string | undefined) => string
}

interface GroupItem {
  block: CodeBlock
  language: string | undefined
  label: string
  selected: boolean
}

// `::: code-group` parses to an Admonition with kind `code-group` (typed div),
// while a bare `{.code-group}\n:::` parses to a Div carrying the class. Detect
// both so the extension matches carve-php's class-based behavior.
function isCodeGroup(node: BlockNode): node is Admonition | Div {
  if (node.type === 'admonition') return node.kind === 'code-group'
  if (node.type === 'div') return (node.attrs?.classes ?? []).includes('code-group')
  return false
}

function extraClasses(node: Admonition | Div): string[] {
  // Admonition: kind is the structural class; other classes come from attrs.
  // Div: the structural class is 'code-group'; keep the rest in order.
  const classes = node.attrs?.classes ?? []
  return classes.filter((c) => c !== 'code-group')
}

function extractItems(node: Admonition | Div): GroupItem[] {
  const items: GroupItem[] = []
  let position = 0
  for (const child of node.children) {
    if (child.type !== 'code_block') continue
    position++
    const cb = child as CodeBlock
    const language = cb.lang && cb.lang !== '' ? cb.lang : undefined
    const labelText = cb.label?.trim()
    const label = labelText && labelText !== '' ? labelText : (language ?? `Code ${position}`)
    const selected = cb.attrs?.keyValues?.selected !== undefined
    items.push({ block: cb, language, label, selected })
  }
  // EXACTLY ONE PANEL IS SELECTED (Extensions §13.5): the first one the
  // document marks, or the first block where it marks none. The SAME step the
  // Tabs renderer runs, because §13 binds both constructs.
  applySingleSelection(items)
  return items
}

/** Strip the internal `selected` attribute before rendering the code block. */
function withoutSelected(attrs: Attrs | undefined): Attrs | undefined {
  if (!attrs?.keyValues || attrs.keyValues.selected === undefined) return attrs
  const kv = { ...attrs.keyValues }
  delete kv.selected
  const out: Attrs = { ...attrs, keyValues: kv }
  if (attrs.order) out.order = attrs.order.filter((s) => s !== 'selected')
  return out
}

export function codeGroup(opts: CodeGroupOptions = {}): CarveExtension {
  const mode: TabsMode = resolveTabsMode(opts.mode, 'CodeGroup')
  const wrapperClass = opts.wrapperClass ?? 'code-group'
  // An author who wrote their own `role` / `aria-label` keeps it: a second one
  // beside theirs leaves the value undefined. HTML attribute names are
  // ASCII-case-insensitive, so the comparison is too.
  const authored = (node: Admonition | Div, name: string): boolean =>
    Object.keys(node.attrs?.keyValues ?? {}).some((k) => k.toLowerCase() === name)
  // The wrapper is a plain GROUP: the CSS mode has no tab/panel roles to
  // associate, so `group` is all it can honestly claim - and the name is the
  // half that was missing (carve#1468).
  const groupAttrs = (
    node: Admonition | Div,
    attrs: Attrs,
    groupLabel: string,
    role: string = 'group',
  ): void => {
    const writeRole = !authored(node, 'role')
    const writeName =
      groupLabel !== '' && !authored(node, 'aria-label') && !authored(node, 'aria-labelledby')
    if (!writeRole && !writeName) return
    attrs.keyValues = { ...(attrs.keyValues ?? {}) }
    if (writeRole) attrs.keyValues.role = role
    if (writeName) attrs.keyValues['aria-label'] = groupLabel
    // APPENDED: naming the group must not move an attribute the author placed,
    // so role/aria-label go at the END of the existing order.
    attrs.order = [
      ...(attrs.order ?? ['.class']).filter((x) => x !== 'role' && x !== 'aria-label'),
      ...(writeRole ? ['role'] : []),
      ...(writeName ? ['aria-label'] : []),
    ]
  }
  const panelClass = opts.panelClass ?? 'code-group-panel'
  const labelClass = opts.labelClass ?? 'code-group-label'
  const radioClass = opts.radioClass ?? 'code-group-radio'
  const idPrefix = opts.idPrefix ?? 'codegroup'
  const highlighter = opts.highlighter

  // Per-render group counter. Reset at the start of each document render via a
  // beforeRender hook so ids are deterministic and reset between conversions
  // (matching carve-php's clear()).
  let groupCounter = 0

  /** The wrapper's attributes, shared by both modes and the static render. */
  const wrapperAttrs = (node: Admonition | Div, ctx: BlockExtensionRenderContext, role?: string): Attrs => {
    // Wrapper attributes: wrapperClass first, then any extra classes the author
    // added (except 'code-group'), then non-class attributes.
    const classes = [wrapperClass, ...extraClasses(node).filter((c) => c !== wrapperClass)]
    const attrs: Attrs = { classes }
    if (node.attrs?.id !== undefined) attrs.id = node.attrs.id
    if (node.attrs?.keyValues) attrs.keyValues = { ...node.attrs.keyValues }
    attrs.order = ['.class', ...(node.attrs?.order ?? []).filter((s) => s !== '.class')]
    groupAttrs(node, attrs, opts.groupLabel ?? ctx.labels.codeGroup, role)
    return attrs
  }

  const renderGroup = (
    node: Admonition | Div,
    ctx: BlockExtensionRenderContext,
  ): string | undefined => {
    const items = extractItems(node)
    // No code blocks: defer to core div rendering (matches carve-php).
    if (items.length === 0) return undefined
    return mode === 'aria' ? renderGroupAria(node, items, ctx) : renderGroupCss(node, items, ctx)
  }

  const renderGroupCss = (
    node: Admonition | Div,
    items: GroupItem[],
    ctx: BlockExtensionRenderContext,
  ): string => {
    groupCounter++
    // Generated ids join the document id namespace (extensions contract §2.6).
    const groupId = ctx.uniqueId(`${idPrefix}-${groupCounter}`)
    const pad = ctx.indent(ctx.level)

    let html = `${pad}<div${ctx.renderAttrs(wrapperAttrs(node, ctx), 'div')}>\n`
    items.forEach((item, index) => {
      const inputId = ctx.uniqueId(`${groupId}-tab-${index + 1}`)
      const checked = item.selected ? ' checked' : ''
      html +=
        `<input type="radio" name="${ctx.escapeAttr(groupId)}" ` +
        `id="${ctx.escapeAttr(inputId)}" ` +
        `class="${ctx.escapeAttr(radioClass)}"${checked}>\n`
      html +=
        `<label for="${ctx.escapeAttr(inputId)}" ` +
        `class="${ctx.escapeAttr(labelClass)}">${ctx.escapeHtml(item.label)}</label>\n`
    })
    for (const item of items) {
      // PART 11 §13.2, the same treatment a `css` tabs panel gets and for the
      // same reason: under `css` nothing binds a panel to the radio that
      // reveals it. Keyed on the panel's OWN label - the tab name where one was
      // written, otherwise the language word, which is what `extractItems`
      // already resolved.
      html +=
        `<div class="${ctx.escapeAttr(panelClass)}" role="group" ` +
        `aria-label="${ctx.escapeAttr(item.label)}">`
      html += renderCodeBlock(item, ctx)
      html += '</div>\n'
    }
    html += `${pad}</div>`
    return html
  }

  /**
   * The `aria` mode, mirroring the Tabs renderer element for element.
   *
   * A `<button type="button" role="tab">` per panel (§13.3: without the `type`
   * a `<button>` submits the form it sits in), `role="tabpanel"` panels bound by
   * `aria-labelledby`, and `hidden` on every non-selected one. The panel takes
   * NEITHER `role="group"` NOR a name (§13.3): it is already bound, and naming
   * it as well would give one element two accessible names.
   */
  const renderGroupAria = (
    node: Admonition | Div,
    items: GroupItem[],
    ctx: BlockExtensionRenderContext,
  ): string => {
    groupCounter++
    const groupId = ctx.uniqueId(`${idPrefix}-${groupCounter}`)
    const pad = ctx.indent(ctx.level)
    // Both ids computed ONCE and reused across the two loops, so a bumped
    // generated id keeps the wiring consistent - the same reason Tabs does it.
    const pairIds = items.map((_item, index) => ({
      tab: ctx.uniqueId(`${groupId}-tab-${index + 1}`),
      panel: ctx.uniqueId(`${groupId}-panel-${index + 1}`),
    }))
    let html = `${pad}<div${ctx.renderAttrs(wrapperAttrs(node, ctx, 'tablist'), 'div')}>\n`
    items.forEach((item, index) => {
      const { tab: tabId, panel: panelId } = pairIds[index]!
      const selected = item.selected ? 'true' : 'false'
      const tabindex = item.selected ? '' : ' tabindex="-1"'
      // `type="button"`, NOT the implicit `submit` (Extensions §13.3). A bare
      // `<button>` is a submit button, so a code group inside a `<form>`
      // submitted the form instead of switching panels.
      html +=
        `<button type="button" role="tab" id="${ctx.escapeAttr(tabId)}" ` +
        `aria-selected="${selected}" ` +
        `aria-controls="${ctx.escapeAttr(panelId)}" ` +
        `class="${ctx.escapeAttr(labelClass)}"${tabindex}>${ctx.escapeHtml(item.label)}</button>\n`
    })
    items.forEach((item, index) => {
      const { tab: tabId, panel: panelId } = pairIds[index]!
      const hidden = item.selected ? '' : ' hidden'
      html +=
        `<div role="tabpanel" id="${ctx.escapeAttr(panelId)}" ` +
        `aria-labelledby="${ctx.escapeAttr(tabId)}" ` +
        `class="${ctx.escapeAttr(panelClass)}"${hidden}>`
      html += renderCodeBlock(item, ctx)
      html += '</div>\n'
    })
    html += `${pad}</div>`
    return html
  }

  const renderCodeBlock = (item: GroupItem, ctx: BlockExtensionRenderContext): string => {
    const content = item.block.content.replace(/\n+$/, '')
    if (highlighter) return highlighter(content, item.language)
    const langAttr = item.language ? ` class="language-${item.language}"` : ''
    const escaped = ctx.escapeHtml(item.block.content)
    return `<pre${ctx.renderAttrs(withoutSelected(item.block.attrs))}><code${langAttr}>${escaped}\n</code></pre>\n`
  }

  // Static render: each code panel as a `<section>` headed by its label, no
  // radios / JS. The label (the `[NPM]`-style tab name, or the language) stays
  // a visible heading so a reader offline can tell the panels apart.
  const renderGroupStatic = (
    node: Admonition | Div,
    ctx: BlockExtensionRenderContext,
  ): string | undefined => {
    const items = extractItems(node)
    if (items.length === 0) return undefined
    const pad = ctx.indent(ctx.level)
    const innerPad = ctx.indent(ctx.level + 1)
    // A static render takes NEITHER mode (§13.1): the set flattens to one
    // `<section>` per panel headed by its label, the heading IS the name, and
    // no interaction survives to bind. So the wrapper is the plain `group`.
    let html = `${pad}<div${ctx.renderAttrs(wrapperAttrs(node, ctx), 'div')}>\n`
    for (const item of items) {
      html += `${innerPad}<section class="${ctx.escapeAttr(panelClass)}">\n`
      html += `${innerPad}<h3 class="${ctx.escapeAttr(labelClass)}">${ctx.escapeHtml(item.label)}</h3>\n`
      html += renderCodeBlock(item, ctx)
      html += `${innerPad}</section>\n`
    }
    html += `${pad}</div>`
    return html
  }

  return {
    name: 'code-group',
    beforeRender(doc) {
      groupCounter = 0
      return doc
    },
    blockRenderers: {
      admonition: (node, ctx) =>
        isCodeGroup(node) ? renderGroup(node as Admonition, ctx) : undefined,
      div: (node, ctx) => (isCodeGroup(node) ? renderGroup(node as Div, ctx) : undefined),
    },
    staticBlockRenderers: {
      admonition: (node, ctx) =>
        isCodeGroup(node) ? renderGroupStatic(node as Admonition, ctx) : undefined,
      div: (node, ctx) => (isCodeGroup(node) ? renderGroupStatic(node as Div, ctx) : undefined),
    },
  }
}
