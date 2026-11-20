// Generated from data/lint-model.json by lint/generate-data-tables.ts. Do not edit.
import { type RuleId } from './catalog.ts'
import { type ModelBlock, type ModelInline, type ModelLine } from './data-model.ts'
import { type LintContext } from './types.ts'

let groups: Record<string, [number, number]> | undefined
let base = 0

const str = (value: unknown): string => (typeof value === 'string' ? value : '')
const num = (value: unknown): number => Number(value)
const same = (a: unknown, b: unknown): boolean => a === b
const trimEnd = (text: string): string => text.replace(/[ \t]+$/, '')
const test = (regex: RegExp, value: unknown): boolean => typeof value === 'string' && regex.test(value)
const starts = (value: unknown, prefix: string): boolean => typeof value === 'string' && value.startsWith(prefix)

function spansOf(found: RegExpExecArray | RegExpMatchArray): Record<string, [number, number]> {
  const spans: Record<string, [number, number]> = {}
  for (const [name, span] of Object.entries(found.indices?.groups ?? {})) if (span !== undefined) spans[name] = span
  return spans
}

function hit(regex: RegExp, value: unknown): boolean {
  if (typeof value !== 'string') return false
  const found = regex.exec(value)
  if (found === null) return false
  groups = spansOf(found)
  return true
}

const matchAll = (regex: RegExp, value: unknown): RegExpStringIterator<RegExpExecArray> | [] =>
  (typeof value === 'string' ? value.matchAll(regex) : [])

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

const K0 = new Set<unknown>(["heading","paragraph"])
const K1 = new Set<unknown>(["table_cell","table_row"])
const K2 = new RegExp("^(?:[^<]|<!--.*?-->|<[^!<A-Za-z/]|<[A-Za-z/]|<<|<!(?:[^-]|$)|<!-(?:[^-]|$)|<$)*?<*(?<tag></?[A-Za-z][A-Za-z0-9_:-]*(?:\\s[^<>]*)?/?>)", "d")
const K3 = new RegExp("(?<label>\\[(?<caret>\\^)?[ \\t\\n]+\\])", "gd")
const K4 = new Set<unknown>(["admonition","directive","div","figure_group"])
const K5 = new Set<unknown>(["caption","paragraph"])
const K6 = new RegExp("^(?<mark>#{1,6}|={1,6}) ", "d")
const K7 = new RegExp("^(?<mark>>)(?: |$)", "d")
const K8 = new RegExp("^[ \t]*> ", "")
const K9 = new RegExp("^(?<mark>::) ", "d")
const K10 = new RegExp("^(?<mark>:) ", "d")
const K11 = new RegExp("^(?<mark>\\[.*?\\]:)", "d")
const K12 = new RegExp("^>[^ ]", "")
const K13 = new Set<unknown>(["caption","definition_term","heading","line","paragraph","table_cell"])
const K14 = new RegExp("^(?:\\*?\\s*(?:Caption|Table|Tabelle|Figure|Image)(?:\\s+\\d+)?\\s*:|:\\s+\\S)", "i")
const K15 = new RegExp("^(?<op>%+)", "d")
const K16 = new RegExp("^%+(?:[ \\t]*[^ \\t%]|[ \\t]+%)", "")
const K17 = new Set<unknown>(["caption","definition_term","heading","line","paragraph"])
const K18 = new RegExp("^(?<label>\\[.+?\\]:).", "d")
const K19 = new RegExp("^[ \\t]", "")
const K20 = new Set<unknown>(["admonition","block_quote","definition_description","definition_list","directive","div","figure_group","list","list_item"])
const K21 = new RegExp("^\\*(?:[ \t]*\\*){2,}$", "")
const K22 = new RegExp("^-(?:[ \t]*-){2,}$", "")
const K23 = new RegExp("^_(?:[ \t]*_){2,}$", "")
const K24 = new RegExp("[ \t]", "")
const K25 = new RegExp("^%%", "")
const K26 = new RegExp("^[^`]*(?<run>`{3,})", "d")
const K27 = new RegExp("^(?<pre>[ \\t>]*)(?<close>`{3,})[ \\t]*$", "d")
const K28 = new RegExp("^---\\n", "")
const K29 = new RegExp("^---\\n[ \\t]*(?:\\n|$)", "")
const K30 = new RegExp("[ \\t](?<block>\\{[ \\t]*[.#][^{}]*\\})[ \\t]*$", "d")
const K31 = new RegExp("^[ \\t]*$", "")
const K32 = new RegExp("^ {4,}[^ ]", "")
const K33 = new Set<unknown>(["admonition","block_quote","code_block","definition_list","directive","div","figure_group","heading","line_block","raw_block","table","thematic_break"])
const K34 = new Set<unknown>(["definition_term","paragraph"])
const K35 = new RegExp("^(?:[-*]|[0-9]{1,9}[.)]) [ \\t]*[^ \\t]", "")
const K36 = new RegExp("^(?:-{3,}|_{3,})$", "")

