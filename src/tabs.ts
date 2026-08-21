import type { Admonition, Attrs, BlockNode, Div, Heading } from './ast.js'
import { inlineText } from './heading-ids.js'
import type { BlockExtensionRenderContext, CarveExtension } from './extension.js'

/** Output mode for {@link tabs}: CSS-only radios or ARIA roles + JS. */
export type TabsMode = 'css' | 'aria'

/** Options for the {@link tabs} extension. */
export interface TabsOptions {
  /** `'css'` (default, no JS) or `'aria'` (semantic roles, requires JS). */
  mode?: TabsMode
  /** CSS class on the tabs container. Default `'tabs'`. */
  wrapperClass?: string
  /** CSS class on each tab panel. Default `'tabs-panel'`. */
  tabClass?: string
  /** CSS class on each tab label/button. Default `'tabs-label'`. */
  labelClass?: string
  /** CSS class on each radio input (CSS mode only). Default `'tabs-radio'`. */
  radioClass?: string
  /** Prefix for generated ids. Default `'tabset'`. */
  idPrefix?: string
  /**
   * Accessible name for the tab set AS A WHOLE.
   *
   * Each tab was already named by its own `<label>`; the GROUP was anonymous,
   * so a reader could hear the parts and never the thing they belong to
   * (carve#1468). Left unset the string comes from the render's `labels` map
   * under `tabsGroup` (default `'Tabs'`), so one map localizes the whole
   * document; set here to override the map for this instance.
   */
  groupLabel?: string
}

interface TabItem {
  label: string
  content: string
  selected: boolean
  id: string | undefined
}

// `:::: tabs` parses to an Admonition with kind `tabs`; a bare `{.tabs}\n::::`
// parses to a Div carrying the class. Likewise each `::: tab` child is an
// Admonition kind `tab` or a Div with class `tab`. Detect both for parity with
// carve-php's class-based matching.
function isTabs(node: BlockNode): node is Admonition | Div {
  if (node.type === 'admonition') return node.kind === 'tabs'
  if (node.type === 'div') return (node.attrs?.classes ?? []).includes('tabs')
  return false
}

function isTab(node: BlockNode): node is Admonition | Div {
  if (node.type === 'admonition') return node.kind === 'tab'
  if (node.type === 'div') return (node.attrs?.classes ?? []).includes('tab')
  return false
}

function extraClasses(node: Admonition | Div, structural: string): string[] {
  return (node.attrs?.classes ?? []).filter((c) => c !== structural)
}

/**
 * The two values `mode` takes, in both extensions.
 *
 * PART 11 §13.1: `css` is the default and an implementation MUST NOT ship
 * `aria` as the default. The reason is §2.5 rather than compatibility - content
 * is never dropped, only interaction - and `aria` reveals with `hidden`, so a
 * page that registers it and ships no script loses every panel but the first.
 */
const TAB_MODES: readonly TabsMode[] = ['css', 'aria']

/**
 * Resolve a `mode` option, REFUSING a value that is neither.
 *
 * §13.1 requires the refusal for the reason §2.5 gives about render modes: a
 * guess turns a typo into silently different output. `tabs({ mode: 'aira' })`
 * used to render the CSS mode, because the test was `=== 'aria'` and every
 * other string fell through to the default (carve-js#1265).
 */
export function resolveTabsMode(mode: TabsMode | undefined, extension: string): TabsMode {
  if (mode === undefined) return 'css'
  if (!TAB_MODES.includes(mode)) {
    throw new Error(`Invalid ${extension} mode "${mode}"; expected one of: ${TAB_MODES.join(', ')}.`)
  }
  return mode
}

