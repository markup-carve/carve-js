// Generated from data/options.json by scripts/generate-option-tables.ts. Do not edit.

/** C2-H-137: the options, and the stage that reads each. */
export const OPTION_KINDS: ReadonlyMap<string, string> = new Map([
  ["alignTables", "format"],
  ["extensions", "parse"],
  ["headingIds", "resolution"],
  ["includes", "parse"],
  ["labels", "render"],
  ["mode", "render"],
  ["platforms", "lint"],
  ["profile", "render"],
  ["rawHtml", "render"],
  ["renderers", "render"],
  ["roundtrip", "render"],
  ["rules", "lint"],
  ["sections", "render"],
  ["smartTypography", "render"],
  ["social", "render"],
  ["sourceLines", "render"],
  ["strictLosses", "render"],
  ["symbols", "render"],
  ["urlPolicy", "render"],
])

export const ENUM_VALUES: ReadonlyMap<string, readonly string[]> = new Map([
  ["headingIds", ["off","keep-case","lower","ascii"]],
  ["mode", ["interactive","static"]],
  ["profile", ["full","article","comment","minimal"]],
])

export const ENUM_DEFAULTS: ReadonlyMap<string, string> = new Map([
  ["headingIds", "keep-case"],
  ["mode", "interactive"],
  ["profile", "full"],
])

export const BOOLEAN_DEFAULTS: ReadonlyMap<string, boolean> = new Map([
  ["alignTables", false],
  ["rawHtml", false],
  ["roundtrip", false],
  ["sections", true],
  ["smartTypography", true],
  ["sourceLines", false],
  ["strictLosses", false],
])

/** C2-H-125: the English strings the engine writes itself. */
export const DEFAULT_LABELS: Readonly<Record<string, string>> = {
  "footnoteBacklink": "Back to reference",
  "indexBackref": "Back to",
  "tabsGroup": "Tabs",
  "codeGroup": "Code examples",
  "endnotes": "Footnotes",
  "tocNav": "Table of contents",
  "admonitionNote": "Note",
  "admonitionTip": "Tip",
  "admonitionWarning": "Warning",
  "admonitionDanger": "Danger",
  "admonitionInfo": "Info",
  "admonitionSuccess": "Success",
  "admonitionExample": "Example",
  "admonitionQuote": "Quote"
}

/** C2-H-128: the schemes the default URL policy denies. */
export const DEFAULT_DENIED_SCHEMES: readonly string[] = ["javascript","vbscript","data","file","ms-msdt","ms-office","ms-word","ms-excel","ms-powerpoint","ms-access","ms-visio","ms-project","ms-publisher","ms-infopath","ms-spd","ms-search","search-ms","ms-cxh","ms-cxh-full","shell","vscode","vscode-insiders","jar"]
