// Generated from data/includes.json, data/limits.json and data/lint-rules.json by
// scripts/generate-include-tables.ts. Do not edit.

/** C2-N-061: one failure cause, its code, and whether it is tested before, by or after the resolver. */
export interface IncludeCause {
  name: string
  code: string
  stage: string
}

/** C2-N-061: the causes in the order they are tested. */
export const INCLUDE_CAUSES: ReadonlyMap<string, IncludeCause> = new Map([
  ["no_resolver", {"name":"no_resolver","code":"include-no-resolver","stage":"before_resolver"}],
  ["option_invalid", {"name":"option_invalid","code":"include-option-invalid","stage":"before_resolver"}],
  ["conflict", {"name":"conflict","code":"include-selection-conflict","stage":"before_resolver"}],
  ["depth", {"name":"depth","code":"include-depth","stage":"before_resolver"}],
  ["size_spent", {"name":"size_spent","code":"include-budget","stage":"before_resolver"}],
  ["outside_root", {"name":"outside_root","code":"include-outside-root","stage":"resolver"}],
  ["not_found", {"name":"not_found","code":"include-not-found","stage":"resolver"}],
  ["unreadable", {"name":"unreadable","code":"include-unreadable","stage":"resolver"}],
  ["non_text", {"name":"non_text","code":"include-non-text","stage":"resolver"}],
  ["cycle", {"name":"cycle","code":"include-cycle","stage":"after_resolver"}],
  ["size_exceeded", {"name":"size_exceeded","code":"include-budget","stage":"after_resolver"}],
  ["section_missing", {"name":"section_missing","code":"include-section","stage":"after_resolver"}],
  ["region_invalid", {"name":"region_invalid","code":"include-region-invalid","stage":"after_resolver"}],
  ["lines_past_end", {"name":"lines_past_end","code":"include-lines-out-of-range","stage":"after_resolver"}],
  ["rows_past_end", {"name":"rows_past_end","code":"include-rows-out-of-range","stage":"after_resolver"}],
  ["cols_invalid", {"name":"cols_invalid","code":"include-cols-invalid","stage":"after_resolver"}],
  ["cols_duplicate", {"name":"cols_duplicate","code":"include-cols-duplicate","stage":"after_resolver"}],
])

/** C2-N-024: the option combinations that keep an include from being expanded. */
export interface IncludeConflict {
  name: string
  rule: string
  options: readonly string[]
}

export const INCLUDE_CONFLICTS: readonly IncludeConflict[] = [
  {"name":"cols_needs_table","rule":"requires_table_code","options":["cols"]},
  {"name":"rows_needs_table","rule":"requires_table_code","options":["rows"]},
  {"name":"section_with_code","rule":"exclusive","options":["section","code"]},
  {"name":"two_selections","rule":"at_most_one","options":["section","lines","region","rows"]},
]

export const INCLUDE_BYTES = 8388608
export const INCLUDE_DEPTH = 16

/** The message templates of the include codes, in which `${name}` stands for a value. */
export const INCLUDE_MESSAGES: ReadonlyMap<string, string> = new Map([
  ["include-budget",
    "Include \"${path}\" was not expanded: the included texts reach the size cap of ${limit} bytes."],
  ["include-cols-duplicate",
    "Include \"${path}\" was not expanded: @cols names the column ${name} twice."],
  ["include-cols-invalid",
    "Include \"${path}\" was not expanded: @cols ${reason}."],
  ["include-cycle",
    "Include \"${path}\" was not expanded: it would include a file that is already being included."],
  ["include-depth",
    "Include \"${path}\" was not expanded: it is nested deeper than ${limit} levels."],
  ["include-expanded-roundtrip",
    "Include \"${path}\" was expanded, so the roundtrip HTML holds the included content and not the directive."],
  ["include-heading-clamp",
    "A shift moves the heading \"${text}\" outside levels 1 to 6; it is kept at level ${level}."],
  ["include-lines-out-of-range",
    "Include \"${path}\" was not expanded: @lines starts past the last line of the file."],
  ["include-no-resolver",
    "Include \"${path}\" was not expanded: no include resolver is configured."],
  ["include-non-text",
    "Include \"${path}\" was not expanded: the file is not text."],
  ["include-not-found",
    "Include \"${path}\" was not expanded: the file does not exist."],
  ["include-option-invalid",
    "The include option ${option} ${reason}, so the include is not expanded. Correct it or remove it."],
  ["include-outside-root",
    "Include \"${path}\" was not expanded: the path leads outside the include root."],
  ["include-region-invalid",
    "Include \"${path}\" was not expanded: the region ${name} ${reason}."],
  ["include-rows-out-of-range",
    "Include \"${path}\" was not expanded: @rows starts past the last record."],
  ["include-section",
    "Include \"${path}\" was not expanded: no heading or block has the id ${name}."],
  ["include-selection-conflict",
    "Include \"${path}\" was not expanded: ${reason}."],
  ["include-unreadable",
    "Include \"${path}\" was not expanded: the file cannot be read."],
  ["include-unresolved",
    "Include \"${path}\" could not be resolved."],
])
