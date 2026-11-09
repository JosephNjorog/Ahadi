import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extractCitations, sampleClaims, wordCount } from "../src/writing";
import { parseTestOutput, detectStack, parseGitHubRepo, selectFiles } from "../src/code";
import { parseDataset, profileRows, validateAgainstSchema } from "../src/data";
import { evaluateCheck } from "../src/checks";

const report = readFileSync(
  fileURLToPath(new URL("../../../fixtures/research-report-sample/report.md", import.meta.url)),
  "utf8",
);

describe("writing collector helpers", () => {
  it("extracts the 9 numbered sources and samples cited claims", () => {
    const c = extractCitations(report);
    expect(c.filter((x) => x.index !== null)).toHaveLength(9);
    expect(c.find((x) => x.index === 7)!.url).toContain("example.invalid");
    const claims = sampleClaims(report);
    expect(claims.length).toBeGreaterThan(0);
    expect(claims.length).toBeLessThanOrEqual(5);
    expect(wordCount(report)).toBeGreaterThan(200);
  });

  it("min_citations with mustResolve fails when one of 9 is dead", () => {
    const citations = extractCitations(report).map((c) => ({
      ...c,
      status: c.url.includes("invalid") ? "ENOTFOUND" : 200,
      resolves: !c.url.includes("invalid"),
    }));
    const r = evaluateCheck(
      { kind: "min_citations", count: 9, mustResolve: true },
      { writing: { citations } as never },
    );
    expect(r.outcome).toBe("fail");
    expect(r.reasoning).toMatch(/8 reachable citations; 9 required/);
  });
});

describe("code collector helpers", () => {
  it("parses jest, pytest and go test output", () => {
    expect(parseTestOutput("Tests:       2 failed, 18 passed, 20 total")).toMatchObject({
      passed: 18,
      failed: 2,
      passRate: 0.9,
    });
    expect(parseTestOutput("===== 5 passed, 1 failed in 0.31s =====")).toMatchObject({
      passed: 5,
      failed: 1,
    });
    expect(parseTestOutput("ok  \tpkg/a\t0.1s\nFAIL\tpkg/b\t0.2s")).toMatchObject({ passed: 1, failed: 1 });
  });
  it("detects stacks, parses repo urls and ranks files by criterion keywords", () => {
    expect(detectStack(["package.json", "tsconfig.json"])).toEqual(["node", "typescript"]);
    expect(parseGitHubRepo("https://github.com/acme/api.git")).toEqual({ owner: "acme", repo: "api" });
    const picked = selectFiles(
      ["README.md", "src/auth/jwt.ts", "src/util.ts", "package.json"],
      [
        {
          id: "c1",
          title: "JWT auth with refresh tokens",
          description: "Implements JWT auth",
          weight: 100,
          required: false,
          method: "ai_judgment",
          evidence: ["source_files"],
          partialCredit: false,
        },
      ],
    );
    expect(picked.slice(0, 3)).toEqual(
      expect.arrayContaining(["README.md", "package.json", "src/auth/jwt.ts"]),
    );
  });
});

describe("data collector helpers", () => {
  it("profiles CSV, finds duplicates and validates schemas", () => {
    const { rows, format } = parseDataset(
      "company,website,employees\nAcme,acme.com,10\nAcme,acme.com,10\nBeta,,5\n",
    );
    const p = profileRows(rows, format);
    expect(p.rowCount).toBe(3);
    expect(p.duplicateRows).toBe(1);
    expect(p.columns.find((c) => c.name === "website")!.nullRate).toBeCloseTo(0.333, 2);
    expect(p.columns.find((c) => c.name === "employees")!.type).toBe("number");
    expect(
      evaluateCheck({ kind: "csv_columns", columns: ["company", "website"], minRows: 3 }, { data: p })
        .outcome,
    ).toBe("pass");
    expect(
      validateAgainstSchema([{ a: 1 }], { type: "array", items: { type: "object", required: ["b"] } }).valid,
    ).toBe(false);
  });
});
