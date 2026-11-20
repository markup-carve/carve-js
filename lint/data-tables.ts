// Generated from data/lint-model.json by lint/generate-data-tables.ts. Do not edit.
import { type RuleId } from './catalog.ts'
import { type ModelBlock, type ModelInline, type ModelLine } from './data-model.ts'
import { type LintContext } from './types.ts'

let groups: Record<string, [number, number]> | undefined
let base = 0
const UNSET: unique symbol = Symbol('unset')

// A let read late must not replace the match that the condition reading it has just made.
function aside(compute: () => unknown): unknown {
  const keptGroups = groups
  const keptBase = base
  const value = compute()
  groups = keptGroups
  base = keptBase
  return value
}

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

const K0 = new RegExp("^!\\[\\]", "")
const K1 = new Set<unknown>(["heading","paragraph"])
const K2 = new Set<unknown>(["table_cell","table_row"])
const K3 = new RegExp("^(?:[^<]|<!--.*?-->|<[^!<A-Za-z/]|<[A-Za-z/]|<<|<!(?:[^-]|$)|<!-(?:[^-]|$)|<$)*?<*(?<tag></?[A-Za-z][A-Za-z0-9_:-]*(?:\\s[^<>]*)?/?>)", "")
const K4 = new RegExp("^(?:[^<]|<!--.*?-->|<[^!<A-Za-z/]|<[A-Za-z/]|<<|<!(?:[^-]|$)|<!-(?:[^-]|$)|<$)*?<*(?<tag></?[A-Za-z][A-Za-z0-9_:-]*(?:\\s[^<>]*)?/?>)", "d")
const K5 = new RegExp("(?<label>\\[(?<caret>\\^)?[ \\t\\n]+\\])", "gd")
const K6 = new Set<unknown>(["admonition","directive","div","figure_group"])
const K7 = new RegExp("^(?<mark>#+|=+|:+|`+|~+|\\*+|-+|_+)", "")
const K8 = new RegExp("^(?<mark>#+|=+|:+|`+|~+|\\*+|-+|_+)", "d")
const K9 = new Set<unknown>(["caption","paragraph"])
const K10 = new RegExp("^(?<mark>#{1,6}|={1,6}) ", "")
const K11 = new RegExp("^(?<mark>#{1,6}|={1,6}) ", "d")
const K12 = new RegExp("^>(?: |$)", "")
const K13 = new RegExp("^(?<mark>>)(?:[ \\x00]|$)", "")
const K14 = new RegExp("^(?<mark>>)(?:[ \\x00]|$)", "d")
const K15 = new RegExp("^[ \t]*> ", "")
const K16 = new RegExp("^(?<mark>::) ", "")
const K17 = new RegExp("^(?<mark>::) ", "d")
const K18 = new RegExp("^(?<mark>:) ", "")
const K19 = new RegExp("^(?<mark>:) ", "d")
const K20 = new RegExp("^(?<mark>\\[.*?\\]:)", "")
const K21 = new RegExp("^(?<mark>\\[.*?\\]:)", "d")
const K22 = new RegExp("^>[^ ]", "")
const K23 = new RegExp("^>[ \\t]", "")
const K24 = new Set<unknown>(["caption","definition_term","heading","line","paragraph","table_cell"])
const K25 = new RegExp("^\\{%\\s*(?:(?:raw|endraw|endif|endfor|endblock)\\s*|(?:if|for|block)\\s+\\S[\\s\\S]*)%\\}$", "")
const K26 = new RegExp("^(?:\\*?\\s*(?:Caption|Table|Tabelle|Figure|Image)(?:\\s+\\d+)?\\s*:|:\\s+\\S)", "i")
const K27 = new RegExp("^(?<op>%+)", "")
const K28 = new RegExp("^(?<op>%+)", "d")
const K29 = new RegExp("^%+(?:[ \\t]*[^ \\t%]|[ \\t]+%)", "")
const K30 = new RegExp("^[ \\t]*%%", "")
const K31 = new RegExp("^/\\*|\\*/$", "")
const K32 = new RegExp("^\\*/|/\\*$", "")
const K33 = new Set<unknown>(["caption","definition_term","line","paragraph"])
const K34 = new RegExp("^(?:>[ \\t]+)*(?<label>\\[.+?\\]:).", "")
const K35 = new RegExp("^(?:>[ \\t]+)*(?<label>\\[.+?\\]:).", "d")
const K36 = new RegExp("^(?<label>\\[.+?\\]:).", "")
const K37 = new RegExp("^(?<label>\\[.+?\\]:).", "d")
const K38 = new RegExp("^[ \\t]", "")
const K39 = new Set<unknown>(["admonition","block_quote","definition_description","definition_list","directive","div","figure_group","list","list_item"])
const K40 = new RegExp("^::?[ \\t]+(?<body>(?:>[ \\t]|[-*][ \\t]|[0-9]{1,9}[.)][ \\t])[\\s\\S]*)$", "")
const K41 = new RegExp("^::?[ \\t]+(?<body>(?:>[ \\t]|[-*][ \\t]|[0-9]{1,9}[.)][ \\t])[\\s\\S]*)$", "d")
const K42 = new RegExp("(?:^|[ \\t>])(?:[-*+]|[0-9]{1,9}[.)]|[A-Za-z][.)])(?:[ \\t]+\\[[ xX]\\])?[ \\t]+$", "")
const K43 = new RegExp("^(?:[^\"]|\"[^\"]*\")*?[{ \\t]loose(?:=|[ \\t}])", "")
const K44 = new RegExp("^[-*_]", "")
const K45 = new RegExp("^\\*(?:[ \t]*\\*){2,}$", "")
const K46 = new RegExp("^-(?:[ \t]*-){2,}$", "")
const K47 = new RegExp("^_(?:[ \t]*_){2,}$", "")
const K48 = new RegExp("[ \t]", "")
const K49 = new RegExp("^%%", "")
const K50 = new RegExp("^\\+[ \\t]+[^ \\t]", "")
const K51 = new Set<unknown>(["caption","definition_term","heading","line","paragraph"])
const K52 = new RegExp("(?<include>\\{\\{(?:\\s*|\\s+(?:\"\"|“”|[#@])[^{}]*)\\}\\})", "gd")
const K53 = new RegExp("\\]\\([ \\t]*\\)(?:\\{[^{}]*\\})*$", "")
const K54 = new RegExp("^(?<def>\\[(?<label>[^\\]]*[^\\] \\t][^\\]]*)\\]:)$", "")
const K55 = new RegExp("^(?<def>\\[(?<label>[^\\]]*[^\\] \\t][^\\]]*)\\]:)$", "d")
const K56 = new RegExp("^\\[\\^[ \\t]*\\]", "")
const K57 = new RegExp("^[^`]*(?<run>`{3,})", "")
const K58 = new RegExp("^[^`]*(?<run>`{3,})", "d")
const K59 = new RegExp("^(?<pre>[ \\t>]*)(?<close>`{3,})[ \\t]*$", "")
const K60 = new RegExp("^(?<pre>[ \\t>]*)(?<close>`{3,})[ \\t]*$", "d")
const K61 = new RegExp("^`{3,}$", "")
const K62 = new RegExp("^[ \\t]*::: figure ", "")
const K63 = new RegExp("[\"\\[]", "")
const K64 = new RegExp("^:{3,}[ \\t]*footnotes(?:[ \\t]|$)", "")
const K65 = new RegExp("^---[ \\t]*\\n", "")
const K66 = new RegExp("^---[ \\t]*\\n[ \\t]*(?:\\n|$)", "")
const K67 = new RegExp("^---[ \\t]*\\n[^:]*$", "")
const K68 = new Set<unknown>(["heading","paragraph","table_cell","table_row"])
const K69 = new RegExp("^[ \\t]*(?:>[ \\t]*)+(?:(?:[-*]|[0-9]+[.)]|[A-Za-z][.)])[ \\t]*>[ \\t]*)?(?:\\[[^\\]]+\\]:[ \\t]*>[ \\t]*)?(?<mark>\\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\\])", "")
const K70 = new RegExp("^[ \\t]*(?:>[ \\t]*)+(?:(?:[-*]|[0-9]+[.)]|[A-Za-z][.)])[ \\t]*>[ \\t]*)?(?:\\[[^\\]]+\\]:[ \\t]*>[ \\t]*)?(?<mark>\\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\\])", "d")
const K71 = new RegExp("^\\*\\.[\\s\\S]*\\*$", "")
const K72 = new RegExp("^(?:#+|=+)[ \\t]+[^ \\t].*?[ \\t](?<run>#+)$", "")
const K73 = new RegExp("^(?:#+|=+)[ \\t]+[^ \\t].*?[ \\t](?<run>#+)$", "d")
const K74 = new RegExp("(?:^|[ \\t])(?<run>#+)[ \\t]*$", "")
const K75 = new RegExp("(?:^|[ \\t])(?<run>#+)[ \\t]*$", "d")
const K76 = new RegExp("[ \\t](?<block>\\{[ \\t]*[.#][^{}]*\\})[ \\t]*$", "")
const K77 = new RegExp("[ \\t](?<block>\\{[ \\t]*[.#][^{}]*\\})[ \\t]*$", "d")
const K78 = new RegExp("^[ \\t]*$", "")
const K79 = new RegExp("^ {4,}[^ ]", "")
const K80 = new Set<unknown>(["list_item","admonition","directive","div","figure_group"])
const K81 = new Set<unknown>(["admonition","block_quote","code_block","definition_list","directive","div","figure_group","heading","line_block","raw_block","table","thematic_break"])
const K82 = new Set<unknown>(["definition_term","paragraph"])
const K83 = new RegExp("^(?:[-*]|[0-9]{1,9}[.)]) [ \\t]*[^ \\t]", "")
const K84 = new RegExp("^[ \\t]*(?:>[ \\t]+)*(?<run>={3,}|-{3,})[ \\t]*$", "")
const K85 = new RegExp("^[ \\t]*(?:>[ \\t]+)*(?<run>={3,}|-{3,})[ \\t]*$", "d")
const K86 = new RegExp("\\|(?:[ \\t]*\\{[^{}]*\\})?[ \\t\\x00]*$", "")
const K87 = new RegExp("^(?:-{3,}|_{3,})$", "")

