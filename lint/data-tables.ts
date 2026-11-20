// Generated from data/lint-model.json by lint/generate-data-tables.ts. Do not edit.
import { type RuleId } from './catalog.ts'
import { type ModelBlock, type ModelLine } from './data-model.ts'
import { type LintContext } from './types.ts'

let groups: Record<string, [number, number]> | undefined
let base = 0

const str = (value: unknown): string => (typeof value === 'string' ? value : '')
const num = (value: unknown): number => Number(value)
const same = (a: unknown, b: unknown): boolean => a === b
const trimEnd = (text: string): string => text.replace(/[ \t]+$/, '')
const test = (regex: RegExp, value: unknown): boolean => typeof value === 'string' && regex.test(value)
const starts = (value: unknown, prefix: string): boolean => typeof value === 'string' && value.startsWith(prefix)

function hit(regex: RegExp, value: unknown): boolean {
  if (typeof value !== 'string') return false
  const found = regex.exec(value)
  if (found === null) return false
  const spans: Record<string, [number, number]> = {}
  for (const [name, span] of Object.entries(found.indices?.groups ?? {})) if (span !== undefined) spans[name] = span
  groups = spans
  return true
}

function mark(at: number): boolean {
  base = at
  return true
}

function group(name: string, side: 0 | 1): number | undefined {
  const span = groups?.[name]
  return span === undefined ? undefined : base + span[side]
}

function contains(haystack: unknown, needle: unknown): boolean {
  if (Array.isArray(haystack)) return haystack.includes(needle)
  return typeof haystack === 'string' && typeof needle === 'string' && haystack.includes(needle)
}

function someFrom<T>(list: readonly T[] | undefined, from: number, where: (item: T) => boolean): boolean {
  if (!Array.isArray(list)) return false
  for (let at = from; at < list.length; at++) if (where(list[at] as T)) return true
  return false
}

const textFrom = (line: ModelLine, from: number): string => trimEnd(line.text.slice(from - line.start))

function scan(line: ModelLine, from: number, chars: string, step: -1 | 1): number {
  let at = from - line.start
  if (step < 0) while (at > 0 && chars.includes(line.text[at - 1]!)) at--
  else while (at < line.text.length && chars.includes(line.text[at]!)) at++
  return line.start + at
}

const K0 = new Set<unknown>(["admonition","directive","div","figure_group"])
const K1 = new Set<unknown>(["caption","paragraph"])
const K2 = new RegExp("^(?<mark>#{1,6}|={1,6}) ", "d")
const K3 = new RegExp("^(?<mark>>)(?: |$)", "d")
const K4 = new RegExp("^[ \t]*> ", "")
const K5 = new RegExp("^(?<mark>::) ", "d")
const K6 = new RegExp("^(?<mark>:) ", "d")
const K7 = new RegExp("^(?<mark>\\[.*?\\]:)", "d")
const K8 = new RegExp("^>[^ ]", "")
const K9 = new Set<unknown>(["caption","definition_term","heading","line","paragraph","table_cell"])
const K10 = new RegExp("^(?:\\*?\\s*(?:Caption|Table|Tabelle|Figure|Image)(?:\\s+\\d+)?\\s*:|:\\s+\\S)", "i")
const K11 = new Set<unknown>(["table_cell","table_row"])
const K12 = new RegExp("^\\*(?:[ \t]*\\*){2,}$", "")
const K13 = new RegExp("^-(?:[ \t]*-){2,}$", "")
const K14 = new RegExp("^_(?:[ \t]*_){2,}$", "")
const K15 = new RegExp("[ \t]", "")
const K16 = new Set<unknown>(["admonition","block_quote","code_block","definition_list","directive","div","figure_group","heading","line_block","raw_block","table","thematic_break"])
const K17 = new RegExp("^(?:-{3,}|_{3,})$", "")

function rule0(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  if (!(!same(self.owner?.["type"], "list_item") && !Boolean(self.after_quote_mark) && (num(self.column) > num(self.owner?.["content_column"])))) return
  context.report("block-opener-overindented", num(self.start), (num(self.start) + num((same(self.type, "definition_term") ? 2 : (K0.has(self.type) ? 3 : 1)))), path, { "kind": String((same(self.type, "block_quote") ? "quote" : (K0.has(self.type) ? "div" : str(self.type).replaceAll('_', ' ')))), "past": String((num(self.column) - num(self.owner?.["content_column"]))), "columns": String((same((num(self.column) - num(self.owner?.["content_column"])), 1) ? "column" : "columns")), "owner": String(str(self.owner?.["type"]).replaceAll('_', ' ')) }, 0)
  return
}

