/** carve#5407 ruling A (carve#5424, carve#5426): the host resumes after a closed attached block, ahead of the pinned spec submodule. */
export const RULED_5407_HTML: ReadonlyMap<string, { reason: string; html: string }> = new Map([
  ['758-a-hosted-footnote-keeps-a-heading-at-its-body-floor', {
    reason: "the heading at the note body column after the attached heading is the note's (carve#5407 ruling A)",
    html: `<ul>
  <li>a</li>
</ul>
<p>see<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></p>
<section role="doc-endnotes" aria-label="Footnotes">
  <hr>
  <ol>
    <li id="fn1">
      <h1 id="h">h</h1>
      <h1 id="h-2">h</h1>
      <p><a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>
    </li>
  </ol>
</section>`,
  }],
])