export function tabs(opts: TabsOptions = {}): CarveExtension {
  const mode: TabsMode = resolveTabsMode(opts.mode, 'Tabs')
  const wrapperClass = opts.wrapperClass ?? 'tabs'
  const tabClass = opts.tabClass ?? 'tabs-panel'
  const labelClass = opts.labelClass ?? 'tabs-label'
  const radioClass = opts.radioClass ?? 'tabs-radio'
  const idPrefix = opts.idPrefix ?? 'tabset'

  // Per-document counters, reset in beforeRender (matches carve-php clear()).
  let tabSetCounter = 0
  let labelCounter = 0

  // An explicit label is the opener `[label]` (canonical) or a `{label="..."}`
  // attribute (deprecated). When present, an inner heading stays as content.
  const explicitLabel = (tab: Admonition | Div): string | undefined =>
    tab.label ?? tab.attrs?.keyValues?.label

  const extractLabel = (tab: Admonition | Div): string => {
    const label = explicitLabel(tab)
    if (label !== undefined) return label
    for (const child of tab.children) {
      if (child.type === 'heading') return inlineText((child as Heading).children)
    }
    return `Tab ${++labelCounter}`
  }

  const renderTabContent = (tab: Admonition | Div, ctx: BlockExtensionRenderContext): string => {
    const skipFirstHeading = explicitLabel(tab) === undefined
    let skipped = false
    let html = ''
    // The quoted opener title is CONTENT, not the tab name (that's the
    // [label]'s job): it stays inside the panel as the same admonition-title
    // line core would emit. Without this the title vanished from the output.
    const title = tab.type === 'admonition' ? tab.title : undefined
    if (title !== undefined) {
      html += `<p class="admonition-title">${ctx.renderInlines(title)}</p>\n`
    }
    for (const child of tab.children) {
      if (skipFirstHeading && !skipped && child.type === 'heading') {
        skipped = true
        continue
      }
      // Render each child as a top-level fragment (level 0) and end with a
      // newline, matching carve-php's renderNodeFragment concatenation.
      const fragment = ctx.renderChildren([child], 0)
      if (fragment !== '') html += `${fragment}\n`
    }
    return html
  }

  const collectTabs = (
    wrapper: Admonition | Div,
    ctx: BlockExtensionRenderContext,
  ): TabItem[] => {
    const items: TabItem[] = []
    for (const child of wrapper.children) {
      if (!isTab(child)) continue
      const tab = child as Admonition | Div
      items.push({
        label: extractLabel(tab),
        content: renderTabContent(tab, ctx),
        selected: tab.attrs?.keyValues?.selected !== undefined,
        id: tab.attrs?.id,
      })
    }
    if (items.length && !items.some((i) => i.selected)) items[0]!.selected = true
    return items
  }

  // The wrapper's role defaults to `group` - a plain grouping, which is all the
  // CSS mode can honestly claim, since it has no tab/panel roles to associate.
  // The `aria` mode passes `tablist` instead. Either way the wrapper takes an
  // accessible NAME, which is the half that was missing (carve#1468).
  //
  // An author who wrote their own `role` or `aria-label` on the block keeps it:
  // a second one beside theirs leaves the value undefined, and theirs is the
  // more specific statement. Attribute names are compared ASCII-case-insensitively
  // because HTML attribute names are.
  const authored = (wrapper: Admonition | Div, name: string): boolean =>
    Object.keys(wrapper.attrs?.keyValues ?? {}).some((k) => k.toLowerCase() === name)

  const buildWrapperAttributes = (
    wrapper: Admonition | Div,
    ctx: BlockExtensionRenderContext,
    role = 'group',
  ): string => {
    const classes = [
      wrapperClass,
      ...extraClasses(wrapper, 'tabs').filter((c) => c !== wrapperClass),
    ]
    const attrs: Attrs = { classes }
    const id = wrapper.attrs?.id
    if (id !== undefined) attrs.id = id
    // Precedence: the extension's own option, then the render's `labels` map.
    const groupLabel = opts.groupLabel ?? ctx.labels.tabsGroup
    const writeRole = !authored(wrapper, 'role')
    const writeName = groupLabel !== '' && !authored(wrapper, 'aria-label') && !authored(wrapper, 'aria-labelledby')
    if (wrapper.attrs?.keyValues || writeRole || writeName) {
      attrs.keyValues = { ...(wrapper.attrs?.keyValues ?? {}) }
      if (writeRole) attrs.keyValues.role = role
      if (writeName) attrs.keyValues['aria-label'] = groupLabel
    }
    const authorOrder = (wrapper.attrs?.order ?? []).filter((s) => s !== '.class')
    // APPENDED: naming the set must not move an attribute the author placed.
    attrs.order = [
      '.class',
      ...authorOrder.filter((s) => s !== 'role' && s !== 'aria-label'),
      ...(writeRole ? ['role'] : []),
      ...(writeName ? ['aria-label'] : []),
    ]
    return ctx.renderAttrs(attrs)
  }

  const renderCss = (
    wrapper: Admonition | Div,
    items: TabItem[],
    ctx: BlockExtensionRenderContext,
  ): string => {
    tabSetCounter++
    // Generated ids join the document id namespace (extensions contract §2.6):
    // an explicit {#tabset-1} or a colliding heading slug bumps these.
    const setId = ctx.uniqueId(`${idPrefix}-${tabSetCounter}`)
    const pad = ctx.indent(ctx.level)
    let html = `${pad}<div${buildWrapperAttributes(wrapper, ctx)}>\n`
    items.forEach((tab, index) => {
      const inputId = tab.id ?? ctx.uniqueId(`${setId}-tab-${index + 1}`)
      const checked = tab.selected ? ' checked' : ''
      html +=
        `<input type="radio" name="${ctx.escapeAttr(setId)}" ` +
        `id="${ctx.escapeAttr(inputId)}"` +
        ` class="${ctx.escapeAttr(radioClass)}"${checked}>\n`
      html +=
        `<label for="${ctx.escapeAttr(inputId)}" ` +
        `class="${ctx.escapeAttr(labelClass)}">${ctx.escapeHtml(tab.label)}</label>\n`
    })
    for (const tab of items) {
      // NAMED, because nothing else names it. Under `css` there are no tab
      // roles: all radios and labels are emitted before all panels, so a panel
      // is not bound to the control that reveals it and carries no name of its
      // own. PART 11 §13.2 gives it both.
      //
      // `role="group"` and not `role="tabpanel"` - the control revealing this
      // panel is a `radio`, not a `tab`, and `group` is all the CSS mode can
      // honestly claim. Not a `<section>` either: one landmark per panel is N
      // landmarks per tab set. And not a bare `aria-labelledby`, because ARIA
      // marks both naming attributes prohibited on role `generic` and the
      // `<label>` elements carry `for=`, not `id=`.
      //
      // The name is the tab's own label, so it is DERIVED from the document and
      // gets no `labels` key (§1.5) - an author renames a panel by renaming its
      // tab. ATTRIBUTE-escaped, which differs from the `<label>` element's own
      // escaping on the quote characters.
      html +=
        `<div class="${ctx.escapeAttr(tabClass)}" role="group" ` +
        `aria-label="${ctx.escapeAttr(tab.label)}">\n${tab.content}</div>\n`
    }
    html += `${pad}</div>`
    return html
  }

  const renderAria = (
    wrapper: Admonition | Div,
    items: TabItem[],
    ctx: BlockExtensionRenderContext,
  ): string => {
    tabSetCounter++
    const setId = ctx.uniqueId(`${idPrefix}-${tabSetCounter}`)
    const pad = ctx.indent(ctx.level)
    // Compute each tab/panel id pair ONCE and reuse in both render loops, so a
    // bumped generated id keeps the ARIA wiring consistent (carve-php parity).
    const pairIds = items.map((tab, index) => {
      const num = index + 1
      return {
        tab: tab.id ? `${ctx.escapeAttr(tab.id)}-tab` : ctx.uniqueId(`${setId}-tab-${num}`),
        panel: tab.id ? `${ctx.escapeAttr(tab.id)}-panel` : ctx.uniqueId(`${setId}-panel-${num}`),
      }
    })
    let html = `${pad}<div${buildWrapperAttributes(wrapper, ctx, 'tablist')}>\n`
    items.forEach((tab, index) => {
      const tabId = pairIds[index]!.tab
      const panelId = pairIds[index]!.panel
      const selected = tab.selected ? 'true' : 'false'
      const tabindex = tab.selected ? '' : ' tabindex="-1"'
      html +=
        `<button role="tab" id="${tabId}" ` +
        `aria-selected="${selected}" ` +
        `aria-controls="${panelId}" ` +
        `class="${ctx.escapeAttr(labelClass)}"${tabindex}>${ctx.escapeHtml(tab.label)}</button>\n`
    })
    items.forEach((tab, index) => {
      const tabId = pairIds[index]!.tab
      const panelId = pairIds[index]!.panel
      const hidden = tab.selected ? '' : ' hidden'
      // NEITHER `role="group"` NOR A NAME, and that is a rule rather than an
      // omission (PART 11 §13.3). The panel is already bound to its
      // `<button role="tab">` by `aria-labelledby`, so naming it as well would
      // give one element two accessible names and pull it out of the `tablist`
      // relationship that is the only reason to be in this mode. §13.2's rule
      // is a `css`-mode rule specifically, not "every panel gets a name".
      html +=
        `<div role="tabpanel" id="${panelId}" ` +
        `aria-labelledby="${tabId}" ` +
        `class="${ctx.escapeAttr(tabClass)}"${hidden}>\n${tab.content}</div>\n`
    })
    html += `${pad}</div>`
    return html
  }

  const renderTabs = (
    node: Admonition | Div,
    ctx: BlockExtensionRenderContext,
  ): string | undefined => {
    const items = collectTabs(node, ctx)
    // No tab children: defer to core div rendering (matches carve-php).
    if (items.length === 0) return undefined
    return mode === 'aria' ? renderAria(node, items, ctx) : renderCss(node, items, ctx)
  }

  // Static (non-interactive) render: every panel is shown in sequence as a
  // `<section>` headed by its `[label]` (graceful-degradation rule). No radios,
  // no JS - the labels survive as visible headings so a reader of the PDF / the
  // archival page can tell the panels apart.
  const renderTabsStatic = (
    node: Admonition | Div,
    ctx: BlockExtensionRenderContext,
  ): string | undefined => {
    const items = collectTabs(node, ctx)
    if (items.length === 0) return undefined
    const pad = ctx.indent(ctx.level)
    const innerPad = ctx.indent(ctx.level + 1)
    let html = `${pad}<div${buildWrapperAttributes(node, ctx)}>\n`
    for (const tab of items) {
      html += `${innerPad}<section class="${ctx.escapeAttr(tabClass)}">\n`
      html += `${innerPad}<h3 class="${ctx.escapeAttr(labelClass)}">${ctx.escapeHtml(tab.label)}</h3>\n`
      html += tab.content
      html += `${innerPad}</section>\n`
    }
    html += `${pad}</div>`
    return html
  }

  return {
    name: 'tabs',
    beforeRender(doc) {
      tabSetCounter = 0
      labelCounter = 0
      return doc
    },
    blockRenderers: {
      admonition: (node, ctx) => (isTabs(node) ? renderTabs(node as Admonition, ctx) : undefined),
      div: (node, ctx) => (isTabs(node) ? renderTabs(node as Div, ctx) : undefined),
    },
    staticBlockRenderers: {
      admonition: (node, ctx) =>
        isTabs(node) ? renderTabsStatic(node as Admonition, ctx) : undefined,
      div: (node, ctx) => (isTabs(node) ? renderTabsStatic(node as Div, ctx) : undefined),
    },
  }
}
