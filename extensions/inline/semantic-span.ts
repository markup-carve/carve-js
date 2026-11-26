import type { ExtensionBundle } from '../../src/extensions/standard/bundle.ts'

/** The order of 0.1, from inside out: the keys `samp`, `var`, `cite` and `dfn` beside the core three (C2-H-075). */
const KEYS: readonly (readonly [string, string | null])[] = [
  ['abbr', 'title'], ['time', 'datetime'], ['samp', null], ['var', null], ['kbd', null], ['cite', null], ['dfn', 'title'],
]

/** Span keys `samp`, `var`, `cite` and `dfn` for render and lint (carve-js#5060). */
export function semanticSpan(): ExtensionBundle {
  return { extensions: [{ name: 'carve.semanticSpan', version: '1', props: {}, slots: {}, semanticKeys: KEYS }], renderers: {} }
}
