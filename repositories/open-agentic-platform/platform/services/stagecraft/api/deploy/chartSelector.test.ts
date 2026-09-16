import { describe, expect, it } from "vitest";
import { listShapes, selectChart } from "./chartSelector";

describe("chartSelector (spec 136 Phase 2)", () => {
  it("resolves acme-vue-encore (the factory reference shape, spec 214)", () => {
    const sel = selectChart({ shape: "acme-vue-encore" });
    expect(sel.chart).toBe("acme-vue-encore");
    expect(sel.version).toBe("0.1.0");
  });

  it("throws on an unregistered shape rather than falling back silently", () => {
    expect(() =>
      // Deliberately violate the type to exercise the runtime guard —
      // unknown shapes must fail at deploy time, not silently default.
      selectChart({ shape: "unknown-shape" as unknown as "acme-vue-encore" }),
    ).toThrow(/no chart registered for shape/);
  });

  it("listShapes enumerates every registered shape", () => {
    const shapes = listShapes();
    expect(shapes).toEqual(["acme-vue-encore"]);
  });
});
