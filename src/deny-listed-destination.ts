/*
 * Blank a destination whose scheme PART 9 §25 denies.
  */

import { DANGEROUS_URL_SCHEMES, SCHEME_PROBE_STRIP_RE } from './render-html.js'

/**
 * `url`, or `''` when its scheme is on the denylist.
 *
 * The probe strips every control character - the C0 block, DEL and the C1 block
 * - and every Unicode whitespace character, because a reader may ignore any of
 * them when it decides what the scheme is. So neither an obfuscated
 * `<U+202F>javascript:` nor a `java<DEL>script:` split slips past by being
 * unrecognizable to this check while remaining recognizable to the thing that
 * resolves it.
 */
export function blankDeniedDestination(url: string): string {
  const probe = url.replace(SCHEME_PROBE_STRIP_RE, '')
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(probe)
  if (!scheme) return url
  const lowered = (scheme[1] as string).toLowerCase()

  return DANGEROUS_URL_SCHEMES.some((denied) => denied.toLowerCase() === lowered) ? '' : url
}
