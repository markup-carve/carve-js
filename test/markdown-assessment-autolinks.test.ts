import { expect, it } from 'vitest'
import { migrateMarkdown } from '../src/index.js'

const rows = (source: string) => migrateMarkdown(source).report.diagnostics

it.each([
  ['a triple-backslash pipe in a table autolink', '| <https://example.com/a\\\\\\|b> | z |\n|---|---|\n', 'markdown-autolink'],
  ['a mailto autolink in a table cell', '| <mailto:a@b.co> | z |\n|---|---|\n', 'markdown-autolink'],
  ['a mailto autolink in a paragraph', 'x <mailto:a@b.co> y\n', 'markdown-autolink'],
  ['a bare URL with an escaped pipe in a table cell', '| https://e.com/a\\|b | z |\n|---|---|\n', 'markdown-bare-autolink'],
  ['a space inside an angle autolink in a table cell', '| <https://e.com/a b\\|c> | z |\n|---|---|\n', 'markdown-bare-autolink'],
  ['a space inside an angle autolink in a paragraph', 'x <https://e.com/a b> y\n', 'markdown-bare-autolink'],
])('assesses %s completely', (_name, source, code) => {
  const diagnostics = rows(source)
  expect(diagnostics.some(row => row.code === 'fidelity-unverified')).toBe(false)
  expect(diagnostics).toContainEqual(expect.objectContaining({ code, fidelity: 'normalized', confidence: 'exact' }))
})
