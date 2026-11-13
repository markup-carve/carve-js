// Generated from data/heading-slug.json, data/url-policy.json and data/include-options.json by
// scripts/generate-render-tables.ts. Do not edit.

/** C2-H-144: the code points that never reach a slug. */
export const SLUG_REMOVED: readonly number[] = [173,8203,8204,8205,8234,8235,8236,8237,8238,8288,8294,8295,8296,8297,65279]

/** C2-H-145: the glyphs a slug writes as their ASCII source. */
export const SLUG_REVERSED: ReadonlyMap<string, string> = new Map([
  ["«", "\""],
  ["±", "+-"],
  ["»", "\""],
  ["–", "-"],
  ["—", "-"],
  ["‘", "'"],
  ["’", "'"],
  ["‚", "'"],
  ["“", "\""],
  ["”", "\""],
  ["„", "\""],
  ["‟", "\""],
  ["…", "..."],
  ["™", "(tm)"],
  ["←", "<--"],
  ["→", "-->"],
  ["↔", "<-->"],
  ["⇐", "<=="],
  ["⇒", "==>"],
  ["⇔", "<=>"],
  ["≠", "!="],
  ["≤", "<="],
  ["≥", ">="],
])

/** C2-H-159: the ranges of code points that are removed from a destination before its scheme is read. */
export const PROBE_REMOVED: readonly (readonly [number, number])[] = [[0,32],[127,160],[5760,5760],[8192,8202],[8232,8233],[8239,8239],[8287,8287],[12288,12288],[65279,65279]]

/** C2-H-161: the attribute names that are never written, and the prefixes of such names. */
export const DROPPED_NAMES: readonly string[] = ["formaction","srcdoc"]
export const DROPPED_PREFIXES: readonly string[] = ["on"]

/** C2-H-161: the attributes that hold a list of URLs, and whether a comma separates its entries besides whitespace. */
export const URL_LIST_ATTRIBUTES: ReadonlyMap<string, boolean> = new Map([
  ["attributionsrc", false],
  ["imagesrcset", true],
  ["ping", false],
  ["srcset", true],
])

/** C2-H-162: the texts that blank a `style` value. */
export const STYLE_PATTERNS: readonly string[] = ["-moz-binding","@import","behavior:","expression(","url("]

/** C2-H-163: what a profile accepts. A list that is null does not restrict, and -1 is no bound. */
export interface ProfileRule {
  deniedBlock: readonly string[] | null
  deniedInline: readonly string[] | null
  allowedBlock: readonly string[] | null
  allowedInline: readonly string[] | null
  linkRel: string
  maxNesting: number
  maxLength: number
}

export const PROFILES: ReadonlyMap<string, ProfileRule> = new Map([
  ["article", { deniedBlock: ["raw_block"], deniedInline: ["raw_inline"], allowedBlock: null, allowedInline: null, linkRel: "", maxNesting: -1, maxLength: -1 }],
  ["comment", { deniedBlock: null, deniedInline: null, allowedBlock: ["block_quote","code_block","list","list_item","paragraph"], allowedInline: ["code","delete","emphasis","hard_break","highlight","inline_extension","insert","link","literal_inline","mention","soft_break","strike","strong","subscript","superscript","text","underline"], linkRel: "nofollow ugc", maxNesting: 4, maxLength: 100000 }],
  ["full", { deniedBlock: null, deniedInline: null, allowedBlock: null, allowedInline: null, linkRel: "", maxNesting: -1, maxLength: -1 }],
  ["minimal", { deniedBlock: null, deniedInline: null, allowedBlock: ["list","list_item","paragraph"], allowedInline: ["code","delete","emphasis","hard_break","inline_extension","insert","literal_inline","mention","soft_break","strike","strong","subscript","superscript","text","underline"], linkRel: "", maxNesting: 2, maxLength: 10000 }],
])

/** C2-B-205, C2-B-206: the shape of the value of each include option, and what a line is when the option has no value, a value outside the shape, or stands twice. */
export interface IncludeOptionRule {
  value: string
  withoutValue: string
  outsideShape: string
  repeated: string
}

/** In the order of C2-A-181. */
export const INCLUDE_OPTIONS: ReadonlyMap<string, IncludeOptionRule> = new Map([
  ["lines", { value: "range", withoutValue: "paragraph", outsideShape: "include_node", repeated: "paragraph" }],
  ["region", { value: "identifier", withoutValue: "paragraph", outsideShape: "paragraph", repeated: "paragraph" }],
  ["rows", { value: "range", withoutValue: "include_node", outsideShape: "include_node", repeated: "include_node" }],
  ["cols", { value: "range_or_names", withoutValue: "include_node", outsideShape: "include_node", repeated: "include_node" }],
  ["shift", { value: "signed_integer_or_auto", withoutValue: "paragraph", outsideShape: "paragraph", repeated: "paragraph" }],
  ["code", { value: "language", withoutValue: "valid", outsideShape: "paragraph", repeated: "paragraph" }],
])
