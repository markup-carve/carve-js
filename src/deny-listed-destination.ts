/*
 * Blank a destination whose scheme PART 9 §25 denies.
 *
 * ONE COPY for the non-HTML targets. The Markdown writer carried its own, and
 * its docblock records why that was a bug: a local list of four schemes let the
 * twenty OS protocol-handler schemes - `ms-msdt`, `search-ms`, `jar`, `vscode`
 * and the rest - through into Markdown, "not a narrower policy, [but] the same
 * sink one step removed" (carve#385).
 *
 * The ANSI writer needed the same rule and would have been the third copy. §25
 * binds "EVERY TARGET THAT EMITS A RESOLVABLE URL", on the grounds that a scheme
 * blanked in one target and passed through in another is not blocked, only
 * deferred by a step - and the ANSI writer printed the destination verbatim in a
 * parenthetical, in all three engines, where Markdown blanked it (carve#765).
 * Every current terminal emulator autolinks a URL in its output and hands it to
 * the OS handler on click, which is that same one step.
 *
 * NOT shared with the HTML renderer's `sanitizeUrl`, which additionally honors
 * the caller's `allowedUrlSchemes` / `deniedUrlSchemes`. Threading those through
 * here would make the non-HTML targets start obeying options they ignore today -
 * a change worth making and not one this file should make silently.
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
