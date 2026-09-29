// Writes src/generated/build-info.json for the footer colophon (eps-demo-ux).
// Generated at build time, never hand-edited. Inside the container build there
// is no .git folder, so the file written by the azd prepackage hook is kept.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(here, "../src/generated/build-info.json");

function fromGit() {
  try {
    const output = execFileSync("git", ["log", "-1", "--format=%H%n%cI%n%s"], {
      cwd: here,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const [sha, date, ...message] = output.split("\n");
    if (!sha || !date) return null;
    return { sha, date, message: message.join(" ").slice(0, 140) };
  } catch {
    return null;
  }
}

const info = fromGit();
mkdirSync(dirname(target), { recursive: true });
if (info) {
  writeFileSync(target, JSON.stringify(info, null, 2) + "\n");
  console.log(`build-info: ${info.sha.slice(0, 7)} ${info.date}`);
} else if (existsSync(target)) {
  console.log("build-info: no git metadata; keeping existing build-info.json");
} else {
  writeFileSync(
    target,
    JSON.stringify({ sha: "unknown", date: new Date(0).toISOString(), message: "unknown" }) + "\n",
  );
  console.log("build-info: no git metadata; wrote placeholder");
}
