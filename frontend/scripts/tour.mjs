// Build-time source extraction for code tours (eps-demo-docs).
//
// Docs embed current source excerpts between markers:
//   <!-- tour:snippet id="rego-input" file="backend/governance/policy/bank_manager.rego" lang="rego" -->
//   ...generated block...
//   <!-- tour:end -->
// and source files mark regions with comments:
//   # tour:begin rego-input   ...   # tour:end rego-input      (or // for TypeScript)
//
// `node scripts/tour.mjs --write` regenerates every block. The docs build runs the
// same code in check mode and fails when a region moved, disappeared, or changed.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { highlightCode } from "./highlight.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(here, "../..");
const docsRoot = resolve(repoRoot, "docs");
const defaultRepoUrl = "https://github.com/michaelsrichter/bank-manager-standalone";

const SNIPPET = /<!-- tour:snippet ([^>]*?)-->\n([\s\S]*?)<!-- tour:end -->/g;
const MARKER = /^\s*(#|\/\/) tour:(begin|end) ([\w-]+)\s*$/;

function attributes(text) {
  return Object.fromEntries([...text.matchAll(/(\w+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = resolve(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

export function extractRegion(source, id) {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const begin = lines.findIndex((line) => {
    const m = line.match(MARKER);
    return m && m[2] === "begin" && m[3] === id;
  });
  if (begin === -1) return { error: `missing "tour:begin ${id}"` };
  const end = lines.findIndex((line, index) => {
    const m = line.match(MARKER);
    return index > begin && m && m[2] === "end" && m[3] === id;
  });
  if (end === -1) return { error: `missing "tour:end ${id}"` };

  const body = [];
  for (let index = begin + 1; index < end; index += 1) {
    if (!MARKER.test(lines[index])) body.push({ text: lines[index], line: index + 1 });
  }
  while (body.length && !body[0].text.trim()) body.shift();
  while (body.length && !body[body.length - 1].text.trim()) body.pop();
  if (!body.length) return { error: `region "${id}" is empty` };

  const indents = body.filter((b) => b.text.trim()).map((b) => b.text.match(/^[ \t]*/)[0]);
  let common = indents[0];
  for (const indent of indents) {
    while (!indent.startsWith(common)) common = common.slice(0, -1);
  }
  return {
    code: body
      .map((b) => (b.text.startsWith(common) ? b.text.slice(common.length) : b.text.trimStart()))
      .join("\n"),
    first: body[0].line,
    last: body[body.length - 1].line,
  };
}

export function renderSnippet({ file, lang = "" }, region, repoUrl = defaultRepoUrl) {
  const href = `${repoUrl}/blob/main/${file}#L${region.first}-L${region.last}`;
  return [
    "<details open>",
    `<summary><a href="${href}"><code>${file}</code></a> · lines ${region.first}–${region.last}</summary>`,
    "",
    "```" + lang,
    region.code,
    "```",
    "",
    "</details>",
    "",
  ].join("\n");
}

/**
 * Check (default) or rewrite (write: true) every tour snippet under /docs.
 * Returns a list of human-readable problems; empty means everything is current.
 */
export function syncTours({ write = false, repoUrl = defaultRepoUrl } = {}) {
  const problems = [];
  for (const doc of walk(docsRoot).filter((file) => file.endsWith(".md"))) {
    const original = readFileSync(doc, "utf8").replace(/\r\n/g, "\n");
    if (!original.includes("<!-- tour:snippet")) continue;
    const name = relative(repoRoot, doc).split(sep).join("/");
    const updated = original.replace(SNIPPET, (block, attrText, current) => {
      const attrs = attributes(attrText);
      if (!attrs.id || !attrs.file) {
        problems.push(`${name}: tour:snippet needs id and file attributes`);
        return block;
      }
      const sourcePath = resolve(repoRoot, attrs.file);
      if (!existsSync(sourcePath)) {
        problems.push(`${name}: ${attrs.id}: source file ${attrs.file} not found`);
        return block;
      }
      const region = extractRegion(readFileSync(sourcePath, "utf8"), attrs.id);
      if (region.error) {
        problems.push(`${name}: ${attrs.file}: ${region.error}`);
        return block;
      }
      const fresh = renderSnippet(attrs, region, repoUrl);
      if (!write && fresh !== current) {
        problems.push(`${name}: snippet "${attrs.id}" is out of date (run: npm run tour:sync)`);
      }
      return `<!-- tour:snippet ${attrText}-->\n${fresh}<!-- tour:end -->`;
    });
    if (write && updated !== original) {
      writeFileSync(doc, updated);
      console.log(`tour: updated ${name}`);
    }
  }
  return problems;
}

/**
 * Slide snippets: every `slide-*` tour region in the source, highlighted at build
 * time and committed (container builds do not see the backend source). Check by
 * default; `write: true` rewrites the JSON.
 */
export const slideSnippetsFile = resolve(here, "../src/presentation/snippets.generated.json");
const SLIDE_SOURCES = ["backend", "evals", "frontend/src", "infra", "config", "Dockerfile"];
const SKIP_DIRS = new Set([
  "node_modules",
  "__pycache__",
  ".venv",
  ".eval-venv",
  "generated",
  "dist",
]);
const LANGS = {
  ".py": "python",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".rego": "rego",
  ".bicep": "bash",
  ".json": "json",
};

function sourceFiles(path) {
  if (!existsSync(path)) return [];
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() && SKIP_DIRS.has(entry.name) ? [] : sourceFiles(resolve(path, entry.name)),
  );
}

function languageFor(file) {
  if (file.endsWith("Dockerfile")) return "dockerfile";
  const dot = file.lastIndexOf(".");
  return dot === -1 ? "" : LANGS[file.slice(dot)] || "";
}

export function buildSlideSnippets(repoUrl = defaultRepoUrl) {
  const snippets = {};
  const problems = [];
  const files = SLIDE_SOURCES.flatMap((path) => sourceFiles(resolve(repoRoot, path))).sort();
  for (const path of files) {
    const lang = languageFor(path);
    if (!lang && !path.endsWith("Dockerfile")) continue;
    const source = readFileSync(path, "utf8");
    const file = relative(repoRoot, path).split(sep).join("/");
    for (const match of source.matchAll(/^\s*(?:#|\/\/) tour:begin (slide-[\w-]+)\s*$/gm)) {
      const id = match[1];
      if (snippets[id]) {
        problems.push(`slide snippet "${id}" is defined in both ${snippets[id].file} and ${file}`);
        continue;
      }
      const region = extractRegion(source, id);
      if (region.error) {
        problems.push(`${file}: ${region.error}`);
        continue;
      }
      snippets[id] = {
        file,
        lang,
        first: region.first,
        last: region.last,
        href: `${repoUrl}/blob/main/${file}#L${region.first}-L${region.last}`,
        html: highlightCode(region.code, lang),
      };
    }
  }
  return { snippets, problems };
}

export function syncSlideSnippets({ write = false, repoUrl = defaultRepoUrl } = {}) {
  const { snippets, problems } = buildSlideSnippets(repoUrl);
  const fresh = JSON.stringify(snippets, null, 2) + "\n";
  const current = existsSync(slideSnippetsFile)
    ? readFileSync(slideSnippetsFile, "utf8").replace(/\r\n/g, "\n")
    : "";
  if (write && fresh !== current) {
    writeFileSync(slideSnippetsFile, fresh);
    console.log("tour: updated frontend/src/presentation/snippets.generated.json");
  } else if (!write && fresh !== current) {
    problems.push("slide snippets are out of date (run: npm run tour:sync)");
  }
  return problems;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const write = process.argv.includes("--write");
  const problems = [...syncTours({ write }), ...syncSlideSnippets({ write })];
  if (problems.length) {
    console.error("tour check failed:\n- " + problems.join("\n- "));
    process.exit(1);
  }
  console.log(write ? "tour: snippets synced" : "tour: all snippets current");
}
