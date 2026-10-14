import { describe, expect, it } from 'vitest'
import { expandIncludes, findDirectiveSites, parse, renderCarve } from '../src/index.js'
import { expectScansLinearly, perfIt } from './helpers/scaling.js'

/**
 * Each `{{` candidate in an inline run asks which run node holds its first and
 * last character: is it escaped, where does it sit in the source. Answering by
 * walking the run from its start made a run of many candidates quadratic.
 */
const SHAPES = [
  ['escaped candidates', '\\{{ a.crv }} '],
  ['escaped and live candidates', '\\{{ a.crv }} {{ b.crv }} '],
  ['live candidates in one text node', '{{ b.crv }} '],
] as const

describe('a run of directive candidates scans linearly', () => {
  for (const [label, fragment] of SHAPES) {
    perfIt(`expandIncludes over ${label}`, () => {
      expectScansLinearly((source) => {
        expandIncludes(parse(source, { positions: true }), source, { resolve: () => null })
      }, fragment, { label, smallRepeats: 1_000, suffix: '\n' })
    })

    perfIt(`findDirectiveSites over ${label}`, () => {
      expectScansLinearly((source) => {
        findDirectiveSites(parse(source, { positions: true }))
      }, fragment, { label, smallRepeats: 1_000, suffix: '\n' })
    })

    perfIt(`renderCarve over ${label}`, () => {
      expectScansLinearly((source) => {
        renderCarve(parse(source))
      }, fragment, { label, smallRepeats: 1_000, suffix: '\n' })
    })
  }

  it('reports site offsets in codepoints past astral characters in the same node', () => {
    const source = '\u{1F600} {{ a.crv }} \u{1F600}\u{1F600} {{ b.crv }} end\n'
    const codepoints = [...source]

    const sites = findDirectiveSites(parse(source, { positions: true }))

    expect(sites.map((site) => codepoints.slice(site.start, site.end).join(''))).toEqual([
      '{{ a.crv }}',
      '{{ b.crv }}',
    ])
  })
})