function rule0(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  if (!((K0.has(self.leaf) || K1.has(self.leaf)) && (hit(K2, self.text) && mark(num(self.start))))) return
  context.report("bare-html-tag", num(group("tag", 0)), num(group("tag", 1)), path, {  }, 0)
  return
}

function rule1(self: ModelInline, path: string, context: LintContext): void {
  groups = undefined
  if (!contains(self.text, "[")) return
  const one = (): void => {
    if (((num(group("caret", 0)) >= 0) || same(str(self.text).slice(((num(group("label", 0)) - num(self.start)) - 1), (num(group("label", 0)) - num(self.start))), "]"))) {
      context.report("blank-reference-label", num(group("label", 0)), num(group("label", 1)), path, { "text": String(str(self.text).slice((num(group("label", 0)) - num(self.start)), (num(group("label", 1)) - num(self.start)))) }, 0)
      return
    }
    if (((same((num(group("label", 0)) - num(self.start)), 0) || same(str(self.text).slice(((num(group("label", 0)) - num(self.start)) - 1), (num(group("label", 0)) - num(self.start))), "\n")) && same(str(self.text).slice((num(group("label", 1)) - num(self.start)), ((num(group("label", 1)) - num(self.start)) + 1)), ":") && !contains(str(self.text).slice((num(group("label", 0)) - num(self.start)), (num(group("label", 1)) - num(self.start))), "\n"))) {
      context.report("blank-reference-label", num(group("label", 0)), (num(group("label", 1)) + 1), path, { "text": String(str(self.text).slice((num(group("label", 0)) - num(self.start)), ((num(group("label", 1)) - num(self.start)) + 1))) }, 0)
      return
    }
  }
  for (const found of matchAll(K3, self.text)) {
    groups = spansOf(found)
    base = num(self.start)
    one()
  }
}

function rule2(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  if (!(!same(self.owner?.["type"], "list_item") && !Boolean(self.after_quote_mark) && (num(self.column) > num(self.owner?.["content_column"])))) return
  context.report("block-opener-overindented", num(self.start), (num(self.start) + num((same(self.type, "definition_term") ? 2 : (K4.has(self.type) ? 3 : 1)))), path, { "kind": String((same(self.type, "block_quote") ? "quote" : (K4.has(self.type) ? "div" : str(self.type).replaceAll('_', ' ')))), "past": String((num(self.column) - num(self.owner?.["content_column"]))), "columns": String((same((num(self.column) - num(self.owner?.["content_column"])), 1) ? "column" : "columns")), "owner": String(str(self.owner?.["type"]).replaceAll('_', ' ')) }, 0)
  return
}

