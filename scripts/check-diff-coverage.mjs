#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_BASE = "origin/main";
const DEFAULT_HEAD = "HEAD";
const DEFAULT_LCOV_PATH = "coverage/lcov.info";
const DEFAULT_THRESHOLD = 70;
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".mjs"]);

export function normalizePath(filePath) {
  return filePath.replace(/\\/g, "/").replace(/^\.\//, "");
}

export function isDiffCoverageSource(filePath) {
  const normalized = normalizePath(filePath);
  const extension = path.posix.extname(normalized);

  if (!SOURCE_EXTENSIONS.has(extension) || normalized.endsWith(".d.ts")) {
    return false;
  }

  if (normalized.startsWith("apps/cli/src/")) {
    return true;
  }

  if (normalized.startsWith("apps/desktop/electron/")) {
    return true;
  }

  if (normalized.startsWith("apps/desktop/src/")) {
    return true;
  }

  if (normalized.startsWith("packages/") && normalized.includes("/src/")) {
    return true;
  }

  return normalized.startsWith("scripts/");
}

export function parseLcov(lcovText, options = {}) {
  const root = options.root ?? process.cwd();
  const coverage = new Map();
  let current = null;

  for (const rawLine of lcovText.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (line.startsWith("SF:")) {
      const sourcePath = line.slice(3);
      const relativePath = path.isAbsolute(sourcePath)
        ? path.relative(root, sourcePath)
        : sourcePath;
      current = {
        filePath: normalizePath(relativePath),
        lines: new Map()
      };
      coverage.set(current.filePath, current);
      continue;
    }

    if (line.startsWith("DA:") && current) {
      const [lineNumberText, hitCountText] = line.slice(3).split(",");
      const lineNumber = Number.parseInt(lineNumberText ?? "", 10);
      const hitCount = Number.parseInt(hitCountText ?? "", 10);

      if (Number.isInteger(lineNumber) && Number.isFinite(hitCount)) {
        current.lines.set(lineNumber, hitCount);
      }
      continue;
    }

    if (line === "end_of_record") {
      current = null;
    }
  }

  return coverage;
}

export function parseChangedLines(diffText) {
  const changedLines = new Map();
  let currentFile = null;
  let currentNewLine = null;

  for (const line of diffText.split(/\r?\n/)) {
    if (line.startsWith("diff --git ")) {
      currentFile = null;
      currentNewLine = null;
      continue;
    }

    if (line.startsWith("+++ ")) {
      const fileSpec = line.slice(4).trim();
      if (fileSpec === "/dev/null") {
        currentFile = null;
        currentNewLine = null;
        continue;
      }

      currentFile = normalizePath(fileSpec.startsWith("b/") ? fileSpec.slice(2) : fileSpec);
      if (!changedLines.has(currentFile)) {
        changedLines.set(currentFile, new Set());
      }
      continue;
    }

    if (!currentFile) {
      continue;
    }

    if (line.startsWith("@@ ")) {
      const hunk = /\+(\d+)(?:,(\d+))?/.exec(line);
      currentNewLine = hunk ? Number.parseInt(hunk[1] ?? "", 10) : null;
      continue;
    }

    if (currentNewLine === null || Number.isNaN(currentNewLine)) {
      continue;
    }

    if (line.startsWith("+") && !line.startsWith("+++")) {
      changedLines.get(currentFile)?.add(currentNewLine);
      currentNewLine += 1;
      continue;
    }

    if (line.startsWith("-") && !line.startsWith("---")) {
      continue;
    }

    if (line.startsWith(" ")) {
      currentNewLine += 1;
    }
  }

  return changedLines;
}

export function calculateDiffCoverage({ changedLinesByFile, coverageByFile, threshold }) {
  const files = [];
  const totals = {
    covered: 0,
    instrumented: 0,
    changed: 0,
    ignored: 0,
    nonExecutable: 0,
    missingCoverage: 0
  };

  for (const [filePath, lineSet] of [...changedLinesByFile.entries()].sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    const changedLines = [...lineSet].sort((left, right) => left - right);

    if (!isDiffCoverageSource(filePath)) {
      totals.ignored += changedLines.length;
      continue;
    }

    totals.changed += changedLines.length;
    const coverage = coverageByFile.get(normalizePath(filePath));
    const fileResult = {
      filePath,
      covered: 0,
      instrumented: 0,
      changed: changedLines.length,
      nonExecutable: 0,
      missingCoverage: false,
      uncoveredLines: []
    };

    if (!coverage) {
      fileResult.missingCoverage = true;
      fileResult.instrumented = changedLines.length;
      fileResult.uncoveredLines = changedLines;
      totals.instrumented += changedLines.length;
      totals.missingCoverage += changedLines.length;
      files.push(fileResult);
      continue;
    }

    for (const lineNumber of changedLines) {
      const hitCount = coverage.lines.get(lineNumber);

      if (hitCount === undefined) {
        fileResult.nonExecutable += 1;
        totals.nonExecutable += 1;
        continue;
      }

      fileResult.instrumented += 1;
      totals.instrumented += 1;

      if (hitCount > 0) {
        fileResult.covered += 1;
        totals.covered += 1;
      } else {
        fileResult.uncoveredLines.push(lineNumber);
      }
    }

    files.push(fileResult);
  }

  const pct = totals.instrumented === 0 ? 100 : (totals.covered / totals.instrumented) * 100;

  return {
    files,
    totals,
    pct,
    threshold,
    passed: pct >= threshold
  };
}

export function formatLineList(lines, maxLines = 12) {
  if (lines.length === 0) {
    return "";
  }

  const visible = lines.slice(0, maxLines).join(", ");
  const suffix = lines.length > maxLines ? `, +${lines.length - maxLines} more` : "";
  return `${visible}${suffix}`;
}

export function formatDiffCoverageMarkdown(result) {
  const pctText = result.pct.toFixed(2);
  const status = result.passed ? "passed" : "failed";
  const lines = [
    "### Diff Coverage",
    "",
    `Diff coverage ${status}: ${pctText}% covered, threshold ${result.threshold}%.`,
    "",
    "| Metric | Count |",
    "| --- | ---: |",
    `| Covered changed executable lines | ${result.totals.covered} |`,
    `| Changed executable lines | ${result.totals.instrumented} |`,
    `| Changed non-executable lines ignored | ${result.totals.nonExecutable} |`,
    `| Changed non-source lines ignored | ${result.totals.ignored} |`
  ];

  if (result.totals.missingCoverage > 0) {
    lines.push(`| Changed source lines missing from lcov | ${result.totals.missingCoverage} |`);
  }

  const changedFiles = result.files.filter((file) => file.instrumented > 0 || file.nonExecutable > 0);
  if (changedFiles.length > 0) {
    lines.push("", "| File | Covered | Total | Pct | Uncovered lines |", "| --- | ---: | ---: | ---: | --- |");

    for (const file of changedFiles) {
      const filePct = file.instrumented === 0 ? 100 : (file.covered / file.instrumented) * 100;
      const uncovered = file.missingCoverage
        ? "missing lcov"
        : formatLineList(file.uncoveredLines);
      lines.push(
        `| ${file.filePath} | ${file.covered} | ${file.instrumented} | ${filePct.toFixed(2)}% | ${uncovered} |`
      );
    }
  }

  return `${lines.join("\n")}\n`;
}

export function parseArgs(argv) {
  const options = {
    base: DEFAULT_BASE,
    head: DEFAULT_HEAD,
    lcovPath: DEFAULT_LCOV_PATH,
    threshold: DEFAULT_THRESHOLD
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--base" && next) {
      options.base = next;
      index += 1;
      continue;
    }

    if (arg === "--head" && next) {
      options.head = next;
      index += 1;
      continue;
    }

    if (arg === "--lcov" && next) {
      options.lcovPath = next;
      index += 1;
      continue;
    }

    if (arg === "--threshold" && next) {
      options.threshold = Number.parseFloat(next);
      index += 1;
      continue;
    }

    throw new Error(`Unknown or incomplete argument: ${arg}`);
  }

  if (!Number.isFinite(options.threshold) || options.threshold < 0 || options.threshold > 100) {
    throw new Error("--threshold must be a number between 0 and 100");
  }

  return options;
}

export function readGitDiff({ base, head }) {
  return execFileSync(
    "git",
    ["diff", "--unified=0", "--no-ext-diff", "--no-color", "--diff-filter=ACMR", base, head, "--"],
    { encoding: "utf8" }
  );
}

export function runDiffCoverage(options) {
  const lcovText = fs.readFileSync(options.lcovPath, "utf8");
  const diffText = readGitDiff(options);
  return calculateDiffCoverage({
    changedLinesByFile: parseChangedLines(diffText),
    coverageByFile: parseLcov(lcovText),
    threshold: options.threshold
  });
}

function isMainModule() {
  return process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
}

if (isMainModule()) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const result = runDiffCoverage(options);
    process.stdout.write(formatDiffCoverageMarkdown(result));
    process.exitCode = result.passed ? 0 : 1;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
