import { describe, it, expect } from 'vitest'
import { stampCarve, buildMarker, stripTrailingMarker, carveToHtml, SPEC_VERSION } from '../src/index.js'

const BY = 'carve-js 0.1.0'

describe('provenance stamp', () => {
  it('appends a one-liner marker after a blank line (default form)', () => {
    expect(stampCarve('a\n', BY)).toBe(`a\n\n%% carve-version: ${SPEC_VERSION}; generated-by: ${BY}\n`)
  })

  it('appends a block marker', () => {
    expect(stampCarve('a\n', BY, 'block')).toBe(
      `a\n\n%%%\ncarve-version: ${SPEC_VERSION}\ngenerated-by: ${BY}\n%%%\n`,
    )
  })

  it('is idempotent (re-stamping replaces, never accumulates)', () => {
    const once = stampCarve('a\n', BY)
    expect(stampCarve(once, BY)).toBe(once)
  })

  it('replaces an existing marker of the other form', () => {
    const line = stampCarve('a\n', BY)
    expect(stampCarve(line, BY, 'block')).toBe(stampCarve('a\n', BY, 'block'))
  })

  it('replaces the block form too', () => {
    const block = stampCarve('a\n', BY, 'block')
    expect(stampCarve(block, BY)).toBe(stampCarve('a\n', BY))
  })

  it('renders nothing for the marker', () => {
    expect(carveToHtml(stampCarve('a\n', BY))).toBe('<p>a</p>')
    expect(carveToHtml(stampCarve('a\n', BY, 'block'))).toBe('<p>a</p>')
  })

  it('keeps an unrelated trailing comment (only strips carve-version markers)', () => {
    const src = 'a\n\n%% just a note\n'
    expect(stampCarve(src, BY)).toBe(`a\n\n%% just a note\n\n%% carve-version: ${SPEC_VERSION}; generated-by: ${BY}\n`)
  })

  it('stamps an empty document as the bare marker', () => {
    expect(stampCarve('', BY)).toBe(buildMarker(BY, 'line') + '\n')
  })

  it('stripTrailingMarker removes only a provenance marker', () => {
    expect(stripTrailingMarker(`a\n\n%% carve-version: 0.1; generated-by: ${BY}\n`)).toBe('a\n')
    expect(stripTrailingMarker('a\n\n%% note\n')).toBe('a\n\n%% note\n')
  })
})
