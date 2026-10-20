import { expect, it } from 'vitest'
import { migrateMarkdown } from '../src/index.js'

// cmark-gfm drops exactly one backslash before a table pipe, whatever the run length.
const shapes: Record<string, (b: string) => string> = {
  text: b => `| x${b}|y | z |\n|---|---|\n`,
  autolink: b => `| <https://e.com/a${b}|b> | z |\n|---|---|\n`,
  'bare URL': b => `| https://e.com/a${b}|b | z |\n|---|---|\n`,
  'link destination': b => `| [l](https://e.com/a${b}|b) | z |\n|---|---|\n`,
  'code span': b => `| \`x${b}|y\` | z |\n|---|---|\n`,
}

it.each(Object.entries(shapes).flatMap(([name, make]) => [1, 2, 3, 4, 5, 6].map(count => [`${name}, ${count} backslashes`, make('\\'.repeat(count))] as const)))(
  'assesses %s completely', (_name, source) => {
    const codes = migrateMarkdown(source).report.diagnostics.map(row => row.code)
    expect(codes).not.toContain('fidelity-unverified')
    expect(codes).toContain('markdown-table-cell')
  },
)
