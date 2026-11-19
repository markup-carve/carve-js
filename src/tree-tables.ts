// Generated from data/div-names.json and data/task-states.json by scripts/generate-tree-tables.ts. Do not edit.

/** C2-A-066: the node type a div name gives. A name that is not here gives a plain div. */
export const DIV_KINDS: ReadonlyMap<string, string> = new Map([
  ["bibliography", "directive"],
  ["danger", "admonition"],
  ["example", "admonition"],
  ["figure", "figure_group"],
  ["footnotes", "directive"],
  ["glossary", "directive"],
  ["index", "directive"],
  ["info", "admonition"],
  ["note", "admonition"],
  ["quote", "admonition"],
  ["references", "directive"],
  ["success", "admonition"],
  ["tip", "admonition"],
  ["toc", "directive"],
  ["warning", "admonition"],
])

export const HARD_BREAKS_CLASS = "hardbreaks"
export const LINE_BLOCK_CLASS = "line-block"

/** C2-A-061: the status of each task mark. */
export const TASK_STATUS: ReadonlyMap<string, string> = new Map([
  [" ", "todo"],
  ["!", "blocked"],
  ["-", "canceled"],
  ["/", "in-progress"],
  [">", "partial"],
  ["?", "other"],
  ["_", "todo"],
  ["x", "done"],
])

/** C2-H-032, C2-H-033: the marks whose box is checked, and the marks that write no state attribute. */
export const TASK_CHECKED: readonly string[] = ["x"]
export const TASK_NO_STATE: readonly string[] = [" "]