function rule3(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  if (!((self.prev !== undefined) && K5.has(self.leaf) && same(self.prev?.["leaf_id"], self.leaf_id) && !Boolean(self.prev?.["blank"]))) return
  if ((hit(K6, self.body) && mark(num(self.body_start)))) {
    context.report("block-opener-without-blank-line", num(group("mark", 0)), num(group("mark", 1)), path, { "opener": String("a heading") }, 0)
    return
  }
  if (((hit(K7, self.body) && mark(num(self.body_start))) && !(Boolean(self.quote_prefix) && test(K8, self.prev?.["text"]) && contains(self.ancestors, "block_quote")))) {
    context.report("block-opener-without-blank-line", num(group("mark", 0)), num(group("mark", 1)), path, { "opener": String("a quote") }, 0)
    return
  }
  if ((hit(K9, self.body) && mark(num(self.body_start)))) {
    context.report("block-opener-without-blank-line", num(group("mark", 0)), num(group("mark", 1)), path, { "opener": String("a term") }, 0)
    return
  }
  if ((hit(K10, self.body) && mark(num(self.body_start)))) {
    context.report("block-opener-without-blank-line", num(group("mark", 0)), num(group("mark", 1)), path, { "opener": String("a description") }, 0)
    return
  }
  if (same(self.shape, "attribute_line")) {
    context.report("block-opener-without-blank-line", num(self.body_start), num(self.body_end), path, { "opener": String("an attribute line") }, 0)
    return
  }
  if (((hit(K11, self.body) && mark(num(self.body_start))) && !contains(self.ancestors, "footnote"))) {
    context.report("block-opener-without-blank-line", num(group("mark", 0)), num(group("mark", 1)), path, { "opener": String("a definition") }, 0)
    return
  }
}

function rule4(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  if (!test(K12, self.text)) return
  if (K13.has(self.leaf)) {
    context.report("blockquote-marker-without-space", num(self.start), (num(self.start) + trimEnd(str(self.text)).length), path, { "text": String(trimEnd(str(self.text)).slice(1)) }, 0)
    return
  }
  if (same(self.leaf, "frontmatter")) {
    context.report("blockquote-marker-without-space", num(self.start), (num(self.start) + 1), path, { "text": String(str(self.text).slice(1)) }, 1)
    return
  }
}

function rule5(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  if (!(same(self.leaf, "paragraph") && test(K14, self.body))) return
  if ((K1.has(self.next?.["leaf"]) || K1.has(self.next2?.["leaf"]))) {
    context.report("caption-looking-paragraph", num(self.body_start), (num(self.body_start) + 1), path, {  }, 0)
    return
  }
  if ((K1.has(self.prev?.["leaf"]) || K1.has(self.prev2?.["leaf"]) || contains(self.prev?.["text"], "![") || contains(self.prev2?.["text"], "!["))) {
    context.report("caption-looking-paragraph", num(self.body_start), (num(self.body_start) + 1), path, {  }, 1)
    return
  }
}

