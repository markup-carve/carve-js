import { beforeAll } from 'vitest'
import type { Suite, Task } from 'vitest'
import ledger from './rule-a-todo.json'

// Tests that differ from the spec model on the rule A branch, keyed by file and full
// name, with their ticket (carve-js#3874). A repeated name carries its occurrence: `name [2]`.
const entries = ledger as Record<string, Record<string, string>>

beforeAll((suite) => {
  const file = (suite as Suite & { filepath?: string }).filepath?.split('/test/').pop()
  const todo = file === undefined ? undefined : entries[file]
  if (todo === undefined) return
  const tests: Array<{ task: Task; name: string }> = []
  const visit = (task: Task, path: string[]): void => {
    if (task.type === 'suite') for (const child of task.tasks) visit(child, [...path, task.name])
    else tests.push({ task, name: [...path, task.name].join(' > ') })
  }
  for (const child of (suite as Suite).tasks) visit(child, [])
  const total = new Map<string, number>()
  for (const { name } of tests) total.set(name, (total.get(name) ?? 0) + 1)
  const seen = new Map<string, number>()
  for (const { task, name } of tests) {
    const count = (seen.get(name) ?? 0) + 1
    seen.set(name, count)
    const ticket = todo[total.get(name) === 1 ? name : `${name} [${count}]`]
    if (ticket === undefined || task.mode !== 'run') continue
    task.mode = 'todo'
    task.name = `${task.name} (todo ${ticket})`
  }
})