function rule0(self: ModelInline, path: string, context: LintContext): void {
  groups = undefined
  if (!test(K0, self.text)) return
  context.report("a11y/image-alt", num(self.start), num(self.end), path, {  }, 0)
  return
}

function rule1(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  if (!((K1.has(self.leaf) || K2.has(self.leaf)) && contains(self.text, "<") && (hit(K3, K4, self.text) && mark(num(self.start))))) return
  context.report("bare-html-tag", num(group("tag", 0)), num(group("tag", 1)), path, {  }, 0)
  return
}

function rule2(self: ModelInline, path: string, context: LintContext): void {
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
  for (const found of matchAll(K5, self.text)) {
    groups = spansOf(found)
    base = num(self.start)
    one()
  }
}

function rule3(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  if (!(!Boolean(self.after_quote_mark) && (num(self.mark_column) > num(self.owner?.["content_column"])) && !same(self.item_owner?.["type"], "list_item"))) return
  context.report("block-opener-overindented", num(self.opener_start), num(((hit(K7, K8, self.opener_text) && mark(num(self.opener_start))) ? group("mark", 1) : (num(self.opener_start) + 1))), path, { "kind": String((same(self.type, "block_quote") ? "quote" : (K6.has(self.type) ? "div" : str(self.type).replaceAll('_', ' ')))), "past": String((num(self.mark_column) - num(self.owner?.["content_column"]))), "columns": String((same((num(self.mark_column) - num(self.owner?.["content_column"])), 1) ? "column" : "columns")), "owner": String(str(self.owner?.["type"]).replaceAll('_', ' ')) }, 0)
  return
}

