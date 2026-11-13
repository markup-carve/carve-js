// Generated from the inline data files in data/ by scripts/generate-inline.ts. Do not edit.

export const CLASS_SCHEME_FIRST = 1
export const CLASS_SCHEME_REST = 2
export const CLASS_URL_BODY = 4
export const CLASS_EMAIL_LOCAL = 8
export const CLASS_EMAIL_DOMAIN = 16
export const CLASS_EMAIL_LAST = 32
export const CLASS_RAW_FIRST = 64
export const CLASS_RAW_REST = 128
export const CLASS_EXTENSION_FIRST = 256
export const CLASS_EXTENSION_REST = 512
export const CLASS_SYMBOL_FIRST = 1024
export const CLASS_SYMBOL_REST = 2048
export const CLASS_MENTION = 4096
export const CLASS_NAME = 8192
export const CLASS_KEY_FIRST = 16384
export const CLASS_KEY_REST = 32768
export const CLASS_BARE_KEY_FIRST = 65536
export const CLASS_LANGUAGE = 131072
export const CLASS_VALUE_END = 262144
export const CLASS_BRACED_MARK = 524288
export const CLASS_QUOTE_OPENS_AFTER = 1048576
export const CLASS_QUOTE_CLOSES_BEFORE = 2097152
export const CLASS_SMART_TRIGGER = 4194304

/** The classes of each ASCII character. */
export const CHARACTER_CLASSES: readonly number[] = [
  0, 0, 0, 0, 0, 0, 0, 0, 0, 262144, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  262144, 6291460, 6553600, 4, 4, 4, 4, 6553604, 5242884, 2097156, 524292, 4721694, 2621444, 4767390, 6291486, 1572868,
  179870, 179870, 179870, 179870, 179870, 179870, 179870, 179870, 179870, 179870, 3145732, 2097156, 4194304, 5767172, 4194304, 2097156,
  4, 262143, 262143, 262143, 262143, 262143, 262143, 262143, 262143, 262143, 262143, 262143, 262143, 262143, 262143, 262143,
  262143, 262143, 262143, 262143, 262143, 262143, 262143, 262143, 262143, 262143, 262143, 1048580, 262144, 2097156, 524288, 588764,
  0, 262143, 262143, 262143, 262143, 262143, 262143, 262143, 262143, 262143, 262143, 262143, 262143, 262143, 262143, 262143,
  262143, 262143, 262143, 262143, 262143, 262143, 262143, 262143, 262143, 262143, 262143, 1048576, 262144, 262144, 524292, 0,
]

export const SMART_ELLIPSIS = 0
export const SMART_EM_DASH = 1
export const SMART_EN_DASH = 2
export const SMART_GREATER_THAN_OR_EQUAL = 3
export const SMART_LEFT_DOUBLE_QUOTE = 4
export const SMART_LEFT_RIGHT_ARROW = 5
export const SMART_LEFT_RIGHT_DOUBLE_ARROW = 6
export const SMART_LEFT_SINGLE_QUOTE = 7
export const SMART_LEFTWARDS_ARROW = 8
export const SMART_LEFTWARDS_DOUBLE_ARROW = 9
export const SMART_LESS_THAN_OR_EQUAL = 10
export const SMART_NOT_EQUAL = 11
export const SMART_PLUS_MINUS = 12
export const SMART_RIGHT_DOUBLE_QUOTE = 13
export const SMART_RIGHT_SINGLE_QUOTE = 14
export const SMART_RIGHTWARDS_ARROW = 15
export const SMART_RIGHTWARDS_DOUBLE_ARROW = 16
export const SMART_TRADEMARK = 17

export const SMART_KIND_NAMES: readonly string[] = [
  "ellipsis", "em_dash", "en_dash", "greater_than_or_equal", "left_double_quote", "left_right_arrow", "left_right_double_arrow",
  "left_single_quote", "leftwards_arrow", "leftwards_double_arrow", "less_than_or_equal", "not_equal", "plus_minus", "right_double_quote",
  "right_single_quote", "rightwards_arrow", "rightwards_double_arrow", "trademark",
]
export const SMART_GLYPHS: readonly string[] = ["…","—","–","≥","“","↔","⇔","‘","←","⇐","≤","≠","±","”","’","→","⇒","™"]

/** The replaced runs, the longest first, as [source, kind]. */
export const SMART_RUNS: readonly (readonly [string, number])[] = [
  ["(tm)", 17],
  ["<-->", 5],
  ["-->", 15],
  ["...", 0],
  ["<--", 8],
  ["<==", 9],
  ["<=>", 6],
  ["==>", 16],
  ["!=", 11],
  ["+-", 12],
  ["<=", 10],
  [">=", 3],
]

export const APOSTROPHE_WORDS: readonly string[] = ["bout","cause","em","n","til","tis","tisn","twas","twasn","twere","twill","twould"]

/** The marks of the braced forms, the node each makes, and the marks that are bare delimiters. */
export const BRACED_MARKS = "*+,-/=^_~"
export const BRACED_NODES: readonly string[] = [
  "strong", "insert", "subscript", "delete", "emphasis", "highlight", "superscript", "underline", "strike",
]
export const BARE_MARKS = "/*"

export const DEPTH_CAP = 200
