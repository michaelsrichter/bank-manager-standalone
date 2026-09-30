// Syntax highlighting for served docs, done at build time (eps-demo-docs):
// no runtime highlighter and no public CDN. Unknown languages are escaped as text.
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import json from "highlight.js/lib/languages/json";
import python from "highlight.js/lib/languages/python";
import typescript from "highlight.js/lib/languages/typescript";
import yaml from "highlight.js/lib/languages/yaml";

// Minimal Rego (Open Policy Agent) grammar; highlight.js has none built in.
function rego(h) {
  return {
    name: "Rego",
    aliases: ["opa"],
    keywords: {
      keyword: "package import default if else not some every in contains with as",
      literal: "true false null",
      built_in:
        "count sprintf lower upper replace startswith endswith regex object array trim concat sum",
    },
    contains: [
      h.HASH_COMMENT_MODE,
      h.QUOTE_STRING_MODE,
      { scope: "string", begin: "`", end: "`" },
      h.C_NUMBER_MODE,
      { scope: "title.function", begin: /^[A-Za-z_][\w]*(?=\s*(\(|:=|if\b|\{|\[))/, relevance: 0 },
      { scope: "operator", begin: /:=|==|!=|>=|<=|>|</, relevance: 0 },
    ],
  };
}

hljs.registerLanguage("bash", bash);
hljs.registerLanguage("dockerfile", dockerfile);
hljs.registerLanguage("json", json);
hljs.registerLanguage("python", python);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("yaml", yaml);
hljs.registerLanguage("rego", rego);

const ALIASES = { ts: "typescript", tsx: "typescript", sh: "bash", py: "python", yml: "yaml" };

function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function highlightCode(text, lang) {
  const language = ALIASES[lang] || lang;
  if (language && hljs.getLanguage(language)) {
    const html = hljs.highlight(text, { language, ignoreIllegals: true }).value;
    return `<pre><code class="hljs language-${language}">${html}</code></pre>\n`;
  }
  return `<pre><code class="hljs">${escapeHtml(text)}</code></pre>\n`;
}
