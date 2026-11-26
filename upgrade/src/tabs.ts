// C2-X-056: a 0.2 tab takes its label only from a nonempty quoted title, while the 0.1 `tabs()`
// extension read the bracket label, then a `label` attribute, then a first heading.
import map from '../../data/upgrade-map.json' with { type: 'json' }
import { carveToHtml, tabs as tabs01 } from '../../build/engine-0.1/index.js'
import { render, tabsExtensions, tabsRenderer } from '../../src/index.ts'
import { compareHtmlExact, htmlTokens } from './compare.ts'
import { applyEdits, type Edit } from './edits.ts'
import { type Node01, parse01 } from './engines.ts'
import { recordOf, type ReportRecord } from './report.ts'
import { lineEnd, lineOf, lineStart, readLines } from './source.ts'

export interface TabsPlan {
  edits: Edit[]
  /** One rewrite record per rewritten tab. */
  rewrites: ReportRecord[]
  records: ReportRecord[]
}

const MEANING = new Map(map.source.map((row) => [row.id, row.meaning02]))
const PUNCTUATION = /[!-/:-@[-`{-~]/gu
const SOLE_LABEL = /^\{[ \t]*label=("[^"\n]*"|[^\s"{}]+)[ \t]*\}[ \t]*$/u

function meaning(id: string): string { return MEANING.get(id) ?? '' }

function classes(node: Node01): string[] {
  const value = (node.attrs as { classes?: unknown } | undefined)?.classes
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function keyValues(node: Node01): Record<string, string> {
  const value = (node.attrs as { keyValues?: unknown } | undefined)?.keyValues
  return typeof value === 'object' && value !== null ? value as Record<string, string> : {}
}

function isGroup(node: Node01): boolean {
  return node.type === 'admonition' ? node['kind'] === 'tabs' : node.type === 'div' && classes(node).includes('tabs')
}

function isTab(node: Node01): boolean {
  return node.type === 'admonition' ? node['kind'] === 'tab' : node.type === 'div' && classes(node).includes('tab')
}

function groups(node: Node01, found: Node01[]): void {
  for (const value of Object.values(node)) {
    if (!Array.isArray(value)) continue
    for (const child of value as unknown[]) {
      if (typeof child !== 'object' || child === null || typeof (child as Node01).type !== 'string') continue
      if (isGroup(child as Node01)) found.push(child as Node01)
      groups(child as Node01, found)
    }
  }
}

function rangeOf(node: Node01): { startOffset: number; endOffset: number } {
  return { startOffset: node.pos!.startOffset, endOffset: node.pos!.endOffset }
}

function report(id: string, src: string, node: Node01, message = meaning(id)): ReportRecord {
  // A rewrite row that could not rewrite this tab still needs a person.
  return { ...recordOf(id, lineOf(readLines(src), node.pos!.startOffset), message), class: 'report', range: rangeOf(node) }
}

function unmapped(src: string, node: Node01, message: string): ReportRecord {
  return { entry: 'upgrade-mismatch', class: 'mismatch', status: 'no mapped row', range: rangeOf(node),
    line: lineOf(readLines(src), node.pos!.startOffset), message }
}

/** The 0.2 quoted title whose plain reading is `label`, or null when no spelling keeps it. */
function quotedTitle(label: string): string | null {
  for (const spelled of [label, label.replace(PUNCTUATION, (mark) => `\\${mark}`)]) {
    const probe = `:::: tabs\n::: tab "${spelled}"\nx\n:::\n::::\n`
    if (sameHost(probe.replace(`"${spelled}"`, `[${label}]`), probe)) return `"${spelled}"`
  }
  return null
}

/** The opener line of `tab` from its own column, and where it starts. */
function opener(src: string, tab: Node01): { start: number; text: string } {
  const lines = readLines(src)
  const start = tab.pos!.startOffset
  return { start, text: src.slice(start, lineEnd(lines, lineOf(lines, start))) }
}

/** The bracket label of a 0.1 tab opener becomes its quoted title (U-412). */
function bracketEdit(src: string, tab: Node01, label: string, sequence: number): Edit | null {
  const line = opener(src, tab)
  const match = /^(:{3,}[ \t]+tab[ \t]+)\[(.*)\][ \t]*$/u.exec(line.text)
  if (match?.[2] !== label) return null
  const title = quotedTitle(label)
  if (title === null) return null
  const start = line.start + match[1]!.length
  return { start, end: line.start + line.text.trimEnd().length, text: title, entry: 'U-412', sequence }
}

/** A line of only `{label=...}` above a bare `tab` opener moves into the opener (U-413). */
function labelEdits(src: string, tab: Node01, label: string, sequence: number): Edit[] | null {
  const lines = readLines(src)
  const at = lineOf(lines, tab.pos!.startOffset)
  if (at < 2) return null
  const attrStart = lineStart(lines, at - 1)
  const attrLine = src.slice(attrStart, lineEnd(lines, at - 1))
  const prefix = src.slice(lineStart(lines, at), tab.pos!.startOffset)
  if (!attrLine.startsWith(prefix) || !SOLE_LABEL.test(attrLine.slice(prefix.length))) return null
  const line = opener(src, tab)
  const match = /^(:{3,}[ \t]+tab)[ \t]*$/u.exec(line.text)
  const title = quotedTitle(label)
  if (match === null || title === null) return null
  const end = line.start + match[1]!.length
  return [
    { start: attrStart, end: lineStart(lines, at), text: '', entry: 'U-413', sequence },
    { start: end, end: line.start + line.text.length, text: ` ${title}`, entry: 'U-413', sequence: sequence + 1 },
  ]
}

function hasHeading(tab: Node01): boolean {
  return (tab.children ?? []).some((child) => child.type === 'heading')
}

function rewritten(src: string, id: string, tab: Node01): ReportRecord {
  return recordOf(id, lineOf(readLines(src), tab.pos!.startOffset), meaning(id))
}

function planTab(src: string, tab: Node01, plan: TabsPlan, rewrite: boolean): void {
  const label = typeof tab['label'] === 'string' ? tab['label'] : undefined
  const attribute = keyValues(tab)['label']
  const sequence = plan.edits.length
  if (tab['title'] !== undefined) {
    plan.records.push(report('U-412', src, tab,
      'a quoted title of a 0.1 tab is panel content; in 0.2 it is the tab label (C2-X-040, C2-X-056)'))
    return
  }
  if (label !== undefined) {
    const edit = rewrite ? bracketEdit(src, tab, label, sequence) : null
    if (edit === null) plan.records.push(report('U-412', src, tab))
    else {
      plan.edits.push(edit)
      plan.rewrites.push(rewritten(src, 'U-412', tab))
    }
    return
  }
  if (attribute !== undefined) {
    const edits = rewrite ? labelEdits(src, tab, attribute, sequence) : null
    if (edits === null) plan.records.push(report('U-413', src, tab))
    else {
      plan.edits.push(...edits)
      plan.rewrites.push(rewritten(src, 'U-413', tab))
    }
    return
  }
  plan.records.push(report(hasHeading(tab) ? 'U-414' : 'U-415', src, tab))
}

/** What the 0.1 tabs groups of `src` need: opener edits and the reports of C2-X-056. Without `rewrite` every tab is reported. */
export function planTabs(src: string, rewrite = true): TabsPlan {
  const plan: TabsPlan = { edits: [], rewrites: [], records: [] }
  if (!src.includes('tabs')) return plan
  const found: Node01[] = []
  groups(parse01(src), found)
  for (const group of found) {
    if (group.type === 'div') {
      plan.records.push(unmapped(src, group, 'a tabs group written as a `tabs` class is not claimed by the 0.2 tabs '
        + 'extension, which matches the div name `tabs` (C2-X-039)'))
      continue
    }
    if (classes(group).length > 0) plan.records.push(report('U-417', src, group))
    for (const child of group.children ?? []) {
      if (!isTab(child)) {
        plan.records.push(unmapped(src, child, 'a block of a 0.1 tabs group that is not a tab was left out under the '
          + 'tabs host; in 0.2 it keeps the whole group from being tabs (C2-X-039)'))
      } else if (child.type === 'div') {
        plan.records.push(unmapped(src, child, 'a tab written as a `tab` class is not claimed by the 0.2 tabs extension, '
          + 'which matches the div name `tab` (C2-X-039)'))
      } else planTab(src, child, plan, rewrite)
    }
  }
  // A nested group is planned after its outer group, so its edits come later in the list.
  plan.edits.sort((a, b) => a.start - b.start || a.sequence - b.sequence)
  return plan
}

function host01(src: string): string {
  return carveToHtml(src, { extensions: [tabs01()], mode: 'static' } as Parameters<typeof carveToHtml>[1])
}

function host02(src: string): string {
  return render(src, { extensions: tabsExtensions, renderers: { 'carve.tabs': tabsRenderer }, mode: 'static' })
}

/** The static tabs groups of `html`, each as its token text. */
function staticGroups(html: string): string[] {
  const tokens = htmlTokens(html)
  const found: string[] = []
  for (let at = 0; at < tokens.length; at++) {
    const token = tokens[at]!
    if (!token.startsWith('<div ') || !token.includes(' class="tabs"') || !token.includes(' role="group"')) continue
    let depth = 0
    let end = at
    for (; end < tokens.length; end++) {
      if (tokens[end]!.startsWith('<div')) depth++
      else if (tokens[end] === '</div>' && --depth === 0) break
    }
    found.push(tokens.slice(at, end + 1).join(''))
    at = end
  }
  return found
}

/** Under both tabs hosts in static mode, the 0.1 source and the 0.2 source write the same groups. */
export function sameHost(old: string, next: string): boolean {
  try {
    const a = staticGroups(host01(old))
    const b = staticGroups(host02(next))
    return a.length > 0 && a.length === b.length && a.every((group, index) => compareHtmlExact(group, b[index]!).equal)
  } catch { return false }
}

export function applyTabs(src: string, plan: TabsPlan): string {
  return applyEdits(src, plan.edits)
}
