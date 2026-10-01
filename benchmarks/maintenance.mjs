import { performance } from "node:perf_hooks";
import { createHash } from "node:crypto";
if (!process.argv[2]) {
  process.stderr.write(
    "Usage: node maintenance.mjs /absolute/path/to/built/worktree\n",
  );
  process.exit(2);
}
const { carveToHtml } = await import(`${process.argv[2]}/dist/index.js`);
const results = [];
const cases = ["quoted_fences", "verse_definitions", "paragraphs"];
if (process.env.CARVE_BENCH_RELEASE) cases.push("mixed_document");
for (const n of [128, 1024, 4096])
  for (const name of cases) {
    const source =
      name === "quoted_fences"
        ? "> ::: |\n> verse\n" + "> ```x\n".repeat(n) + "> :::\n"
        : name === "verse_definitions"
          ? "> ::: |\n" + "> [r]: /hidden\n".repeat(n) + "> :::\n\n[t][r]\n"
          : name === "mixed_document"
            ? Array.from(
                { length: n },
                (_, i) =>
                  `# Section ${i}\n\nA paragraph with *strong*, /emphasis/, [reference][ref] and \`code\`.\n\n- first\n- second\n\n| key | value |\n| --- | --- |\n| item | count |\n\n`,
              ).join("") + "[ref]: /target\n"
            : "plain paragraph\n\n".repeat(n);
    for (let i = 0; i < 3; i++) carveToHtml(source);
    const samples = [];
    let html = "";
    for (let i = 0; i < 7; i++) {
      const start = performance.now();
      html = carveToHtml(source);
      samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    results.push({
      name,
      n,
      bytes: Buffer.byteLength(source),
      median_ms: samples[3],
      min_ms: samples[0],
      samples_ms: samples,
      hash: createHash("sha256").update(html).digest("hex"),
    });
  }
console.log(JSON.stringify(results, null, 2));
