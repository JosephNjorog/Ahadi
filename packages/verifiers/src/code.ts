import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { Criterion, MachineCheck } from "@ahadi/core";
import { mapLimit } from "./fetch";
import { emptyResult, type CollectorResult } from "./types";

const exec = promisify(execFile);

/** SPEC §9.2 code collector. */

export interface CommandRun {
  command: string;
  exitCode: number | null;
  durationMs: number;
  stdoutTail: string;
  stderrTail: string;
  tests?: { passed: number; failed: number; skipped: number; total: number; passRate: number | null };
  logKey: string;
}

export interface CodeSummary {
  repo: string;
  commitSha: string;
  commitFound: boolean;
  stack: string[];
  fileCount: number;
  locByExt: Record<string, number>;
  fileTree: string[];
  selectedFiles: string[];
  dependencies: Record<string, string>;
  secretsFound: { path: string; kind: string }[];
  testFiles: string[];
  suspiciousTests: { path: string; reason: string }[];
  sandbox: { provider: string; ran: boolean; note?: string };
  install?: CommandRun;
  builds: CommandRun[];
  testRuns: CommandRun[];
}

const SECRET_PATTERNS: [string, RegExp][] = [
  ["AWS access key", /AKIA[0-9A-Z]{16}/],
  ["Private key", /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["Stripe live key", /sk_live_[0-9a-zA-Z]{20,}/],
  ["GitHub token", /gh[pousr]_[A-Za-z0-9]{36,}/],
  ["Anthropic key", /sk-ant-[A-Za-z0-9_-]{20,}/],
  ["Generic secret assignment", /(api[_-]?key|secret|password)\s*[:=]\s*["'][^"'\s]{12,}["']/i],
];

const TRIVIAL_TEST_PATTERNS: [string, RegExp][] = [
  [
    "asserts a constant",
    /expect\(\s*(true|1|"[^"]*")\s*\)\.(toBe|toEqual)\(\s*(true|1|"[^"]*")\s*\)|assert\s+True\b|assert\s+1\s*==\s*1/,
  ],
  ["skipped tests", /\b(it|test|describe)\.skip\(|@pytest\.mark\.skip|\bxit\(|t\.Skip\(/],
  ["only-focused tests", /\b(it|test|describe)\.only\(/],
  ["empty test body", /\b(it|test)\(\s*["'`][^"'`]+["'`]\s*,\s*(async\s*)?\(\s*\)\s*=>\s*\{\s*\}\s*\)/],
];

export function parseGitHubRepo(url: string): { owner: string; repo: string } | null {
  const m = /github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/|$)/.exec(url);
  return m ? { owner: m[1]!, repo: m[2]! } : null;
}

async function gh<T>(p: string): Promise<{ status: number; data: T | null }> {
  const res = await fetch(`https://api.github.com${p}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "AhadiVerifier/1.0",
      ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
    },
    signal: AbortSignal.timeout(20_000),
  });
  return { status: res.status, data: res.ok ? ((await res.json()) as T) : null };
}

export function detectStack(paths: string[]): string[] {
  const has = (re: RegExp) => paths.some((p) => re.test(p));
  return [
    has(/(^|\/)package\.json$/) && "node",
    has(/(^|\/)tsconfig\.json$/) && "typescript",
    has(/(^|\/)(pyproject\.toml|requirements\.txt|setup\.py)$/) && "python",
    has(/(^|\/)go\.mod$/) && "go",
    has(/(^|\/)Cargo\.toml$/) && "rust",
    has(/(^|\/)(pom\.xml|build\.gradle(\.kts)?)$/) && "jvm",
    has(/(^|\/)composer\.json$/) && "php",
    has(/(^|\/)Gemfile$/) && "ruby",
  ].filter(Boolean) as string[];
}

export function isTestFile(p: string) {
  return (
    /(^|\/)(__tests__|tests?|spec)\//.test(p) ||
    /\.(test|spec)\.[jt]sx?$/.test(p) ||
    /(^|\/)test_.*\.py$|_test\.(py|go)$/.test(p)
  );
}

/** Rank files by how many criterion keywords appear in their path; always include manifests and docs. */
export function selectFiles(paths: string[], criteria: Criterion[], max = 25): string[] {
  const words = [
    ...new Set(
      criteria.flatMap((c) => `${c.title} ${c.description}`.toLowerCase().match(/[a-z]{4,}/g) ?? []),
    ),
  ];
  const must = paths.filter(
    (p) =>
      /(^|\/)(readme(\.\w+)?|package\.json|pyproject\.toml|go\.mod|requirements\.txt|\.env\.example)$/i.test(
        p,
      ) && p.split("/").length <= 2,
  );
  const scored = paths
    .filter(
      (p) =>
        !must.includes(p) &&
        /\.(ts|tsx|js|jsx|py|go|rs|java|rb|php|md|json|ya?ml|sql|prisma)$/.test(p) &&
        !/(^|\/)(node_modules|dist|build|vendor|\.next)\//.test(p) &&
        !/lock/.test(p),
    )
    .map((p) => ({
      p,
      score:
        words.reduce((s, w) => s + (p.toLowerCase().includes(w) ? 2 : 0), 0) +
        (isTestFile(p) ? 1 : 0) +
        (/(^|\/)src\//.test(p) ? 0.5 : 0),
    }))
    .sort((a, b) => b.score - a.score)
    .map((x) => x.p);
  return [...must, ...scored].slice(0, max);
}

export function parseTestOutput(out: string): CommandRun["tests"] | undefined {
  const num = (re: RegExp) => Number(re.exec(out)?.[1] ?? 0);
  // jest / vitest
  if (/Tests?:?\s+.*(passed|failed)/i.test(out)) {
    const passed = num(/(\d+)\s+passed/i);
    const failed = num(/(\d+)\s+failed/i);
    const skipped = num(/(\d+)\s+(skipped|todo|pending)/i);
    const total = passed + failed;
    return { passed, failed, skipped, total, passRate: total ? passed / total : null };
  }
  // pytest: "== 5 passed, 1 failed in 0.12s =="
  if (/=+ .*(passed|failed).* in [\d.]+s/.test(out)) {
    const passed = num(/(\d+) passed/);
    const failed = num(/(\d+) failed/) + num(/(\d+) error/);
    const skipped = num(/(\d+) skipped/);
    const total = passed + failed;
    return { passed, failed, skipped, total, passRate: total ? passed / total : null };
  }
  // go test
  const ok = (out.match(/^ok\s/gm) ?? []).length;
  const fail = (out.match(/^(FAIL|--- FAIL)/gm) ?? []).length;
  if (ok + fail > 0)
    return { passed: ok, failed: fail, skipped: 0, total: ok + fail, passRate: ok / (ok + fail) };
  return undefined;
}

const tail = (s: string, n = 4000) => (s.length > n ? `…${s.slice(-n)}` : s);

interface Runner {
  provider: string;
  run(
    cmd: string,
    timeoutMs: number,
  ): Promise<{ exitCode: number | null; stdout: string; stderr: string; durationMs: number }>;
  writeFile(rel: string, content: Buffer): Promise<void>;
  close(): Promise<void>;
}

async function e2bRunner(repoUrl: string, sha: string): Promise<Runner> {
  const { Sandbox } = await import("e2b");
  const sbx = await Sandbox.create({ apiKey: process.env.SANDBOX_API_KEY, timeoutMs: 15 * 60_000 });
  const dir = "/home/user/repo";
  const run = async (cmd: string, timeoutMs: number) => {
    const t = Date.now();
    try {
      const r = await sbx.commands.run(cmd, {
        cwd: cmd.startsWith("git clone") ? "/home/user" : dir,
        timeoutMs,
      });
      return { exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr, durationMs: Date.now() - t };
    } catch (e) {
      const r = e as { exitCode?: number; stdout?: string; stderr?: string; message?: string };
      return {
        exitCode: r.exitCode ?? null,
        stdout: r.stdout ?? "",
        stderr: r.stderr ?? r.message ?? String(e),
        durationMs: Date.now() - t,
      };
    }
  };
  const clone = await run(
    `git clone --quiet ${shellQuote(repoUrl)} repo && cd repo && git checkout --quiet ${shellQuote(sha)}`,
    120_000,
  );
  if (clone.exitCode !== 0) {
    await sbx.kill();
    throw new Error(`Could not check out ${sha}: ${tail(clone.stderr, 300)}`);
  }
  return {
    provider: "e2b",
    run,
    writeFile: async (rel, content) => {
      await sbx.files.write(`${dir}/${rel}`, new Blob([content as BlobPart]));
    },
    close: async () => {
      await sbx.kill().catch(() => undefined);
    },
  };
}

/** Docker: dependencies install with network, then tests run with --network none (SPEC §9.2 step 7). */
async function dockerRunner(repoUrl: string, sha: string, stack: string[]): Promise<Runner> {
  const work = await mkdtemp(path.join(tmpdir(), "ahadi-code-"));
  await exec("git", ["clone", "--quiet", repoUrl, `${work}/repo`], { timeout: 120_000 });
  await exec("git", ["-C", `${work}/repo`, "checkout", "--quiet", sha], { timeout: 30_000 });
  const image = stack.includes("python")
    ? "python:3.12-slim"
    : stack.includes("go")
      ? "golang:1.23"
      : "node:22-bookworm";
  let installed = false;
  return {
    provider: "docker",
    run: async (cmd, timeoutMs) => {
      const t = Date.now();
      const network = installed ? "none" : "bridge";
      try {
        const { stdout, stderr } = await exec(
          "docker",
          [
            "run",
            "--rm",
            `--network=${network}`,
            "--cpus=2",
            "--memory=4g",
            "-v",
            `${work}/repo:/repo`,
            "-w",
            "/repo",
            image,
            "sh",
            "-lc",
            cmd,
          ],
          { timeout: timeoutMs, maxBuffer: 20 * 1024 * 1024 },
        );
        return { exitCode: 0, stdout, stderr, durationMs: Date.now() - t };
      } catch (e) {
        const r = e as { code?: number; stdout?: string; stderr?: string };
        return {
          exitCode: typeof r.code === "number" ? r.code : null,
          stdout: r.stdout ?? "",
          stderr: r.stderr ?? String(e),
          durationMs: Date.now() - t,
        };
      } finally {
        installed = true;
      }
    },
    writeFile: async (rel, content) => writeFile(path.join(work, "repo", rel), content),
    close: async () => rm(work, { recursive: true, force: true }),
  };
}

function shellQuote(s: string) {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function installCommand(stack: string[], paths: string[]): string | null {
  if (stack.includes("node"))
    return paths.includes("pnpm-lock.yaml")
      ? "corepack enable && pnpm install --frozen-lockfile"
      : paths.includes("yarn.lock")
        ? "corepack enable && yarn install --frozen-lockfile"
        : paths.includes("package-lock.json")
          ? "npm ci --no-audit --no-fund"
          : "npm install --no-audit --no-fund";
  if (stack.includes("python"))
    return paths.includes("requirements.txt")
      ? "pip install -q -r requirements.txt"
      : "pip install -q -e . || pip install -q .";
  if (stack.includes("go")) return "go mod download";
  return null;
}

export async function collectCode(input: {
  repoUrl: string;
  commitSha: string;
  criteria: Criterion[];
  checks: MachineCheck[];
  hiddenSuites?: { path: string; content: Buffer }[];
}): Promise<CollectorResult> {
  const result = emptyResult();
  const summary: CodeSummary = {
    repo: input.repoUrl,
    commitSha: input.commitSha,
    commitFound: false,
    stack: [],
    fileCount: 0,
    locByExt: {},
    fileTree: [],
    selectedFiles: [],
    dependencies: {},
    secretsFound: [],
    testFiles: [],
    suspiciousTests: [],
    sandbox: { provider: process.env.SANDBOX_PROVIDER || "none", ran: false },
    builds: [],
    testRuns: [],
  };

  const gh_ = parseGitHubRepo(input.repoUrl);
  if (gh_) {
    const commit = await gh<{ sha: string }>(`/repos/${gh_.owner}/${gh_.repo}/commits/${input.commitSha}`);
    summary.commitFound = commit.status === 200;
    if (!summary.commitFound)
      result.warnings.push(
        `Commit ${input.commitSha} is not reachable in ${gh_.owner}/${gh_.repo} (HTTP ${commit.status}). Private repositories need GITHUB_TOKEN.`,
      );
    if (summary.commitFound) {
      summary.commitSha = commit.data!.sha;
      const tree = await gh<{ tree: { path: string; type: string; size?: number }[]; truncated: boolean }>(
        `/repos/${gh_.owner}/${gh_.repo}/git/trees/${summary.commitSha}?recursive=1`,
      );
      const files = (tree.data?.tree ?? []).filter((t) => t.type === "blob");
      summary.fileCount = files.length;
      summary.fileTree = files.map((f) => f.path).slice(0, 800);
      summary.stack = detectStack(summary.fileTree);
      summary.testFiles = summary.fileTree.filter(isTestFile).slice(0, 100);
      summary.selectedFiles = selectFiles(summary.fileTree, input.criteria);
      const toFetch = [...new Set([...summary.selectedFiles, ...summary.testFiles.slice(0, 15)])];
      let budget = 250_000;
      const contents = await mapLimit(toFetch, 6, async (p) => {
        const size = files.find((f) => f.path === p)?.size ?? 0;
        if (size > 120_000) return { p, text: null as string | null };
        const r = await fetch(
          `https://raw.githubusercontent.com/${gh_.owner}/${gh_.repo}/${summary.commitSha}/${p}`,
          { signal: AbortSignal.timeout(15_000) },
        ).catch(() => null);
        return { p, text: r?.ok ? await r.text() : null };
      });
      for (const { p, text } of contents) {
        if (text == null) continue;
        const ext = path.extname(p) || p;
        summary.locByExt[ext] = (summary.locByExt[ext] ?? 0) + text.split("\n").length;
        for (const [kind, re] of SECRET_PATTERNS)
          if (re.test(text)) summary.secretsFound.push({ path: p, kind });
        if (isTestFile(p))
          for (const [reason, re] of TRIVIAL_TEST_PATTERNS)
            if (re.test(text)) summary.suspiciousTests.push({ path: p, reason });
        if (p.endsWith("package.json") && p.split("/").length === 1) {
          try {
            const pkg = JSON.parse(text) as {
              dependencies?: Record<string, string>;
              devDependencies?: Record<string, string>;
            };
            summary.dependencies = { ...pkg.dependencies, ...pkg.devDependencies };
          } catch {
            /* malformed package.json is itself evidence */
          }
        }
        result.scanTargets.push({
          content: text,
          location: p,
          format: /\.(md|txt)$/i.test(p) ? "text" : "code",
        });
        if (budget > 0 && summary.selectedFiles.includes(p)) {
          const chunk = text.slice(0, Math.min(budget, 30_000));
          budget -= chunk.length;
          result.untrustedBlocks.push({ id: `file:${p}`, source: "deliverable", text: `// ${p}\n${chunk}` });
        }
      }
    }
  } else {
    result.warnings.push("Not a GitHub URL: static analysis skipped; only a sandbox run can inspect it.");
  }

  // Execution (builds and tests) needs a sandbox.
  const commands = input.checks.filter(
    (c): c is Extract<MachineCheck, { kind: "build_succeeds" | "test_suite" }> =>
      c.kind === "build_succeeds" || c.kind === "test_suite",
  );
  const provider = process.env.SANDBOX_PROVIDER;
  if (commands.length && (provider === "e2b" ? process.env.SANDBOX_API_KEY : provider === "docker")) {
    let runner: Runner | null = null;
    try {
      runner =
        provider === "e2b"
          ? await e2bRunner(input.repoUrl, summary.commitSha)
          : await dockerRunner(input.repoUrl, summary.commitSha, summary.stack);
      summary.sandbox = { provider: runner.provider, ran: true };
      const inst = installCommand(summary.stack, summary.fileTree);
      if (inst) {
        const r = await runner.run(inst, 5 * 60_000);
        summary.install = toRun(inst, r, "install_log", result);
      }
      // Hidden client suites are copied in AFTER install so repo scripts can't see or alter them.
      for (const h of input.hiddenSuites ?? []) await runner.writeFile(h.path, h.content);
      for (const [i, c] of commands.entries()) {
        const r = await runner.run(c.command, 10 * 60_000);
        const run = toRun(c.command, r, `${c.kind}_log_${i}`, result);
        if (c.kind === "test_suite")
          summary.testRuns.push({ ...run, tests: parseTestOutput(`${r.stdout}\n${r.stderr}`) });
        else summary.builds.push(run);
      }
    } catch (e) {
      summary.sandbox = {
        provider: provider ?? "none",
        ran: false,
        note: (e as Error).message.slice(0, 300),
      };
      result.warnings.push(`Sandbox run failed: ${(e as Error).message.slice(0, 200)}`);
    } finally {
      await runner?.close();
    }
  } else if (commands.length) {
    summary.sandbox.note =
      "No code sandbox configured (SANDBOX_PROVIDER=e2b with SANDBOX_API_KEY, or docker). Build and test criteria need a human.";
    result.warnings.push(summary.sandbox.note);
  }

  result.artifacts.push({
    key: "code_report",
    role: "evidence",
    kind: "report",
    mime: "application/json",
    data: Buffer.from(JSON.stringify(summary)),
    label: "Code evidence report",
  });
  result.summary = summary as unknown as Record<string, unknown>;
  return result;
}

function toRun(
  command: string,
  r: { exitCode: number | null; stdout: string; stderr: string; durationMs: number },
  key: string,
  result: CollectorResult,
): CommandRun {
  result.artifacts.push({
    key,
    role: "evidence",
    kind: "log",
    mime: "text/plain",
    data: Buffer.from(`$ ${command}\n\n${r.stdout}\n${r.stderr}`),
    label: `Log: ${command}`,
  });
  return {
    command,
    exitCode: r.exitCode,
    durationMs: r.durationMs,
    stdoutTail: tail(r.stdout),
    stderrTail: tail(r.stderr, 2000),
    logKey: key,
  };
}