function rule1(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  if (!((self.prev !== undefined) && K1.has(self.leaf) && same(self.prev?.["leaf_id"], self.leaf_id) && !Boolean(self.prev?.["blank"]))) return
  if ((hit(K2, self.body) && mark(num(self.body_start)))) {
    context.report("block-opener-without-blank-line", num(group("mark", 0)), num(group("mark", 1)), path, { "opener": String("a heading") }, 0)
    return
  }
  if (((hit(K3, self.body) && mark(num(self.body_start))) && !(Boolean(self.quote_prefix) && test(K4, self.prev?.["text"]) && contains(self.ancestors, "block_quote")))) {
    context.report("block-opener-without-blank-line", num(group("mark", 0)), num(group("mark", 1)), path, { "opener": String("a quote") }, 0)
    return
  }
  if ((hit(K5, self.body) && mark(num(self.body_start)))) {
    context.report("block-opener-without-blank-line", num(group("mark", 0)), num(group("mark", 1)), path, { "opener": String("a term") }, 0)
    return
  }
  if ((hit(K6, self.body) && mark(num(self.body_start)))) {
    context.report("block-opener-without-blank-line", num(group("mark", 0)), num(group("mark", 1)), path, { "opener": String("a description") }, 0)
    return
  }
  if (same(self.shape, "attribute_line")) {
    context.report("block-opener-without-blank-line", num(self.body_start), num(self.body_end), path, { "opener": String("an attribute line") }, 0)
    return
  }
  if (((hit(K7, self.body) && mark(num(self.body_start))) && !contains(self.ancestors, "footnote"))) {
    context.report("block-opener-without-blank-line", num(group("mark", 0)), num(group("mark", 1)), path, { "opener": String("a definition") }, 0)
    return
  }
}

function rule2(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  if (!test(K8, self.text)) return
  if (K9.has(self.leaf)) {
    context.report("blockquote-marker-without-space", num(self.start), (num(self.start) + trimEnd(str(self.text)).length), path, { "text": String(trimEnd(str(self.text)).slice(1)) }, 0)
    return
  }
  if (same(self.leaf, "frontmatter")) {
    context.report("blockquote-marker-without-space", num(self.start), (num(self.start) + 1), path, { "text": String(str(self.text).slice(1)) }, 1)
    return
  }
}

function rule3(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  if (!(same(self.leaf, "paragraph") && test(K10, self.body))) return
  if ((K11.has(self.next?.["leaf"]) || K11.has(self.next2?.["leaf"]))) {
    context.report("caption-looking-paragraph", num(self.body_start), (num(self.body_start) + 1), path, {  }, 0)
    return
  }
  if ((K11.has(self.prev?.["leaf"]) || K11.has(self.prev2?.["leaf"]) || contains(self.prev?.["text"], "![") || contains(self.prev2?.["text"], "!["))) {
    context.report("caption-looking-paragraph", num(self.body_start), (num(self.body_start) + 1), path, {  }, 1)
    return
  }
}

function rule4(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  if (!(same(self.shape, "div_bare_run") && (self.open_colon?.[0] !== undefined) && !same(self.open_colon?.[0]?.["width"], str(self.body).length))) return
  if ((str(self.body).length > num(self.open_colon?.[0]?.["width"]))) {
    context.report("colon-fence-length-mismatch", num(self.body_start), num(self.body_end), path, { "authoredWidth": String(str(self.body).length), "expectedWidth": String(self.open_colon?.[0]?.["width"]), "kind": String(self.open_colon?.[0]?.["kind"]), "line": String(self.open_colon?.[0]?.["line"]), "column": String(self.open_colon?.[0]?.["column"]) }, 2)
    return
  }
  if (someFrom(self.open_colon, 1, (item) => (num(item?.["width"]) <= str(self.body).length))) {
    context.report("colon-fence-length-mismatch", num(self.body_start), num(self.body_end), path, { "authoredWidth": String(str(self.body).length), "expectedWidth": String(self.open_colon?.[0]?.["width"]), "kind": String(self.open_colon?.[0]?.["kind"]), "line": String(self.open_colon?.[0]?.["line"]), "column": String(self.open_colon?.[0]?.["column"]) }, 1)
    return
  }
  context.report("colon-fence-length-mismatch", num(self.body_start), num(self.body_end), path, { "authoredWidth": String(str(self.body).length), "expectedWidth": String(self.open_colon?.[0]?.["width"]), "kind": String(self.open_colon?.[0]?.["kind"]), "line": String(self.open_colon?.[0]?.["line"]), "column": String(self.open_colon?.[0]?.["column"]) }, 0)
  return
}

