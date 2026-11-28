// Generated from data/options.json by scripts/generate-option-tables.ts. Do not edit.

/** C2-H-137: the options, and the stage that reads each. */
export const OPTION_KINDS: ReadonlyMap<string, string> = new Map([
  ["adapter", "import"],
  ["alignTables", "format"],
  ["allowLosses", "render"],
  ["codeBlockRenderer", "render"],
  ["extensions", "parse"],
  ["headingIds", "resolution"],
  ["headingShift", "render"],
  ["includes", "parse"],
  ["labels", "render"],
  ["listTable", "import"],
  ["maxLosses", "render"],
  ["mode", "render"],
  ["normalize", "format"],
  ["platforms", "lint"],
  ["profile", "render"],
  ["rawHtml", "render"],
  ["renderers", "render"],
  ["roundtrip", "render"],
  ["rules", "lint"],
  ["sections", "render"],
  ["smartTypography", "render"],
  ["social", "render"],
  ["softBreak", "render"],
  ["sourceLines", "render"],
  ["strictLosses", "render"],
  ["symbols", "render"],
  ["upgrade", "lint"],
  ["urlPolicy", "render"],
])

/** C2-H-137: the declared type of each option, checked before anything else is read of it. */
export const OPTION_TYPES: ReadonlyMap<string, string> = new Map([
  ["adapter", "enum"],
  ["alignTables", "boolean"],
  ["allowLosses", "list"],
  ["codeBlockRenderer", "structure"],
  ["extensions", "list"],
  ["headingIds", "enum"],
  ["headingShift", "count"],
  ["includes", "structure"],
  ["labels", "map"],
  ["listTable", "boolean"],
  ["maxLosses", "count"],
  ["mode", "enum"],
  ["normalize", "boolean"],
  ["platforms", "list"],
  ["profile", "enum"],
  ["rawHtml", "boolean"],
  ["renderers", "map"],
  ["roundtrip", "boolean"],
  ["rules", "map"],
  ["sections", "boolean"],
  ["smartTypography", "boolean"],
  ["social", "structure"],
  ["softBreak", "enum"],
  ["sourceLines", "boolean"],
  ["strictLosses", "boolean"],
  ["symbols", "map"],
  ["upgrade", "boolean"],
  ["urlPolicy", "structure"],
])

/** The options whose default is null, which take null as that default. */
export const NULL_DEFAULTS: readonly string[] = ["codeBlockRenderer","includes","social"]

export const ENUM_VALUES: ReadonlyMap<string, readonly string[]> = new Map([
  ["adapter", ["generic","tiptap","prosemirror","ckeditor","tinymce","word","google-docs"]],
  ["headingIds", ["off","keep-case","lower","ascii","ascii-lower","ascii-strict","ascii-strict-lower"]],
  ["mode", ["interactive","static"]],
  ["profile", ["full","article","comment","minimal"]],
  ["softBreak", ["newline","space","br"]],
])

export const ENUM_DEFAULTS: ReadonlyMap<string, string> = new Map([
  ["adapter", "generic"],
  ["headingIds", "keep-case"],
  ["mode", "interactive"],
  ["profile", "full"],
  ["softBreak", "newline"],
])

export const BOOLEAN_DEFAULTS: ReadonlyMap<string, boolean> = new Map([
  ["alignTables", false],
  ["listTable", false],
  ["normalize", false],
  ["rawHtml", false],
  ["roundtrip", false],
  ["sections", true],
  ["smartTypography", true],
  ["sourceLines", false],
  ["strictLosses", false],
  ["upgrade", false],
])

export const COUNT_DEFAULTS: ReadonlyMap<string, number> = new Map([
  ["headingShift", 0],
  ["maxLosses", 100],
])

/** The largest value of each count option that has one; a larger value is refused. */
export const COUNT_MAXIMA: ReadonlyMap<string, number> = new Map([
  ["headingShift", 5],
])

/** C2-H-204: the codes of the render-loss channel, the values `allowLosses` takes. */
export const RENDER_LOSS_CODES: readonly string[] = [
  "carrier-attribute-dropped", "derived-text-budget", "destination-denied", "extension-fallback-rendered", "extension-renderer-failed",
  "extension-transform-failed", "field-unspellable", "heading-shift-above-6", "image-alt-unknown", "import-attribute-dropped",
  "import-carrier-ignored", "import-destination-denied", "import-element-dropped", "import-element-mapped", "import-structure-repaired",
  "import-whitespace-normalized", "include-expanded-roundtrip", "include-unresolved", "migration-loss", "profile-construct-degraded",
  "raw-format-dropped", "snippet-cycle", "snippet-depth", "snippet-node-budget", "snippet-scope-loss", "snippet-unexpanded-transform",
  "snippet-unresolved", "structure-unspellable", "writer-refused",
]

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
export const DEFAULT_DENIED_SCHEMES: readonly string[] = [
  "javascript", "vbscript", "data", "file", "ms-msdt", "ms-office", "ms-word", "ms-excel", "ms-powerpoint", "ms-access", "ms-visio",
  "ms-project", "ms-publisher", "ms-infopath", "ms-spd", "ms-search", "search-ms", "ms-cxh", "ms-cxh-full", "shell", "vscode",
  "vscode-insiders", "jar",
]
