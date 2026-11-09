import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('semantic derived attribute values', () => {
  it.each(['abbr', 'time'] as const)('probes an authored %s value before emission', (name) => {
    const outputName = name === 'abbr' ? 'title' : 'datetime'
    expect(carveToHtml(`[x]{${name}="javascript:x"}`)).toBe(`<p><${name} ${outputName}="">x</${name}></p>`)
    expect(carveToHtml(`[x]{${name}="safe:x"}`)).toBe(`<p><${name} ${outputName}="safe:x">x</${name}></p>`)
  })
})
