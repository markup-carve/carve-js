import { describe, expect, it } from 'vitest'

import { parse, renderAnsi, renderMarkdown, renderPlainText } from '../src/index.js'

const source = `[^outer]: intro

     [^inner]: note

     see[^inner]

see[^outer]
`

describe('non-HTML footnote definition order', () => {
  const document = parse(source)

  it.each([
    ['markdown', () => renderMarkdown(document), 'see[^outer]\n\n[^outer]: intro\n\nsee[^inner]\n[^inner]: note\n'],
    ['plain', () => renderPlainText(document), 'see[outer]\n\n[^outer]: intro\n\nsee[inner]\n[^inner]: note\n'],
    ['ansi', () => renderAnsi(document), 'see[outer]\n\n[^outer] intro\n\nsee[inner]\n[^inner] note\n'],
  ])('writes first-referenced outer before nested inner in %s', (_target, render, expected) => {
    expect(render().replace(/\x1b\[[0-9;]*m/g, '')).toBe(expected)
  })
})
