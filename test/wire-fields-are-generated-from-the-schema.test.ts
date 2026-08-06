import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { wireFieldsSource } from "../scripts/generate-wire-fields.mjs";
import { WIRE_FIELDS, WIRE_HELPER_FIELDS } from "../src/wire-fields.js";

/**
 * `src/wire-fields.ts` is GENERATED from the pinned AST schema, and PART 12
 * section 11 is only as good as that map: a field the schema gained but the map
 * does not name would be refused on ingest even though it is valid.
 *
 * A committed copy of a file that lives somewhere else rots silently, so the
 * generator runs here and the result is compared. The schema moving without the
 * map moving is exactly what this fails on.
 */
describe("the generated wire-field map", () => {
  const root = resolve(import.meta.dirname, "..");

  it("matches what the pinned schema produces", () => {
    const schema = JSON.parse(
      readFileSync(resolve(root, "spec/resources/ast-schema.json"), "utf8"),
    );
    const committed = readFileSync(resolve(root, "src/wire-fields.ts"), "utf8");

    expect(committed, "run: node scripts/generate-wire-fields.mjs").toBe(
      wireFieldsSource(schema),
    );
  });

  it("names every type the schema closes", () => {
    // The control on the comparison above, which passes for two empty files.
    const schema = JSON.parse(
      readFileSync(resolve(root, "spec/resources/ast-schema.json"), "utf8"),
    );
    const closed = Object.values(
      schema.$defs as Record<string, Record<string, unknown>>,
    )
      .map(
        (def) =>
          (def.properties as Record<string, { const?: unknown }> | undefined)
            ?.type?.const,
      )
      .filter((type): type is string => typeof type === "string");

    expect(closed.length).toBeGreaterThan(50);
    expect(Object.keys(WIRE_FIELDS).sort()).toEqual([...closed].sort());
    expect(Object.keys(WIRE_HELPER_FIELDS).sort()).toEqual(["attrs", "pos"]);
  });
});
