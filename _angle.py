import io

p = 'src/parse.ts'
s = io.open(p, encoding='utf-8').read()

old_re = r"""const RE_LINK_TAIL = /^\(([^)\s]+)(?:\s+"((?:[^"\\]|\\.)*)"|\s+'((?:[^'\\]|\\.)*)')?\)(?:\{((?:[^}"'\n]|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')+)\})?/"""
new_re = r"""// The destination is either an ANGLE form (`<...>`) or a bare run. The angle
// form is what lets a destination carry a parenthesis or a space at all: a bare
// run stops at the first `)`, so `https://x/Foo_(bar)` truncates and the rest
// leaks into the text (carve#377). Both spellings share capture group 1;
// `linkDestination` unwraps the brackets.
const RE_LINK_TAIL = /^\((<[^<>\n]*>|[^)\s]+)(?:\s+"((?:[^"\\]|\\.)*)"|\s+'((?:[^'\\]|\\.)*)')?\)(?:\{((?:[^}"'\n]|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')+)\})?/"""
assert old_re in s, 'RE_LINK_TAIL not matched'
s = s.replace(old_re, new_re, 1)

# Unwrap helper, placed next to the regexes.
anchor = "const RE_REF_TAIL ="
helper = """/**
 * The destination a `(...)` tail carries, with the angle form's brackets
 * removed. `<...>` is the only spelling that can hold a parenthesis or a space;
 * a bare run stops at the first `)` or whitespace, which is what it is for.
 */
function linkDestination(raw: string): string {
  return raw.startsWith('<') && raw.endsWith('>') ? raw.slice(1, -1) : raw
}

"""
assert anchor in s
s = s.replace(anchor, helper + anchor, 1)

# Both call sites read ml[1] directly.
assert s.count("href: ml[1]!,") == 1, 'unexpected link href sites'
s = s.replace("href: ml[1]!,", "href: linkDestination(ml[1]!),", 1)
assert s.count("src: ml[1]!,") <= 1
s = s.replace("src: ml[1]!,", "src: linkDestination(ml[1]!),", 1)
io.open(p, 'w', encoding='utf-8').write(s)
print('ok')
