import { describe, it, expect } from 'vitest'
import {
  stampCarve,
  buildMarker,
  stripTrailingMarker,
  readStamp,
  needsReview,
  carveToHtml,
  SPEC_VERSION,
} from '../src/index.js'

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

  it('readStamp returns null for an unstamped document', () => {
    expect(readStamp('# Title\n\ntext\n')).toBeNull()
    expect(readStamp('')).toBeNull()
  })

  it('readStamp recognizes both forms', () => {
    expect(readStamp(`text\n\n%% carve-version: 0.1; generated-by: ${BY}\n`)).toEqual({
      version: '0.1',
      generatedBy: BY,
    })
    expect(readStamp('text\n\n%%%\ncarve-version: 0.0.9\ngenerated-by: carve-rs 0.0.9\n%%%\n')).toEqual({
      version: '0.0.9',
      generatedBy: 'carve-rs 0.0.9',
    })
  })

  it('readStamp ignores an unrelated trailing comment', () => {
    expect(readStamp('text\n\n%% just a note\n')).toBeNull()
    expect(readStamp('text\n\n%%%\njust a note\n%%%\n')).toBeNull()
  })

  it('readStamp tolerates a missing generated-by', () => {
    expect(readStamp('text\n\n%% carve-version: 0.1\n')).toEqual({ version: '0.1', generatedBy: null })
  })

  it('what stampCarve writes is what readStamp returns', () => {
    // The pair has to agree, or the upgrade procedure reads the wrong version.
    for (const form of ['line', 'block'] as const) {
      const stamp = readStamp(stampCarve('text\n', BY, form))
      expect(stamp, form).toEqual({ version: SPEC_VERSION, generatedBy: BY })
    }
  })

  it('needsReview compares against the targeted spec version', () => {
    expect(needsReview(`text\n\n%% carve-version: ${SPEC_VERSION}; generated-by: ${BY}\n`)).toBe(false)
    expect(needsReview('text\n\n%% carve-version: 0.0.9; generated-by: x\n')).toBe(true)
    // Unknown provenance answers true: assuming a document is current is unsafe.
    expect(needsReview('text\n')).toBe(true)
    // A document from a future version is not this engine's problem.
    expect(needsReview('text\n\n%% carve-version: 99.0; generated-by: x\n')).toBe(false)
  })

  // The point of a provenance marker is that ANOTHER engine can read it. These
  // are the literal bytes carve-php's `carve fmt --stamp` / `--stamp-block`
  // produce, so a divergence in either writer fails a build rather than showing
  // up in the field.
  it('readStamp reads a line-form marker written by carve-php', () => {
    const fromPhp = '# Hi\n\nText.\n\n%% carve-version: 0.1; generated-by: carve-php 0.1.0\n'
    expect(readStamp(fromPhp)).toEqual({ version: '0.1', generatedBy: 'carve-php 0.1.0' })
  })

  it('readStamp reads a block-form marker written by carve-php', () => {
    const fromPhp =
      '# Hi\n\nText.\n\n%%%\ncarve-version: 0.1\ngenerated-by: carve-php 0.1.0\n%%%\n'
    expect(readStamp(fromPhp)).toEqual({ version: '0.1', generatedBy: 'carve-php 0.1.0' })
  })

  it('needsReview treats 0.1 and 0.1.0 as the same version', () => {
    // Spec versions carry two segments, engine versions three. Comparing them
    // lexically, or by segment count, would report every stamped document as
    // stale.
    expect(needsReview('text\n\n%% carve-version: 0.1; generated-by: x\n', '0.1.0')).toBe(false)
    expect(needsReview('text\n\n%% carve-version: 0.1.0; generated-by: x\n', '0.1')).toBe(false)
  })

  it('needsReview compares segments numerically, not as strings', () => {
    // "0.10" sorts before "0.9" as a string, but 10 > 9.
    expect(needsReview('text\n\n%% carve-version: 0.10; generated-by: x\n', '0.9')).toBe(false)
    expect(needsReview('text\n\n%% carve-version: 0.9; generated-by: x\n', '0.10')).toBe(true)
  })

  it('readStamp tolerates trailing blank lines after the marker', () => {
    expect(readStamp('# Hi\n\n%% carve-version: 0.1; generated-by: x\n\n\n')?.version).toBe('0.1')
  })
})
