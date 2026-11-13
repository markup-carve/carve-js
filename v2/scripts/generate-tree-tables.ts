// Writes src/tree-tables.ts from data/div-names.json and data/task-states.json.
//   node v2/scripts/generate-tree-tables.ts
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

interface DivNames {
  names: { name: string, kind: string }[]
  sigils: { name: string, class?: string }[]
}

interface TaskStates {
  states: { char: string, mark: string, status: string, state_attribute: string | null, checked: boolean }[]
}

function sigilClass(names: DivNames, name: string): string {
  return names.sigils.find((sigil) => sigil.name === name)!.class!
}

/** The text of src/tree-tables.ts for the two data files. */
export function generateTreeTables(divJson: string, taskJson: string): string {
  const names = JSON.parse(divJson) as DivNames
  const tasks = JSON.parse(taskJson) as TaskStates
  const marks = tasks.states.filter((state) => state.char === state.mark)
  const checked = marks.filter((state) => state.checked).map((state) => state.mark)
  const noState = marks.filter((state) => state.state_attribute === null).map((state) => state.mark)
  const lines = [
    '// Generated from data/div-names.json and data/task-states.json by scripts/generate-tree-tables.ts. Do not edit.',
    '',
    '/** C2-A-066: the node type a div name gives. A name that is not here gives a plain div. */',
    'export const DIV_KINDS: ReadonlyMap<string, string> = new Map([',
    ...names.names.map((row) => `  [${JSON.stringify(row.name)}, ${JSON.stringify(row.kind)}],`),
    '])',
    '',
    `export const HARD_BREAKS_CLASS = ${JSON.stringify(sigilClass(names, 'hardbreak_block'))}`,
    `export const LINE_BLOCK_CLASS = ${JSON.stringify(sigilClass(names, 'line_block'))}`,
    '',
    '/** C2-A-061: the status of each task mark. */',
    'export const TASK_STATUS: ReadonlyMap<string, string> = new Map([',
    ...marks.map((state) => `  [${JSON.stringify(state.mark)}, ${JSON.stringify(state.status)}],`),
    '])',
    '',
    '/** C2-H-032, C2-H-033: the marks whose box is checked, and the marks that write no state attribute. */',
    `export const TASK_CHECKED: readonly string[] = ${JSON.stringify(checked)}`,
    `export const TASK_NO_STATE: readonly string[] = ${JSON.stringify(noState)}`,
    '',
  ]
  return lines.join('\n')
}

if (process.argv[1] === import.meta.filename) {
  const root = join(import.meta.dirname, '..')
  const read = (name: string): string => readFileSync(join(root, 'data', name), 'utf8')
  writeFileSync(join(root, 'src/tree-tables.ts'), generateTreeTables(read('div-names.json'), read('task-states.json')))
}