function rule4(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  if (!((self.prev !== undefined) && K9.has(self.leaf) && same(self.prev?.["leaf_id"], self.leaf_id) && !Boolean(self.prev?.["blank"]))) return
  if ((hit(K10, K11, self.body) && mark(num(self.body_start)))) {
    context.report("block-opener-without-blank-line", num(group("mark", 0)), num(group("mark", 1)), path, { "opener": String("a heading") }, 0)
    return
  }
  if (((test(K12, self.raw_body) && (hit(K13, K14, self.body) && mark(num(self.body_start)))) && !(Boolean(self.quote_prefix) && test(K15, self.prev?.["text"]) && contains(self.ancestors, "block_quote")))) {
    context.report("block-opener-without-blank-line", num(group("mark", 0)), num(group("mark", 1)), path, { "opener": String("a quote") }, 0)
    return
  }
  if ((hit(K16, K17, self.body) && mark(num(self.body_start)))) {
    context.report("block-opener-without-blank-line", num(group("mark", 0)), num(group("mark", 1)), path, { "opener": String("a term") }, 0)
    return
  }
  if ((hit(K18, K19, self.body) && mark(num(self.body_start)))) {
    context.report("block-opener-without-blank-line", num(group("mark", 0)), num(group("mark", 1)), path, { "opener": String("a description") }, 0)
    return
  }
  if (same(self.shape, "attribute_line")) {
    context.report("block-opener-without-blank-line", num(self.body_start), num(self.body_end), path, { "opener": String("an attribute line") }, 0)
    return
  }
  if (((hit(K20, K21, self.body) && mark(num(self.body_start))) && !contains(self.ancestors, "footnote"))) {
    context.report("block-opener-without-blank-line", num(group("mark", 0)), num(group("mark", 1)), path, { "opener": String("a definition") }, 0)
    return
  }
}

function rule5(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  if (!(test(K22, self.text) && !test(K23, self.raw_body))) return
  if (K24.has(self.leaf)) {
    context.report("blockquote-marker-without-space", num(self.start), (num(self.start) + trimEnd(str(self.text)).length), path, { "text": String(trimEnd(str(self.text)).slice(1)) }, 0)
    return
  }
  if (same(self.leaf, "frontmatter")) {
    context.report("blockquote-marker-without-space", num(self.start), (num(self.start) + trimEnd(str(self.text)).length), path, { "text": String(trimEnd(str(self.text)).slice(1)) }, 1)
    return
  }
}

