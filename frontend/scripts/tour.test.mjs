import { describe, expect, it } from "vitest";
import { highlightCode } from "./highlight.mjs";
import { extractRegion, renderSnippet, syncTours } from "./tour.mjs";

const SOURCE = [
  "import x",
  "def outer():",
  "    # tour:begin outer",
  "    a = 1",
  "    # tour:begin inner",
  "    b = 2",
  "    # tour:end inner",
  "",
  "    return a + b",
  "    # tour:end outer",
  "tail",
].join("\n");

describe("tour snippet extraction", () => {
  it("extracts, dedents, strips nested markers, and reports real line numbers", () => {
    expect(extractRegion(SOURCE, "outer")).toEqual({
      code: "a = 1\nb = 2\n\nreturn a + b",
      first: 4,
      last: 9,
    });
    expect(extractRegion(SOURCE, "inner")).toEqual({ code: "b = 2", first: 6, last: 6 });
  });

  it("reports missing or empty regions", () => {
    expect(extractRegion(SOURCE, "nope").error).toMatch(/missing "tour:begin nope"/);
    expect(extractRegion("# tour:begin x\n", "x").error).toMatch(/missing "tour:end x"/);
    expect(extractRegion("# tour:begin x\n\n# tour:end x", "x").error).toMatch(/empty/);
    expect(extractRegion("// tour:begin t\nconst a = 1;\n// tour:end t", "t").code).toBe(
      "const a = 1;",
    );
  });

  it("renders a collapsible block linked to the exact lines", () => {
    const block = renderSnippet(
      { file: "src/a.py", lang: "python" },
      { code: "x = 1", first: 3, last: 3 },
      "https://example.test/repo",
    );
    expect(block).toContain('href="https://example.test/repo/blob/main/src/a.py#L3-L3"');
    expect(block).toContain("```python\nx = 1\n```");
    expect(block.startsWith("<details open>")).toBe(true);
  });

  it("finds every committed tour snippet current", () => {
    expect(syncTours()).toEqual([]);
  });
});

describe("build-time highlighting", () => {
  it("highlights Rego with the custom grammar", () => {
    const html = highlightCode('deny("x") if {\n\tnot allowed\n}', "rego");
    expect(html).toContain('class="hljs language-rego"');
    expect(html).toContain('<span class="hljs-keyword">if</span>');
  });

  it("escapes unknown languages as plain text", () => {
    const html = highlightCode("<script>alert(1)</script>", "cobol");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });

  it("maps common aliases", () => {
    expect(highlightCode("const a = 1;", "ts")).toContain("language-typescript");
  });
});
