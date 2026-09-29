// Converts the canonical /docs Markdown into static HTML at build time so the
// app can serve documentation without repository access (eps-demo-docs).
// Fails the build on raw Mermaid, broken internal links, or missing images.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Marked } from "marked";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
const docsRoot = resolve(repoRoot, "docs");
const outFile = resolve(here, "../src/generated/docs.json");
const assetsOut = resolve(here, "../public/docs-assets");
const repoUrl =
  process.env.REPO_URL || "https://github.com/michaelsrichter/bank-manager-standalone";

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = resolve(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

const files = walk(docsRoot).filter((file) => file.endsWith(".md"));
const toKey = (file) => relative(docsRoot, file).split(sep).join("/");
const keys = new Set(files.map(toKey));
const problems = [];
const pages = {};

for (const file of files) {
  const key = toKey(file);
  const source = readFileSync(file, "utf8");
  if (/^```\s*mermaid/m.test(source)) {
    problems.push(`${key}: raw Mermaid block; commit a pre-rendered SVG instead`);
  }
  const baseDir = posix.dirname(key);
  const marked = new Marked({
    gfm: true,
    walkTokens(token) {
      if (token.type !== "link" && token.type !== "image") return;
      const href = token.href || "";
      if (/^(https?:|mailto:|#)/.test(href)) return;
      const [pathPart] = href.split("#");
      const target = posix.normalize(posix.join(baseDir, pathPart));
      if (token.type === "image") {
        const absolute = resolve(docsRoot, target);
        if (!existsSync(absolute)) problems.push(`${key}: missing image ${href}`);
        token.href = `/docs-assets/${target}`;
        return;
      }
      if (target.endsWith(".md") && !target.startsWith("..")) {
        if (!keys.has(target)) problems.push(`${key}: broken link ${href}`);
        token.href = `#/docs/${target}`;
        return;
      }
      const repoPath = posix.normalize(posix.join("docs", target));
      if (!existsSync(resolve(repoRoot, repoPath))) {
        problems.push(`${key}: broken repo link ${href}`);
      }
      token.href = `${repoUrl}/blob/main/${repoPath.replace(/\/$/, "")}`;
    },
  });
  let html = marked.parse(source);
  html = html.replace(
    /<a href="(https?:[^"]+)"/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer"',
  );
  const title = (source.match(/^#\s+(.+)$/m) || [null, key])[1].trim();
  pages[key] = { title, html };
}

if (problems.length) {
  console.error("build-docs failed:\n- " + problems.join("\n- "));
  process.exit(1);
}

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify({ pages }, null, 0) + "\n");
mkdirSync(assetsOut, { recursive: true });
for (const file of walk(docsRoot).filter((f) => /\.(svg|png)$/.test(f))) {
  const target = resolve(assetsOut, relative(docsRoot, file));
  mkdirSync(dirname(target), { recursive: true });
  cpSync(file, target);
}
console.log(`build-docs: ${files.length} pages`);
