import { expect, it } from 'vitest'
import { parse, type UnclosedContainer } from '../src/parse.js'
import { inspectColonFences } from '../src/parse/block/colon-fences.js'

it('inspects the existing positioned tree and unclosed sites exactly as a standalone parse', () => {
  for (const source of [
    ':::: note\nbody\n:::\n',
    ':::: note\n::: tip\nchild\n:::\n::::\n',
    '- item\n\n    :::: note\n    body\n    :#:\n',
    ':::: note\n```\n:::\n```\n::::\n',
  ]) {
    const unclosed: UnclosedContainer[] = []
    const document = parse(source, { positions: true, onUnclosedContainer: site => unclosed.push(site) })
    expect(inspectColonFences(source, { document, unclosed })).toEqual(inspectColonFences(source))
  }
})
