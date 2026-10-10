import { expect, it } from 'vitest'
import { parse, renderMarkdown } from '../src/index.js'
import cases from './fixtures/markdown-code-span-whitespace.json'

function setCodeValue(node: unknown, value: string): void {
  if (Array.isArray(node)) {
    for (const child of node) setCodeValue(child, value)
  } else if (node !== null && typeof node === 'object') {
    const record = node as Record<string, unknown>
    if (record.type === 'code') record.value = value
    for (const [key, child] of Object.entries(record)) {
      if (key !== 'pos') setCodeValue(child, value)
    }
  }
}

it.each(cases)('keeps the GFM code payload for $template with $value', ({ template, value, markdown }) => {
  const document = parse(template)
  setCodeValue(document, value)
  expect(renderMarkdown(document)).toBe(markdown)
})