function rule5(self: ModelLine, path: string, context: LintContext): void {
  const line = self
  groups = undefined
  const v_run_start = scan(line, scan(line, num(self.body_start), (" \t" + str(self.body).slice(0, 1)), -1), " \t", 1)
  if (!((test(K12, textFrom(line, num(v_run_start))) || test(K13, textFrom(line, num(v_run_start))) || test(K14, textFrom(line, num(v_run_start)))) && test(K15, textFrom(line, num(v_run_start))))) return
  context.report("deprecated-spaced-thematic-break", num(v_run_start), num(self.body_end), path, {  }, 0)
  return
}

function rule6(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  if (!(same(self.parent?.["type"], "list_item") && (K16.has(self.type) || Boolean(self.image_line) || Boolean(self.attributed)) && (num(self.opener_column) > num(self.parent?.["content_column"])))) return
  context.report("list-item-block-overindented", num(self.start), num(self.line?.["end"]), path, { "contentColumn": String((num(self.parent?.["content_column"]) + 1)) }, 0)
  return
}

function rule7(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  if (!(same(self.parent?.["type"], "list_item") && (num(self.index) >= 1) && (num(self.column) > num(self.parent?.["marker_column"])) && (num(self.column) < num(self.parent?.["content_column"])))) return
  context.report("list-item-body-below-content-column", num(self.start), num(self.line?.["end"]), path, {  }, 0)
  return
}

function rule8(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  if (!(test(K17, self.body) && !(starts(self.body, "-") && same(self.prev?.["leaf"], "paragraph") && !Boolean(self.prev?.["blank"])) && !(same(self.number, 1) && same(self.body_start, self.start) && same(self.body, "---")))) return
  context.report("thematic-break-spelling", num(self.body_start), num(self.body_end), path, { "raw": String(self.body) }, 0)
  return
}

function rule9(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  if (!(same(self.leaf, "paragraph") && Boolean(self.leaf_first) && same(self.shape, "attribute_line") && !Boolean(self.attached_here) && (!(self.leaf_next !== undefined) || Boolean(self.leaf_next?.["blank"]) || Boolean(self.leaf_next?.["closes_container"]) || !same(self.leaf_next?.["leaf_id"], self.leaf_id)))) return
  if (Boolean(self.leaf_next?.["blank"])) {
    context.report("unattached-block-attribute", num(self.body_start), num(self.body_end), path, {  }, 1)
    return
  }
  context.report("unattached-block-attribute", num(self.body_start), num(self.body_end), path, {  }, 0)
  return
}

export type DataRule =
  | { id: RuleId, over: 'line', types: undefined, verbatim: ReadonlySet<string>, run: (self: ModelLine, path: string, context: LintContext) => void }
  | { id: RuleId, over: 'block', types: readonly string[] | undefined, verbatim: ReadonlySet<string>, run: (self: ModelBlock, path: string, context: LintContext) => void }

export const VERBATIM_LEAVES: ReadonlySet<string> = new Set(["code_block","comment_block","frontmatter","raw_block"])

export const DATA_RULES: readonly DataRule[] = [
  { id: "block-opener-overindented", over: "block", types: ["admonition","block_quote","code_block","definition_term","directive","div","figure_group","heading","line_block","raw_block","table","thematic_break"], verbatim: new Set([]), run: rule0 },
  { id: "block-opener-without-blank-line", over: "line", types: undefined, verbatim: new Set([]), run: rule1 },
  { id: "blockquote-marker-without-space", over: "line", types: undefined, verbatim: new Set(["frontmatter"]), run: rule2 },
  { id: "caption-looking-paragraph", over: "line", types: undefined, verbatim: new Set([]), run: rule3 },
  { id: "colon-fence-length-mismatch", over: "line", types: undefined, verbatim: new Set([]), run: rule4 },
  { id: "deprecated-spaced-thematic-break", over: "line", types: undefined, verbatim: new Set([]), run: rule5 },
  { id: "list-item-block-overindented", over: "block", types: undefined, verbatim: new Set([]), run: rule6 },
  { id: "list-item-body-below-content-column", over: "block", types: undefined, verbatim: new Set([]), run: rule7 },
  { id: "thematic-break-spelling", over: "line", types: undefined, verbatim: new Set([]), run: rule8 },
  { id: "unattached-block-attribute", over: "line", types: undefined, verbatim: new Set([]), run: rule9 },
]