function rule6(self: ModelLine, path: string, context: LintContext): void {
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

function rule7(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  const v_opener = ((hit(K15, str(self.leaf_head?.["text"]).slice((num(self.leaf_start) - num(self.leaf_head?.["start"])))) && mark(0)) ? str(self.leaf_head?.["text"]).slice((num(self.leaf_start) - num(self.leaf_head?.["start"]))).slice(0, num(group("op", 1))) : "")
  if (!(same(self.leaf, "comment_block") && !Boolean(self.leaf_first) && (str(v_opener).length >= 3) && starts(self.body, str(v_opener)) && test(K16, self.body))) return
  context.report("comment-fence-closer-with-text", num(self.start), num(self.end), path, {  }, 0)
  return
}

function rule8(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  if (!(K17.has(self.leaf) && (hit(K18, self.body) && mark(num(self.body_start))) && !contains(self.ancestors, "footnote") && !(same(self.leaf, "definition_term") && !Boolean(self.leaf_first) && !test(K19, self.text)) && (test(K19, self.text) || someFrom(self.ancestors, 0, (item) => K20.has(item))))) return
  context.report("definition-in-container", num(group("label", 0)), num(group("label", 1)), path, {  }, 0)
  return
}

function rule9(self: ModelLine, path: string, context: LintContext): void {
  const line = self
  groups = undefined
  const v_run_start = scan(line, scan(line, num(self.body_start), (" \t" + str(self.body).slice(0, 1)), -1), " \t", 1)
  if (!((test(K21, textFrom(line, num(v_run_start))) || test(K22, textFrom(line, num(v_run_start))) || test(K23, textFrom(line, num(v_run_start)))) && test(K24, textFrom(line, num(v_run_start))))) return
  context.report("deprecated-spaced-thematic-break", num(v_run_start), num(self.body_end), path, {  }, 0)
  return
}

function rule10(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  if (!(num(self.last_line?.["number"]) > num(self.line?.["number"]))) return
  if (!test(K25, self.line?.["next"]?.["body"])) {
    context.report("description-term-multi-line", num(self.line?.["next"]?.["body_start"]), num(self.line?.["next"]?.["end"]), path, {  }, 0)
    return
  }
  if ((self.line?.["next2"] !== undefined)) {
    context.report("description-term-multi-line", num(self.line?.["next2"]?.["body_start"]), num(self.line?.["next2"]?.["end"]), path, {  }, 0)
    return
  }
}

function rule11(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  const v_run = ((hit(K26, self.line?.["text"]) && mark(num(self.line?.["start"]))) ? str(self.line?.["text"]).slice((num(group("run", 0)) - num(self.line?.["start"])), (num(group("run", 1)) - num(self.line?.["start"]))) : "")
  const v_at = ((hit(K26, self.line?.["text"]) && mark(num(self.line?.["start"]))) ? (num(group("run", 0)) - num(self.line?.["start"])) : -1)
  if (!((num(self.last_line?.["number"]) > num(self.line?.["number"])) && (str(v_run).length >= 3) && (hit(K27, self.last_line?.["text"]) && mark(num(self.last_line?.["start"]))) && !same((num(group("close", 0)) - num(self.last_line?.["start"])), v_at) && starts(str(self.last_line?.["text"]).slice((num(group("close", 0)) - num(self.last_line?.["start"]))), str(v_run)))) return
  context.report("fence-closer-indented", num(group("close", 0)), num(self.last_line?.["end"]), path, {  }, 0)
  return
}

function rule12(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  if (!(test(K28, self.text) && (test(K29, self.text) || !contains(str(self.text).slice(4), ":")))) return
  context.report("frontmatter-shaped-thematic-break", num(self.start), num(self.end), path, {  }, 0)
  return
}

function rule13(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  if (!(hit(K30, self.last_line?.["text"]) && mark(num(self.last_line?.["start"])))) return
  context.report("heading-trailing-attribute", num(group("block", 0)), num(group("block", 1)), path, { "block": String(str(self.last_line?.["text"]).slice((num(group("block", 0)) - num(self.last_line?.["start"])), (num(group("block", 1)) - num(self.last_line?.["start"])))) }, 0)
  return
}

function rule14(self: ModelBlock, path: string, context: LintContext): void {
  const line = self.line
  groups = undefined
  if (!(same(self.parent?.["type"], "document") && (num(self.line?.["number"]) > 1) && test(K31, self.line?.["prev"]?.["text"]) && !same(self.prev_type, "list") && test(K32, self.line?.["text"]))) return
  context.report("indented-code-block", scan(line, num(self.line?.["start"]), " \t", 1), (num(self.line?.["start"]) + trimEnd(str(self.line?.["text"])).length), path, {  }, 0)
  return
}

function rule15(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  if (!(same(self.parent?.["type"], "list_item") && (K33.has(self.type) || Boolean(self.image_line) || Boolean(self.attributed)) && (num(self.opener_column) > num(self.parent?.["content_column"])))) return
  context.report("list-item-block-overindented", num(self.start), num(self.line?.["end"]), path, { "contentColumn": String((num(self.parent?.["content_column"]) + 1)) }, 0)
  return
}

function rule16(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  if (!(same(self.parent?.["type"], "list_item") && (num(self.index) >= 1) && (num(self.column) > num(self.parent?.["marker_column"])) && (num(self.column) < num(self.parent?.["content_column"])))) return
  context.report("list-item-body-below-content-column", num(self.start), num(self.line?.["end"]), path, {  }, 0)
  return
}

function rule17(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  if (!((self.prev !== undefined) && K34.has(self.leaf) && same(self.prev?.["leaf_id"], self.leaf_id) && !Boolean(self.leaf_first) && test(K35, self.body))) return
  if ((same(self.leaf, "definition_term") || contains(self.ancestors, "definition_term") || contains(self.ancestors, "definition_description"))) {
    context.report("list-marker-without-blank-line", num(self.body_start), num(self.body_end), path, {  }, 1)
    return
  }
  context.report("list-marker-without-blank-line", num(self.body_start), num(self.body_end), path, {  }, 0)
  return
}

function rule18(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  if (!(test(K36, self.body) && !(starts(self.body, "-") && same(self.prev?.["leaf"], "paragraph") && !Boolean(self.prev?.["blank"])) && !(same(self.number, 1) && same(self.body_start, self.start) && same(self.body, "---")))) return
  context.report("thematic-break-spelling", num(self.body_start), num(self.body_end), path, { "raw": String(self.body) }, 0)
  return
}

function rule19(self: ModelLine, path: string, context: LintContext): void {
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
  | { id: RuleId, over: 'inline', types: readonly string[] | undefined, verbatim: ReadonlySet<string>, run: (self: ModelInline, path: string, context: LintContext) => void }

export const VERBATIM_LEAVES: ReadonlySet<string> = new Set(["code_block","comment_block","frontmatter","raw_block"])

export const DATA_RULES: readonly DataRule[] = [
  { id: "bare-html-tag", over: "line", types: undefined, verbatim: new Set([]), run: rule0 },
  { id: "blank-reference-label", over: "inline", types: ["text"], verbatim: new Set([]), run: rule1 },
  { id: "block-opener-overindented", over: "block", types: ["admonition","block_quote","code_block","definition_term","directive","div","figure_group","heading","line_block","raw_block","table","thematic_break"], verbatim: new Set([]), run: rule2 },
  { id: "block-opener-without-blank-line", over: "line", types: undefined, verbatim: new Set([]), run: rule3 },
  { id: "blockquote-marker-without-space", over: "line", types: undefined, verbatim: new Set(["frontmatter"]), run: rule4 },
  { id: "caption-looking-paragraph", over: "line", types: undefined, verbatim: new Set([]), run: rule5 },
  { id: "colon-fence-length-mismatch", over: "line", types: undefined, verbatim: new Set([]), run: rule6 },
  { id: "comment-fence-closer-with-text", over: "line", types: undefined, verbatim: new Set(["comment_block"]), run: rule7 },
  { id: "definition-in-container", over: "line", types: undefined, verbatim: new Set([]), run: rule8 },
  { id: "deprecated-spaced-thematic-break", over: "line", types: undefined, verbatim: new Set([]), run: rule9 },
  { id: "description-term-multi-line", over: "block", types: ["definition_term"], verbatim: new Set([]), run: rule10 },
  { id: "fence-closer-indented", over: "block", types: ["code_block"], verbatim: new Set([]), run: rule11 },
  { id: "frontmatter-shaped-thematic-break", over: "block", types: ["frontmatter"], verbatim: new Set([]), run: rule12 },
  { id: "heading-trailing-attribute", over: "block", types: ["heading"], verbatim: new Set([]), run: rule13 },
  { id: "indented-code-block", over: "block", types: ["paragraph"], verbatim: new Set([]), run: rule14 },
  { id: "list-item-block-overindented", over: "block", types: undefined, verbatim: new Set([]), run: rule15 },
  { id: "list-item-body-below-content-column", over: "block", types: undefined, verbatim: new Set([]), run: rule16 },
  { id: "list-marker-without-blank-line", over: "line", types: undefined, verbatim: new Set([]), run: rule17 },
  { id: "thematic-break-spelling", over: "line", types: undefined, verbatim: new Set([]), run: rule18 },
  { id: "unattached-block-attribute", over: "line", types: undefined, verbatim: new Set([]), run: rule19 },
]
