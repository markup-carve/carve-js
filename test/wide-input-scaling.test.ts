// Scaling guards of the 0.2 engine and its HTML importer on wide input (review of commit ee68ffaa, F6 and F7).
import { describe } from 'vitest'
import { parse, render, tabsExtensions, tabsRenderer } from '../src/index.ts'
import { importDocument } from '../import/src/index.ts'
import { expectBuiltInputScansLinearly, perfIt } from './helpers/scaling.ts'

const MALFORMED_HEADING = [0x23, 0x20, 0xff, 0x0a, 0x0a]

function malformedHeadings(count: number): Uint8Array {
  const bytes = new Uint8Array(count * MALFORMED_HEADING.length)
  for (let at = 0; at < bytes.length; at++) bytes[at] = MALFORMED_HEADING[at % MALFORMED_HEADING.length]!
  return bytes
}

describe('the 0.2 engine on wide input', () => {
  perfIt('C2-B-218: positions of a byte source with a malformed byte in every heading scale linearly (F6)', () => {
    expectBuiltInputScansLinearly(source => { parse(malformedHeadings(source.length)) }, count => 'x'.repeat(count),
      { smallRepeats: 4_000, label: 'malformed heading bytes' })
  })

  perfIt('C2-X-044: generated ids of many tab groups scale linearly (F7)', () => {
    const options = { extensions: tabsExtensions, renderers: { 'carve.tabs': tabsRenderer } }
    expectBuiltInputScansLinearly(source => { render(source, options) },
      count => '::: tabs\n:::: tab "A"\nx\n::::\n:::\n\n'.repeat(count), { smallRepeats: 1_600, largeRepeats: 12_800, label: 'tab groups' })
  })

  perfIt('C2-M-006: an HTML fragment of many paragraphs imports linearly', () => {
    expectBuiltInputScansLinearly(source => { importDocument(source, { from: 'html' }) },
      count => '<p>x</p>'.repeat(count), { smallRepeats: 15_000, largeRepeats: 120_000, label: 'fragment paragraphs' })
  })
})