function rule6(self: ModelInline, path: string, context: LintContext): void {
  groups = undefined
  if (!test(K25, self.text)) return
  context.report("braced-comment-in-a-template-source", num(self.start), num(self.end), path, {  }, 0)
  return
}

function rule7(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  if (!(same(self.leaf, "paragraph") && test(K26, self.body))) return
  if ((K2.has(self.next?.["leaf"]) || K2.has(self.next2?.["leaf"]))) {
    context.report("caption-looking-paragraph", num(self.body_start), (num(self.body_start) + 1), path, {  }, 0)
    return
  }
  if ((K2.has(self.prev?.["leaf"]) || K2.has(self.prev2?.["leaf"]) || contains(self.prev?.["text"], "![") || contains(self.prev2?.["text"], "!["))) {
    context.report("caption-looking-paragraph", num(self.body_start), (num(self.body_start) + 1), path, {  }, 1)
    return
  }
}

function rule8(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  if (!(starts(self.body, ":::") && same(self.shape, "div_bare_run") && (self.open_colon?.[0] !== undefined) && !same(self.open_colon?.[0]?.["width"], str(self.body).length))) return
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

function rule9(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  let v_opener: unknown = UNSET
  if (!(same(self.leaf, "comment_block") && !Boolean(self.leaf_first) && (str((v_opener === UNSET ? (v_opener = aside(() => ((same(self.leaf, "comment_block") && !Boolean(self.leaf_first)) ? ((hit(K27, K28, str(self.leaf_head?.["text"]).slice((num(self.leaf_start) - num(self.leaf_head?.["start"])))) && mark(0)) ? str(self.leaf_head?.["text"]).slice((num(self.leaf_start) - num(self.leaf_head?.["start"]))).slice(0, num(group("op", 1))) : "") : ""))) : v_opener)).length >= 3) && starts(self.body, str((v_opener === UNSET ? (v_opener = aside(() => ((same(self.leaf, "comment_block") && !Boolean(self.leaf_first)) ? ((hit(K27, K28, str(self.leaf_head?.["text"]).slice((num(self.leaf_start) - num(self.leaf_head?.["start"])))) && mark(0)) ? str(self.leaf_head?.["text"]).slice((num(self.leaf_start) - num(self.leaf_head?.["start"]))).slice(0, num(group("op", 1))) : "") : ""))) : v_opener))) && test(K29, self.body))) return
  context.report("comment-fence-closer-with-text", num(self.start), num(self.end), path, {  }, 0)
  return
}

function rule10(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  if (!test(K30, self.text)) return
  context.report("comment-line-in-line-block", num(self.start), num(self.end), path, {  }, 0)
  return
}

function rule11(self: ModelInline, path: string, context: LintContext): void {
  groups = undefined
  if ((same(self.type, "emphasis") && test(K31, self.text))) {
    context.report("comment-shaped-emphasis", num(self.start), num(self.end), path, {  }, 0)
    return
  }
  if ((same(self.type, "strong") && test(K32, self.text))) {
    context.report("comment-shaped-emphasis", num(self.start), num(self.end), path, {  }, 0)
    return
  }
}

function rule12(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  if (!(K33.has(self.leaf) && ((hit(K34, K35, self.body) && mark(num(self.body_start))) && ((Boolean(self.lazy) && contains(self.ancestors, "block_quote")) || (hit(K36, K37, self.body) && mark(num(self.body_start))))) && !contains(self.ancestors, "footnote") && !(same(self.leaf, "definition_term") && !Boolean(self.leaf_first) && !test(K38, self.text)) && (test(K38, self.text) || someFrom(self.ancestors, 0, (item) => K39.has(item))))) return
  context.report("definition-in-container", num(group("label", 0)), num(group("label", 1)), path, {  }, 0)
  return
}

function rule13(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  if (!(same(self.leaf, "definition_term") && Boolean(self.leaf_first))) return
  if ((hit(K40, K41, self.body) && mark(num(self.body_start)))) {
    context.report("definition-term-block-folded", num(group("body", 0)), num(group("body", 1)), path, {  }, 0)
    return
  }
}

function rule14(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  if (!(same(self.body, "+") && !K2.has(self.leaf))) return
  if (test(K42, str(self.text).slice(0, (num(self.body_start) - num(self.start))))) {
    context.report("deprecated-continuation-marker", num(self.body_start), (num(self.body_start) + 1), path, {  }, 2)
    return
  }
  if (contains(self.ancestors, "list_item")) {
    context.report("deprecated-continuation-marker", num(self.body_start), (num(self.body_start) + 1), path, {  }, 1)
    return
  }
  context.report("deprecated-continuation-marker", num(self.body_start), (num(self.body_start) + 1), path, {  }, 0)
  return
}

function rule15(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  if (!(Boolean(self.attributed) && test(K43, str(self.text).slice(0, (num(self.opener_start) - num(self.start)))))) return
  context.report("deprecated-loose-attribute", num(self.start), num(self.end), path, {  }, 0)
  return
}

function rule16(self: ModelLine, path: string, context: LintContext): void {
  const line = self
  groups = undefined
  let v_run_start: unknown = UNSET
  if (!(test(K44, self.body) && (test(K45, textFrom(line, num((v_run_start === UNSET ? (v_run_start = aside(() => scan(line, scan(line, num(self.body_start), (" \t" + str(self.body).slice(0, 1)), -1), " \t", 1))) : v_run_start)))) || test(K46, textFrom(line, num((v_run_start === UNSET ? (v_run_start = aside(() => scan(line, scan(line, num(self.body_start), (" \t" + str(self.body).slice(0, 1)), -1), " \t", 1))) : v_run_start)))) || test(K47, textFrom(line, num((v_run_start === UNSET ? (v_run_start = aside(() => scan(line, scan(line, num(self.body_start), (" \t" + str(self.body).slice(0, 1)), -1), " \t", 1))) : v_run_start))))) && test(K48, textFrom(line, num((v_run_start === UNSET ? (v_run_start = aside(() => scan(line, scan(line, num(self.body_start), (" \t" + str(self.body).slice(0, 1)), -1), " \t", 1))) : v_run_start)))))) return
  context.report("deprecated-spaced-thematic-break", num((v_run_start === UNSET ? (v_run_start = aside(() => scan(line, scan(line, num(self.body_start), (" \t" + str(self.body).slice(0, 1)), -1), " \t", 1))) : v_run_start)), num(self.body_end), path, {  }, 0)
  return
}

function rule17(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  if (!(num(self.last_line?.["number"]) > num(self.line?.["number"]))) return
  if (!test(K49, self.line?.["next"]?.["body"])) {
    context.report("description-term-multi-line", num(self.line?.["next"]?.["body_start"]), num(self.line?.["next"]?.["end"]), path, {  }, 0)
    return
  }
  if ((self.line?.["next2"] !== undefined)) {
    context.report("description-term-multi-line", num(self.line?.["next2"]?.["body_start"]), num(self.line?.["next2"]?.["end"]), path, {  }, 0)
    return
  }
}

function rule18(self: ModelInline, path: string, context: LintContext): void {
  groups = undefined
  if (!starts(self.text, "{=")) return
  context.report("djot-highlight-braces", num(self.start), num(self.end), path, {  }, 0)
  return
}

function rule19(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  if (!(same(self.leaf, "paragraph") && test(K50, self.body))) return
  context.report("djot-plus-bullet", num(self.body_start), num(self.body_end), path, {  }, 0)
  return
}

function rule20(self: ModelInline, path: string, context: LintContext): void {
  groups = undefined
  if (!starts(self.text, "{~")) return
  context.report("djot-subscript-tilde-braced", num(self.start), num(self.end), path, {  }, 0)
  return
}

function rule21(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  if (!(K51.has(self.leaf) && contains(self.text, "{{"))) return
  const one = (): void => {
    context.report("empty-include-path", num(group("include", 0)), num(group("include", 1)), path, { "text": String(str(self.text).slice((num(group("include", 0)) - num(self.start)), (num(group("include", 1)) - num(self.start)))) }, 0)
    return
  }
  for (const found of matchAll(K52, self.text)) {
    groups = spansOf(found)
    base = num(self.start)
    one()
  }
}

function rule22(self: ModelInline, path: string, context: LintContext): void {
  groups = undefined
  if (!test(K53, self.text)) return
  context.report("empty-link-destination", num(self.start), num(self.end), path, {  }, 0)
  return
}

function rule23(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  if (!(K51.has(self.leaf) && (hit(K54, K55, self.body) && mark(num(self.body_start))) && !test(K56, self.body))) return
  if (starts(self.body, "[^")) {
    context.report("empty-reference-definition", num(group("def", 0)), num(group("def", 1)), path, { "label": String(str(self.body).slice(1, (str(self.body).length - 2))) }, 1)
    return
  }
  context.report("empty-reference-definition", num(group("def", 0)), num(group("def", 1)), path, { "label": String(str(self.body).slice(1, (str(self.body).length - 2))) }, 0)
  return
}

function rule24(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  let v_run: unknown = UNSET
  let v_at: unknown = UNSET
  if (!((num(self.last_line?.["number"]) > num(self.line?.["number"])) && (str((v_run === UNSET ? (v_run = aside(() => ((hit(K57, K58, self.line?.["text"]) && mark(num(self.line?.["start"]))) ? str(self.line?.["text"]).slice((num(group("run", 0)) - num(self.line?.["start"])), (num(group("run", 1)) - num(self.line?.["start"]))) : ""))) : v_run)).length >= 3) && (hit(K59, K60, self.last_line?.["text"]) && mark(num(self.last_line?.["start"]))) && test(K61, self.last_line?.["body"]) && !same((num(group("close", 0)) - num(self.last_line?.["start"])), (v_at === UNSET ? (v_at = aside(() => ((hit(K57, K58, self.line?.["text"]) && mark(num(self.line?.["start"]))) ? (num(group("run", 0)) - num(self.line?.["start"])) : -1))) : v_at)) && starts(str(self.last_line?.["text"]).slice((num(group("close", 0)) - num(self.last_line?.["start"]))), str((v_run === UNSET ? (v_run = aside(() => ((hit(K57, K58, self.line?.["text"]) && mark(num(self.line?.["start"]))) ? str(self.line?.["text"]).slice((num(group("run", 0)) - num(self.line?.["start"])), (num(group("run", 1)) - num(self.line?.["start"]))) : ""))) : v_run))))) return
  context.report("fence-closer-indented", num(group("close", 0)), num(self.last_line?.["end"]), path, {  }, 0)
  return
}

function rule25(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  if (!(test(K62, self.line?.["text"]) && test(K63, self.line?.["text"]))) return
  context.report("figure-group-opener-metadata", num(self.line?.["start"]), num(self.line?.["end"]), path, {  }, 0)
  return
}

function rule26(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  if (!(!same(self.parent?.["type"], "document") && test(K64, self.opener_text))) return
  context.report("footnotes-placement-in-container", num(self.start), num(self.end), path, {  }, 0)
  return
}

function rule27(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  if (!(test(K65, self.text) && (test(K66, self.text) || test(K67, self.text)))) return
  context.report("frontmatter-shaped-thematic-break", num(self.start), num(self.end), path, {  }, 0)
  return
}

function rule28(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  if (!(K68.has(self.leaf) && (hit(K69, K70, self.text) && mark(num(self.start))))) return
  context.report("github-alert-marker", num(group("mark", 0)), num(group("mark", 1)), path, {  }, 0)
  return
}

function rule29(self: ModelInline, path: string, context: LintContext): void {
  groups = undefined
  if (!test(K71, self.text)) return
  context.report("glob-shaped-strong", num(self.start), num(self.end), path, {  }, 0)
  return
}

function rule30(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  if (!((same(self.last_line?.["number"], self.line?.["number"]) && (hit(K72, K73, self.line?.["body"]) && mark(num(self.line?.["body_start"])))) || ((num(self.last_line?.["number"]) > num(self.line?.["number"])) && (hit(K74, K75, self.last_line?.["text"]) && mark(num(self.last_line?.["start"])))))) return
  context.report("heading-closing-hashes", num(group("run", 0)), num(group("run", 1)), path, { "run": String(str(self.last_line?.["text"]).slice((num(group("run", 0)) - num(self.last_line?.["start"])), (num(group("run", 1)) - num(self.last_line?.["start"])))) }, 0)
  return
}

function rule31(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  if (!(hit(K76, K77, self.last_line?.["text"]) && mark(num(self.last_line?.["start"])))) return
  context.report("heading-trailing-attribute", num(group("block", 0)), num(group("block", 1)), path, { "block": String(str(self.last_line?.["text"]).slice((num(group("block", 0)) - num(self.last_line?.["start"])), (num(group("block", 1)) - num(self.last_line?.["start"])))) }, 0)
  return
}

function rule32(self: ModelBlock, path: string, context: LintContext): void {
  const line = self.line
  groups = undefined
  if (!(same(self.parent?.["type"], "document") && (num(self.line?.["number"]) > 1) && test(K78, self.line?.["prev"]?.["text"]) && !same(self.prev_type, "list") && test(K79, self.line?.["text"]))) return
  context.report("indented-code-block", scan(line, num(self.line?.["start"]), " \t", 1), (num(self.line?.["start"]) + trimEnd(str(self.line?.["text"])).length), path, {  }, 0)
  return
}

function rule33(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  if (!((same(self.item_owner?.["type"], "list_item") && K80.has(self.parent?.["type"])) && (K81.has(self.type) || Boolean(self.image_line) || Boolean(self.attributed)) && (num(self.opener_column) > num(self.item_owner?.["content_column"])))) return
  context.report("list-item-block-overindented", num(self.start), num(self.line?.["end"]), path, { "contentColumn": String((num(self.item_owner?.["content_column"]) + 1)) }, 0)
  return
}

function rule34(self: ModelBlock, path: string, context: LintContext): void {
  groups = undefined
  if (!(same(self.parent?.["type"], "list_item") && (num(self.index) >= 1) && (num(self.column) > num(self.parent?.["marker_column"])) && (num(self.column) < num(self.parent?.["content_column"])))) return
  context.report("list-item-body-below-content-column", num(self.start), num(self.line?.["end"]), path, {  }, 0)
  return
}

function rule35(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  if (!((self.prev !== undefined) && K82.has(self.leaf) && same(self.prev?.["leaf_id"], self.leaf_id) && !Boolean(self.leaf_first) && test(K83, self.body))) return
  if ((same(self.leaf, "definition_term") || contains(self.ancestors, "definition_term") || contains(self.ancestors, "definition_description"))) {
    context.report("list-marker-without-blank-line", num(self.body_start), num(self.body_end), path, {  }, 1)
    return
  }
  context.report("list-marker-without-blank-line", num(self.body_start), num(self.body_end), path, {  }, 0)
  return
}

function rule36(self: ModelLine, path: string, context: LintContext): void {
  const line = self
  groups = undefined
  if (!((hit(K84, K85, self.text) && mark(num(self.start))) && (self.prev !== undefined) && same(self.prev?.["leaf"], "paragraph") && !Boolean(self.prev?.["blank"]) && (starts(textFrom(line, num(group("run", 0))), "-") || (same(self.leaf, "paragraph") && same(self.prev?.["leaf_id"], self.leaf_id))))) return
  context.report("setext-heading-underline", num(group("run", 0)), num(group("run", 1)), path, {  }, 0)
  return
}

function rule37(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  if (!(K51.has(self.leaf) && starts(self.body, "|") && !same(self.body, "|") && !test(K86, self.body))) return
  context.report("table-shaped-paragraph", num(self.body_start), num(self.body_end), path, { "owner": String((same(self.leaf, "definition_term") ? "term" : (same(self.leaf, "line") ? "line-block line" : self.leaf))) }, 0)
  return
}

function rule38(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  if (!(test(K87, self.body) && !(starts(self.body, "-") && same(self.prev?.["leaf"], "paragraph") && !Boolean(self.prev?.["blank"])) && !(same(self.number, 1) && same(self.body_start, self.start) && same(self.body, "---")))) return
  context.report("thematic-break-spelling", num(self.body_start), num(self.body_end), path, { "raw": String(self.body) }, 0)
  return
}

function rule39(self: ModelLine, path: string, context: LintContext): void {
  groups = undefined
  if (!(same(self.leaf, "paragraph") && Boolean(self.leaf_first) && same(self.shape, "attribute_line") && !Boolean(self.attached_here) && (!(self.leaf_next !== undefined) || Boolean(self.leaf_next?.["blank"]) || Boolean(self.leaf_next?.["closes_container"]) || !same(self.leaf_next?.["leaf_id"], self.leaf_id)))) return
  if ((Boolean(self.leaf_next?.["blank"]) && (num(self.leaf_next?.["quote_marks"]) >= num(self.quote_depth)))) {
    context.report("unattached-block-attribute", num(self.body_start), num(self.body_end), path, {  }, 1)
    return
  }
  context.report("unattached-block-attribute", num(self.body_start), num(self.body_end), path, {  }, 0)
  return
}

/** `only`: the leaf of a line, the parent type of a block or the parent of an inline record that the rule can match. */
export type DataRule =
  | { id: RuleId, over: 'line', types: undefined, verbatim: ReadonlySet<string>, only: ReadonlySet<string> | undefined, run: (self: ModelLine, path: string, context: LintContext) => void }
  | { id: RuleId, over: 'block', types: readonly string[] | undefined, verbatim: ReadonlySet<string>, only: ReadonlySet<string> | undefined, run: (self: ModelBlock, path: string, context: LintContext) => void }
  | { id: RuleId, over: 'inline', types: readonly string[] | undefined, verbatim: ReadonlySet<string>, only: ReadonlySet<string> | undefined, run: (self: ModelInline, path: string, context: LintContext) => void }

export const VERBATIM_LEAVES: ReadonlySet<string> = new Set(["code_block","comment_block","frontmatter","raw_block"])

export const DATA_RULES: readonly DataRule[] = [
  { id: "a11y/image-alt", over: "inline", types: ["image"], verbatim: new Set([]), only: undefined, run: rule0 },
  { id: "bare-html-tag", over: "line", types: undefined, verbatim: new Set([]), only: new Set(["heading","paragraph","table_cell","table_row"]), run: rule1 },
  { id: "blank-reference-label", over: "inline", types: ["text"], verbatim: new Set([]), only: undefined, run: rule2 },
  { id: "block-opener-overindented", over: "block", types: ["admonition","block_quote","code_block","definition_term","directive","div","figure_group","heading","line_block","raw_block","table","thematic_break"], verbatim: new Set([]), only: undefined, run: rule3 },
  { id: "block-opener-without-blank-line", over: "line", types: undefined, verbatim: new Set([]), only: new Set(["caption","paragraph"]), run: rule4 },
  { id: "blockquote-marker-without-space", over: "line", types: undefined, verbatim: new Set(["frontmatter"]), only: undefined, run: rule5 },
  { id: "braced-comment-in-a-template-source", over: "inline", types: ["comment"], verbatim: new Set([]), only: undefined, run: rule6 },
  { id: "caption-looking-paragraph", over: "line", types: undefined, verbatim: new Set([]), only: new Set(["paragraph"]), run: rule7 },
  { id: "colon-fence-length-mismatch", over: "line", types: undefined, verbatim: new Set([]), only: undefined, run: rule8 },
  { id: "comment-fence-closer-with-text", over: "line", types: undefined, verbatim: new Set(["comment_block"]), only: new Set(["comment_block"]), run: rule9 },
  { id: "comment-line-in-line-block", over: "block", types: ["line"], verbatim: new Set([]), only: undefined, run: rule10 },
  { id: "comment-shaped-emphasis", over: "inline", types: ["emphasis","strong"], verbatim: new Set([]), only: undefined, run: rule11 },
  { id: "definition-in-container", over: "line", types: undefined, verbatim: new Set([]), only: new Set(["caption","definition_term","line","paragraph"]), run: rule12 },
  { id: "definition-term-block-folded", over: "line", types: undefined, verbatim: new Set([]), only: new Set(["definition_term"]), run: rule13 },
  { id: "deprecated-continuation-marker", over: "line", types: undefined, verbatim: new Set([]), only: undefined, run: rule14 },
  { id: "deprecated-loose-attribute", over: "block", types: ["list"], verbatim: new Set([]), only: undefined, run: rule15 },
  { id: "deprecated-spaced-thematic-break", over: "line", types: undefined, verbatim: new Set([]), only: undefined, run: rule16 },
  { id: "description-term-multi-line", over: "block", types: ["definition_term"], verbatim: new Set([]), only: undefined, run: rule17 },
  { id: "djot-highlight-braces", over: "inline", types: ["highlight"], verbatim: new Set([]), only: undefined, run: rule18 },
  { id: "djot-plus-bullet", over: "line", types: undefined, verbatim: new Set([]), only: new Set(["paragraph"]), run: rule19 },
  { id: "djot-subscript-tilde-braced", over: "inline", types: ["strike"], verbatim: new Set([]), only: undefined, run: rule20 },
  { id: "empty-include-path", over: "line", types: undefined, verbatim: new Set([]), only: new Set(["caption","definition_term","heading","line","paragraph"]), run: rule21 },
  { id: "empty-link-destination", over: "inline", types: ["link"], verbatim: new Set([]), only: undefined, run: rule22 },
  { id: "empty-reference-definition", over: "line", types: undefined, verbatim: new Set([]), only: new Set(["caption","definition_term","heading","line","paragraph"]), run: rule23 },
  { id: "fence-closer-indented", over: "block", types: ["code_block"], verbatim: new Set([]), only: undefined, run: rule24 },
  { id: "figure-group-opener-metadata", over: "block", types: ["div"], verbatim: new Set([]), only: undefined, run: rule25 },
  { id: "footnotes-placement-in-container", over: "block", types: ["directive"], verbatim: new Set([]), only: undefined, run: rule26 },
  { id: "frontmatter-shaped-thematic-break", over: "block", types: ["frontmatter"], verbatim: new Set([]), only: undefined, run: rule27 },
  { id: "github-alert-marker", over: "line", types: undefined, verbatim: new Set([]), only: new Set(["heading","paragraph","table_cell","table_row"]), run: rule28 },
  { id: "glob-shaped-strong", over: "inline", types: ["strong"], verbatim: new Set([]), only: undefined, run: rule29 },
  { id: "heading-closing-hashes", over: "block", types: ["heading"], verbatim: new Set([]), only: undefined, run: rule30 },
  { id: "heading-trailing-attribute", over: "block", types: ["heading"], verbatim: new Set([]), only: undefined, run: rule31 },
  { id: "indented-code-block", over: "block", types: ["paragraph"], verbatim: new Set([]), only: new Set(["document"]), run: rule32 },
  { id: "list-item-block-overindented", over: "block", types: undefined, verbatim: new Set([]), only: new Set(["admonition","directive","div","figure_group","list_item"]), run: rule33 },
  { id: "list-item-body-below-content-column", over: "block", types: undefined, verbatim: new Set([]), only: new Set(["list_item"]), run: rule34 },
  { id: "list-marker-without-blank-line", over: "line", types: undefined, verbatim: new Set([]), only: new Set(["definition_term","paragraph"]), run: rule35 },
  { id: "setext-heading-underline", over: "line", types: undefined, verbatim: new Set([]), only: undefined, run: rule36 },
  { id: "table-shaped-paragraph", over: "line", types: undefined, verbatim: new Set([]), only: new Set(["caption","definition_term","heading","line","paragraph"]), run: rule37 },
  { id: "thematic-break-spelling", over: "line", types: undefined, verbatim: new Set([]), only: undefined, run: rule38 },
  { id: "unattached-block-attribute", over: "line", types: undefined, verbatim: new Set([]), only: new Set(["paragraph"]), run: rule39 },
]
