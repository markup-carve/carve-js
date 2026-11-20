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
  const all = found.indices?.groups
  if (all === undefined) return spans
  for (const name in all) {
    const span = all[name]
    if (span !== undefined) spans[name] = span
  }
  return spans
}

let lastRegex: RegExp | undefined
let lastValue = ''
let lastSpans: Record<string, [number, number]> | undefined

// The lines of one leaf often test the same text against the same pattern, as a block's opener line.
function hit(regex: RegExp, spans: RegExp, value: unknown): boolean {
  if (typeof value !== 'string') return false
  if (regex === lastRegex && value === lastValue) {
    if (lastSpans === undefined) return false
    groups = lastSpans
    return true
  }
  lastRegex = regex
  lastValue = value
  lastSpans = undefined
  if (!regex.test(value)) return false
  const found = spans.exec(value)
  if (found === null) return false
  lastSpans = spansOf(found)
  groups = lastSpans
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
const K2 = new RegExp("^(?:[^<]|<!--.*?-->|<[^!<A-Za-z/]|<[A-Za-z/]|<<|<!(?:[^-]|$)|<!-(?:[^-]|$)|<$)*?<*(?<tag></?[A-Za-z][A-Za-z0-9_:-]*(?:\\s[^<>]*)?/?>)", "")
const K3 = new RegExp("^(?:[^<]|<!--.*?-->|<[^!<A-Za-z/]|<[A-Za-z/]|<<|<!(?:[^-]|$)|<!-(?:[^-]|$)|<$)*?<*(?<tag></?[A-Za-z][A-Za-z0-9_:-]*(?:\\s[^<>]*)?/?>)", "d")
const K4 = new RegExp("(?<label>\\[(?<caret>\\^)?[ \\t\\n]+\\])", "gd")
const K5 = new Set<unknown>(["admonition","directive","div","figure_group"])
const K6 = new RegExp("^(?<mark>#+|=+|:+|`+|~+|\\*+|-+|_+)", "")
const K7 = new RegExp("^(?<mark>#+|=+|:+|`+|~+|\\*+|-+|_+)", "d")
const K8 = new Set<unknown>(["caption","paragraph"])
const K9 = new RegExp("^(?<mark>#{1,6}|={1,6}) ", "")
const K10 = new RegExp("^(?<mark>#{1,6}|={1,6}) ", "d")
const K11 = new RegExp("^(?<mark>>)(?: |$)", "")
const K12 = new RegExp("^(?<mark>>)(?: |$)", "d")
const K13 = new RegExp("^[ \t]*> ", "")
const K14 = new RegExp("^(?<mark>::) ", "")
const K15 = new RegExp("^(?<mark>::) ", "d")
const K16 = new RegExp("^(?<mark>:) ", "")
const K17 = new RegExp("^(?<mark>:) ", "d")
const K18 = new RegExp("^(?<mark>\\[.*?\\]:)", "")
const K19 = new RegExp("^(?<mark>\\[.*?\\]:)", "d")
const K20 = new RegExp("^>[^ ]", "")
const K21 = new Set<unknown>(["caption","definition_term","heading","line","paragraph","table_cell"])
const K22 = new RegExp("^(?:\\*?\\s*(?:Caption|Table|Tabelle|Figure|Image)(?:\\s+\\d+)?\\s*:|:\\s+\\S)", "i")
const K23 = new RegExp("^(?<op>%+)", "")
const K24 = new RegExp("^(?<op>%+)", "d")
const K25 = new RegExp("^%+(?:[ \\t]*[^ \\t%]|[ \\t]+%)", "")
const K26 = new Set<unknown>(["caption","definition_term","heading","line","paragraph"])
const K27 = new RegExp("^(?<label>\\[.+?\\]:).", "")
const K28 = new RegExp("^(?<label>\\[.+?\\]:).", "d")
const K29 = new RegExp("^[ \\t]", "")
const K30 = new Set<unknown>(["admonition","block_quote","definition_description","definition_list","directive","div","figure_group","list","list_item"])
const K31 = new RegExp("^\\*(?:[ \t]*\\*){2,}$", "")
const K32 = new RegExp("^-(?:[ \t]*-){2,}$", "")
const K33 = new RegExp("^_(?:[ \t]*_){2,}$", "")
const K34 = new RegExp("[ \t]", "")
const K35 = new RegExp("^%%", "")
const K36 = new RegExp("^[^`]*(?<run>`{3,})", "")
const K37 = new RegExp("^[^`]*(?<run>`{3,})", "d")
const K38 = new RegExp("^(?<pre>[ \\t>]*)(?<close>`{3,})[ \\t]*$", "")
const K39 = new RegExp("^(?<pre>[ \\t>]*)(?<close>`{3,})[ \\t]*$", "d")
const K40 = new RegExp("^---[ \\t]*\\n", "")
const K41 = new RegExp("^---[ \\t]*\\n[ \\t]*(?:\\n|$)", "")
const K42 = new RegExp("^---[ \\t]*\\n[^:]*$", "")
const K43 = new RegExp("[ \\t](?<block>\\{[ \\t]*[.#][^{}]*\\})[ \\t]*$", "")
const K44 = new RegExp("[ \\t](?<block>\\{[ \\t]*[.#][^{}]*\\})[ \\t]*$", "d")
const K45 = new RegExp("^[ \\t]*$", "")
const K46 = new RegExp("^ {4,}[^ ]", "")
const K47 = new Set<unknown>(["admonition","block_quote","code_block","definition_list","directive","div","figure_group","heading","line_block","raw_block","table","thematic_break"])
const K48 = new Set<unknown>(["definition_term","paragraph"])
const K49 = new RegExp("^(?:[-*]|[0-9]{1,9}[.)]) [ \\t]*[^ \\t]", "")
const K50 = new RegExp("^(?:-{3,}|_{3,})$", "")

function rule0(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  if (!((K0.has(self.leaf) || K1.has(self.leaf)) && (hit(K2, K3, self.text) && mark(num(self.start))))) return
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
  for (const found of matchAll(K4, self.text)) {
    groups = spansOf(found)
    base = num(self.start)
    one()
  }
}

function rule2(self: ModelBlock, path: string, context: LintContext): void {
  const line = self.line
  groups = undefined
  if (!(!same(self.owner?.["type"], "list_item") && !Boolean(self.after_quote_mark) && (num(self.column) > num(self.owner?.["content_column"])))) return
  context.report("block-opener-overindented", num(self.start), num(((hit(K6, K7, textFrom(line, num(self.start))) && mark(num(self.start))) ? group("mark", 1) : (num(self.start) + 1))), path, { "kind": String((same(self.type, "block_quote") ? "quote" : (K5.has(self.type) ? "div" : str(self.type).replaceAll('_', ' ')))), "past": String((num(self.column) - num(self.owner?.["content_column"]))), "columns": String((same((num(self.column) - num(self.owner?.["content_column"])), 1) ? "column" : "columns")), "owner": String(str(self.owner?.["type"]).replaceAll('_', ' ')) }, 0)
  return
}

function rule3(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  if (!((self.prev !== undefined) && K8.has(self.leaf) && same(self.prev?.["leaf_id"], self.leaf_id) && !Boolean(self.prev?.["blank"]))) return
  if ((hit(K9, K10, self.body) && mark(num(self.body_start)))) {
    context.report("block-opener-without-blank-line", num(group("mark", 0)), num(group("mark", 1)), path, { "opener": String("a heading") }, 0)
    return
  }
  if (((hit(K11, K12, self.body) && mark(num(self.body_start))) && !(Boolean(self.quote_prefix) && test(K13, self.prev?.["text"]) && contains(self.ancestors, "block_quote")))) {
    context.report("block-opener-without-blank-line", num(group("mark", 0)), num(group("mark", 1)), path, { "opener": String("a quote") }, 0)
    return
  }
  if ((hit(K14, K15, self.body) && mark(num(self.body_start)))) {
    context.report("block-opener-without-blank-line", num(group("mark", 0)), num(group("mark", 1)), path, { "opener": String("a term") }, 0)
    return
  }
  if ((hit(K16, K17, self.body) && mark(num(self.body_start)))) {
    context.report("block-opener-without-blank-line", num(group("mark", 0)), num(group("mark", 1)), path, { "opener": String("a description") }, 0)
    return
  }
  if (same(self.shape, "attribute_line")) {
    context.report("block-opener-without-blank-line", num(self.body_start), num(self.body_end), path, { "opener": String("an attribute line") }, 0)
    return
  }
  if (((hit(K18, K19, self.body) && mark(num(self.body_start))) && !contains(self.ancestors, "footnote"))) {
    context.report("block-opener-without-blank-line", num(group("mark", 0)), num(group("mark", 1)), path, { "opener": String("a definition") }, 0)
    return
  }
}

function rule4(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  if (!test(K20, self.text)) return
  if (K21.has(self.leaf)) {
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
  if (!(same(self.leaf, "paragraph") && test(K22, self.body))) return
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
  const v_opener = ((same(self.leaf, "comment_block") && !Boolean(self.leaf_first)) ? ((hit(K23, K24, str(self.leaf_head?.["text"]).slice((num(self.leaf_start) - num(self.leaf_head?.["start"])))) && mark(0)) ? str(self.leaf_head?.["text"]).slice((num(self.leaf_start) - num(self.leaf_head?.["start"]))).slice(0, num(group("op", 1))) : "") : "")
  if (!(same(self.leaf, "comment_block") && !Boolean(self.leaf_first) && (str(v_opener).length >= 3) && starts(self.body, str(v_opener)) && test(K25, self.body))) return
  context.report("comment-fence-closer-with-text", num(self.start), num(self.end), path, {  }, 0)
  return
}

function rule8(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  if (!(K26.has(self.leaf) && (hit(K27, K28, self.body) && mark(num(self.body_start))) && !contains(self.ancestors, "footnote") && !(same(self.leaf, "definition_term") && !Boolean(self.leaf_first) && !test(K29, self.text)) && (test(K29, self.text) || someFrom(self.ancestors, 0, (item) => K30.has(item))))) return
  context.report("definition-in-container", num(group("label", 0)), num(group("label", 1)), path, {  }, 0)
  return
}

function rule9(self: ModelLine, path: string, context: LintContext): void {
  const line = self
  groups = undefined
  const v_run_start = scan(line, scan(line, num(self.body_start), (" \t" + str(self.body).slice(0, 1)), -1), " \t", 1)
  if (!((test(K31, textFrom(line, num(v_run_start))) || test(K32, textFrom(line, num(v_run_start))) || test(K33, textFrom(line, num(v_run_start)))) && test(K34, textFrom(line, num(v_run_start))))) return
  context.report("deprecated-spaced-thematic-break", num(v_run_start), num(self.body_end), path, {  }, 0)
  return
}

function rule10(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  if (!(num(self.last_line?.["number"]) > num(self.line?.["number"]))) return
  if (!test(K35, self.line?.["next"]?.["body"])) {
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
  const v_run = ((hit(K36, K37, self.line?.["text"]) && mark(num(self.line?.["start"]))) ? str(self.line?.["text"]).slice((num(group("run", 0)) - num(self.line?.["start"])), (num(group("run", 1)) - num(self.line?.["start"]))) : "")
  const v_at = ((hit(K36, K37, self.line?.["text"]) && mark(num(self.line?.["start"]))) ? (num(group("run", 0)) - num(self.line?.["start"])) : -1)
  if (!((num(self.last_line?.["number"]) > num(self.line?.["number"])) && (str(v_run).length >= 3) && (hit(K38, K39, self.last_line?.["text"]) && mark(num(self.last_line?.["start"]))) && !same((num(group("close", 0)) - num(self.last_line?.["start"])), v_at) && starts(str(self.last_line?.["text"]).slice((num(group("close", 0)) - num(self.last_line?.["start"]))), str(v_run)))) return
  context.report("fence-closer-indented", num(group("close", 0)), num(self.last_line?.["end"]), path, {  }, 0)
  return
}

function rule12(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  if (!(test(K40, self.text) && (test(K41, self.text) || test(K42, self.text)))) return
  context.report("frontmatter-shaped-thematic-break", num(self.start), num(self.end), path, {  }, 0)
  return
}

function rule13(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  if (!(hit(K43, K44, self.last_line?.["text"]) && mark(num(self.last_line?.["start"])))) return
  context.report("heading-trailing-attribute", num(group("block", 0)), num(group("block", 1)), path, { "block": String(str(self.last_line?.["text"]).slice((num(group("block", 0)) - num(self.last_line?.["start"])), (num(group("block", 1)) - num(self.last_line?.["start"])))) }, 0)
  return
}

function rule14(self: ModelBlock, path: string, context: LintContext): void {
  const line = self.line
  groups = undefined
  if (!(same(self.parent?.["type"], "document") && (num(self.line?.["number"]) > 1) && test(K45, self.line?.["prev"]?.["text"]) && !same(self.prev_type, "list") && test(K46, self.line?.["text"]))) return
  context.report("indented-code-block", scan(line, num(self.line?.["start"]), " \t", 1), (num(self.line?.["start"]) + trimEnd(str(self.line?.["text"])).length), path, {  }, 0)
  return
}

function rule15(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  if (!(same(self.parent?.["type"], "list_item") && (K47.has(self.type) || Boolean(self.image_line) || Boolean(self.attributed)) && (num(self.opener_column) > num(self.parent?.["content_column"])))) return
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
  if (!((self.prev !== undefined) && K48.has(self.leaf) && same(self.prev?.["leaf_id"], self.leaf_id) && !Boolean(self.leaf_first) && test(K49, self.body))) return
  if ((same(self.leaf, "definition_term") || contains(self.ancestors, "definition_term") || contains(self.ancestors, "definition_description"))) {
    context.report("list-marker-without-blank-line", num(self.body_start), num(self.body_end), path, {  }, 1)
    return
  }
  context.report("list-marker-without-blank-line", num(self.body_start), num(self.body_end), path, {  }, 0)
  return
}

function rule18(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  if (!(test(K50, self.body) && !(starts(self.body, "-") && same(self.prev?.["leaf"], "paragraph") && !Boolean(self.prev?.["blank"])) && !(same(self.number, 1) && same(self.body_start, self.start) && same(self.body, "---")))) return
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
