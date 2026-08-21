import { describe, it, expect } from 'vitest'
import { bbcodeToCarve, BbcodeSentinelSpaceExhaustedError } from '../src/bbcode-migrate.js'

/**
 * The BBCode importer's stash key is picked from what the post does not carry.
 *
 * `escapePlainBbcodeText` protects the spans that must survive Carve escaping by
 * replacing each with `open <index> close` and splicing them back afterwards.
 * The key used to be a FIXED U+E001/U+E002 pair, so a post that carried those
 * two characters around a number answered the restore regex and was replaced by
 * whatever the slot held - while the tag that really owned the slot lost its own
 * restore. Text from elsewhere in the same post landed where the author's
 * characters were, and neither half of that shows in the result.
 *
 * This is the importer-side member of the family carve#678 settled and #1276,
 * #1280 and #1281 swept on the writer side. The shape is worse here: a writer's
 * collision cost an authored character, and this one substitutes a span.
 */

const KEY_OPEN = '\ue001'
const KEY_CLOSE = '\ue002'

/** The private-use code points a string carries, in order. */
const privateUse = (s: string): string[] =>
  [...s].filter((c) => c >= '\ue000' && c <= '\uf8ff')

describe('the BBCode stash key does not collide with an authored private-use character', () => {
  it('leaves an authored key pair alone and still converts the tag that owns the slot', () => {
    // THE TICKET'S MEASUREMENT. On a fixed key this returned `x*y [b]bold* z`:
    // the author's three characters became the stashed `[b]`, and the real `[b]`
    // was left as literal text with only its closing tag converted.
    const post = `x${KEY_OPEN}0${KEY_CLOSE}y [b]bold[/b] z`

    expect(bbcodeToCarve(post)).toBe(`x${KEY_OPEN}0${KEY_CLOSE}y *bold* z\n`)
  })

  it('keeps an authored key pair a post carries with no tag at all', () => {
    // The other half of the same restore: an index with nothing stored used to
    // splice the empty string, so the three characters were DELETED rather than
    // substituted. Silent either way.
    const post = `x${KEY_OPEN}0${KEY_CLOSE}y`

    expect(bbcodeToCarve(post)).toBe(`x${KEY_OPEN}0${KEY_CLOSE}y\n`)
  })

  it('keeps an authored key pair whose index is past the end of the stash', () => {
    const post = `x${KEY_OPEN}99${KEY_CLOSE}y [b]b[/b]`

    expect(bbcodeToCarve(post)).toBe(`x${KEY_OPEN}99${KEY_CLOSE}y *b*\n`)
  })

  it('keeps an authored key pair inside a code tag, whose body is stashed whole', () => {
    const post = `[code]a${KEY_OPEN}0${KEY_CLOSE}b[/code]`

    expect(bbcodeToCarve(post)).toBe(`\`\`\`\na${KEY_OPEN}0${KEY_CLOSE}b\n\`\`\`\n`)
  })

  it('keeps each half of the key on its own', () => {
    // These two always survived - the restore needs both halves around digits -
    // and they are here so a future key that is one character wide, or that
    // matches on an open alone, cannot pass this file.
    expect(bbcodeToCarve(`a${KEY_OPEN}b [b]x[/b]`)).toBe(`a${KEY_OPEN}b *x*\n`)
    expect(bbcodeToCarve(`a${KEY_CLOSE}b [b]x[/b]`)).toBe(`a${KEY_CLOSE}b *x*\n`)
  })

  it('emits no key of its own, whatever run it picked', () => {
    // The post occupies the preferred run, so the key moved; what the converter
    // returns must still carry exactly the private-use characters the AUTHOR
    // wrote, in the same order - no leftover from the run it settled on.
    const post = `${KEY_OPEN}${KEY_CLOSE} [b]bold[/b] [url]https://example.com[/url]`

    expect(privateUse(bbcodeToCarve(post))).toEqual([KEY_OPEN, KEY_CLOSE])
  })

  it('walks past a post that occupies every second private-use code point', () => {
    // ONE CODE POINT AT A TIME. Every run of two inside U+E001..U+E1FF holds one
    // of these, so the scan has to leave the occupied region entirely; a scan
    // that stepped a whole run at a time from an aligned base would report the
    // area full while all of U+E200 upward was free.
    let occupied = ''
    for (let code = 0xe001; code <= 0xe1ff; code += 2) occupied += String.fromCharCode(code)
    const post = `${occupied} [b]bold[/b]`

    const out = bbcodeToCarve(post)
    expect(out).toBe(`${occupied} *bold*\n`)
    expect(privateUse(out)).toEqual([...occupied])
  })

  it('never picks U+E000, which is the parser nbsp marker rather than a free code point', () => {
    let occupied = ''
    for (let code = 0xe001; code <= 0xe1ff; code++) occupied += String.fromCharCode(code)
    const post = `${occupied} [b]bold[/b]`

    expect(bbcodeToCarve(post)).not.toContain('\ue000')
  })

  it('refuses a post that leaves no private-use run free', () => {
    // REFUSING RATHER THAN CONVERTING ANYWAY. The shared allocator's documented
    // last resort is the preferred run, which is right for a writer - it keeps
    // rendering a document it can still write. An importer that took that run
    // would splice a span over the author's own text, which is the defect this
    // file exists for, so the converter checks the post-condition and refuses,
    // the way it already refuses input it will not touch for its size.
    let everyCodePoint = ''
    for (let code = 0xe001; code <= 0xf8ff; code++) everyCodePoint += String.fromCharCode(code)

    expect(() => bbcodeToCarve(`${everyCodePoint} [b]b[/b]`)).toThrow(
      BbcodeSentinelSpaceExhaustedError,
    )
  })

  it('converts an ordinary post byte for byte as before', () => {
    // The common case pays for one scan and nothing else: no post carries a
    // private-use character, so the preferred run is kept and every other row in
    // test/bbcode-migrate.test.ts still describes the output.
    expect(bbcodeToCarve('[b]bold[/b] and [i]italic[/i] and [c]code[/c]')).toBe(
      '*bold* and /italic/ and `code`\n',
    )
  })
})
