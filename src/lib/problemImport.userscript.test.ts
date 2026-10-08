import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { Window } from "happy-dom";
import { describe, expect, it, vi } from "vitest";

const source = readFileSync(new URL("../../scripts/lightcp-codeforces.user.js", import.meta.url), "utf8");
const module = { exports: {} as {
  extractProblem: (doc: Document, href: string) => { title: string; url: string; markdown: string; samples: { input: string; expectedOutput: string }[] };
  htmlToMarkdown: (element: Element, base: string) => string;
} };
runInNewContext(source, { module, URL });
const { extractProblem, htmlToMarkdown } = module.exports;
const href = "https://codeforces.com/problemset/problem/1234/A?locale=en#top";

function documentFor(body: string): Document {
  const window = new Window();
  window.document.body.innerHTML = `<div class="problem-statement"><div class="header"><div class="title">A. Example</div><div class="time-limit">1 second</div><div class="memory-limit">256 MB</div></div>${body}</div>`;
  return window.document as unknown as Document;
}

function luoguDocument(pid = "CF1234A", content: Record<string, unknown> = {}, overrides: Record<string, unknown> = {}): Document {
  const window = new Window();
  const script = window.document.createElement("script");
  script.id = "lentille-context";
  script.type = "application/json";
  script.textContent = JSON.stringify({ data: {
    problem: { pid, name: "示例题", content: { name: "Example", description: "English statement", locale: "en" },
      contenu: { name: "示例题", description: "求 $a+b$。", formatI: "输入两个整数。", formatO: "输出它们的和。", locale: "zh-CN", ...content },
      samples: [["1  2\r\n\r\n  3", "6\n"]], limits: { time: [1000], memory: [262144] },
      vjudge: { link: "https://codeforces.com/problemset/problem/1234/A" }, ...overrides },
  } });
  window.document.body.appendChild(script);
  return window.document as unknown as Document;
}

describe("bundled Luogu userscript", () => {
  const luogu = "https://www.luogu.com.cn/problem/CF1234A?lang=en#top";

  it("imports Chinese CF translations as original Markdown and preserves samples", () => {
    const doc = luoguDocument("CF1234A", { background: "背景。", hint: "```cpp\nint main() {}\n```\n![图](https://cdn.luogu.com.cn/example.png)" });
    const result = extractProblem(doc, luogu);
    expect(result.title).toBe("CF1234A 示例题");
    expect(result.url).toBe("https://www.luogu.com.cn/problem/CF1234A");
    expect(result.markdown).toContain("求 $a+b$。");
    expect(result.markdown).not.toContain("English statement");
    expect(result.markdown).toContain("时限：1000 ms · 内存：262144 KB");
    expect(result.markdown).toContain("[原题链接](https://codeforces.com/problemset/problem/1234/A)");
    expect(result.markdown).toContain("```cpp\nint main() {}\n```");
    expect(result.markdown).toContain("![图](https://cdn.luogu.com.cn/example.png)");
    expect(result.samples).toEqual([{ input: "1  2\n\n  3\n", expectedOutput: "6\n" }]);
    expect(result.markdown.indexOf("## 样例输出 1")).toBeLessThan(result.markdown.indexOf("## 说明/提示"));
    expect(doc.querySelector("#lentille-context")).not.toBeNull();
  });

  it("supports native Luogu problems with multiple samples or no samples", () => {
    const result = extractProblem(luoguDocument("P1001", {}, { samples: [["1 2", "3"], ["4 5", "9"]] }), "https://luogu.com.cn/problem/P1001");
    expect(result.url).toBe("https://www.luogu.com.cn/problem/P1001");
    expect(result.samples).toHaveLength(2);
    expect(result.markdown).toContain("## 样例输入 2");
    expect(extractProblem(luoguDocument("P1001", {}, { samples: [] }), result.url).samples).toEqual([]);
  });

  it("falls back to the original statement when no Chinese translation exists", () => {
    const doc = luoguDocument("AT_abc100_a", {}, { contenu: null });
    expect(extractProblem(doc, "https://www.luogu.com.cn/problem/AT_abc100_a").markdown).toContain("English statement");
  });

  it("rejects malformed samples, stale page data and inaccessible statements", () => {
    expect(() => extractProblem(luoguDocument("CF1234A", {}, { samples: [["input"]] }), luogu)).toThrow("样例");
    expect(() => extractProblem(luoguDocument("P1001"), luogu)).toThrow("尚未载入");
    expect(() => extractProblem(luoguDocument("CF1234A", {}, { contenu: null, content: null }), luogu)).toThrow("没有找到洛谷题面");
    expect(() => extractProblem(luoguDocument(), "https://www.luogu.com.cn/problem/CF1234A/solution")).toThrow("单道洛谷");
  });

  it("fetches a fresh same-origin page after client-side navigation without sending stale content", async () => {
    const window = new Window();
    const fetch = vi.fn().mockResolvedValue({ ok: true, text: async () => luoguDocument("P1001").documentElement.outerHTML });
    const hooks = { exports: {} as { loadProblem: (doc: Document, href: string) => Promise<{ title: string; url: string }> } };
    runInNewContext(source, { module: hooks, URL, fetch, AbortSignal, DOMParser: window.DOMParser });
    const result = await hooks.exports.loadProblem(luoguDocument(), "https://www.luogu.com.cn/problem/P1001");
    expect(result.title).toBe("P1001 示例题");
    expect(fetch).toHaveBeenCalledWith("https://www.luogu.com.cn/problem/P1001?lang=zh-CN", expect.objectContaining({ credentials: "same-origin" }));
    fetch.mockClear();
    await hooks.exports.loadProblem(luoguDocument("P1001"), result.url);
    expect(fetch).not.toHaveBeenCalled();
    fetch.mockResolvedValue({ ok: false, status: 403 });
    await expect(hooks.exports.loadProblem(luoguDocument(), result.url)).rejects.toThrow("HTTP 403");
  });
});

describe("bundled Codeforces userscript", () => {
  it("preserves sample indentation, empty lines and old <br> markup in Markdown and test cases", () => {
    const doc = documentFor('<div><p>Solve this.</p></div><div class="sample-tests"><div class="sample-test"><div class="input"><pre>2<br>  1  2<br><br>3</pre></div><div class="output"><pre>YES<br>NO</pre></div></div></div><div class="note"><div class="section-title">Note</div><p>Explanation</p></div>');
    const result = extractProblem(doc, href);
    expect(result.title).toBe("A. Example");
    expect(result.url).toBe("https://codeforces.com/problemset/problem/1234/A");
    expect(result.samples).toEqual([{ input: "2\n  1  2\n\n3\n", expectedOutput: "YES\nNO\n" }]);
    expect(result.markdown).toContain("## 样例输入 1\n\n```\n2\n  1  2\n\n3\n```");
    expect(result.markdown.indexOf("## 样例输出 1")).toBeLessThan(result.markdown.indexOf("## Note"));
    expect(doc.querySelector(".sample-tests")).not.toBeNull();
  });

  it("preserves new CF line wrappers and pairs multiple samples", () => {
    const sample = '<div class="sample-test"><div class="input"><pre><div class="test-example-line">1</div><div class="test-example-line"></div><div class="test-example-line">  a</div></pre></div><div class="output"><pre>ok</pre></div></div>';
    const result = extractProblem(documentFor(`<div class="sample-tests">${sample}${sample}</div>`), href);
    expect(result.samples).toHaveLength(2);
    expect(result.samples[0].input).toBe("1\n\n  a\n");
    expect(result.markdown).toContain("## 样例输入 2");
  });

  it("extracts TeX once from raw CF math, MathJax and KaTeX, including display math", () => {
    const doc = documentFor('<p>$$$n \\le 10$$$ <span class="tex-span">a<sub>i</sub><sup>2</sup></span> <span class="MathJax">visual math duplicate</span><script type="math/tex">x + y</script></p><div class="katex-display"><span class="katex"><annotation encoding="application/x-tex">\\sum_i a_i</annotation></span></div><script type="math/tex; mode=display">\\frac{a}{b}</script>');
    const result = extractProblem(doc, href);
    expect(result.markdown).toContain("$n \\le 10$");
    expect(result.markdown).toContain("$a_{i}^{2}$");
    expect(result.markdown).toContain("$x + y$");
    expect(result.markdown).not.toContain("visual math duplicate");
    expect(result.markdown).toContain("$$\n\\sum_i a_i\n$$");
    expect(result.markdown.match(/\\sum_i/g)).toHaveLength(1);
    expect(result.markdown).toContain("$$\n\\frac{a}{b}\n$$");
  });

  it("handles headings, lists, relative images and tables without executable links", () => {
    const doc = documentFor('<div class="input-specification"><div class="section-title">Input</div><p>Use <b>values</b>.</p><ul><li>First</li><li>Second</li></ul><img src="/images/example.png" alt="diagram"><a href="javascript:alert(1)">unsafe</a><table><tr><th>n</th><th>v</th></tr><tr><td>1</td><td>a|b</td></tr></table></div>');
    const result = extractProblem(doc, href);
    expect(result.markdown).toContain("## Input");
    expect(result.markdown).toContain("**values**");
    expect(result.markdown).toContain("- First");
    expect(result.markdown).toContain("![diagram](https://codeforces.com/images/example.png)");
    expect(result.markdown).toContain("| 1 | a\\|b |");
    expect(result.markdown).not.toContain("javascript:");
  });

  it("uses a longer fence for sample data containing backticks", () => {
    const doc = documentFor('<pre>```\ntext</pre>');
    expect(htmlToMarkdown(doc.querySelector(".problem-statement")!, href)).toContain("````\n```\ntext\n````");
  });

  it("rejects non-problem pages and unpaired samples", () => {
    const doc = documentFor('<div class="sample-test"><div class="input"><pre>1</pre></div></div>');
    expect(() => extractProblem(doc, href)).toThrow("数量不一致");
    doc.querySelector(".problem-statement")?.remove();
    expect(() => extractProblem(doc, href)).toThrow("没有找到题面");
  });
});

describe("userscript automatic listening", () => {
  function runtime({ visible = true, enabled = true, online = true, luogu = false } = {}) {
    const doc = luogu ? luoguDocument() : documentFor('<p>A test statement.</p>');
    const location = { href: luogu ? "https://www.luogu.com.cn/problem/CF1234A" : href };
    Object.defineProperty(doc, "visibilityState", { configurable: true, get: () => visible ? "visible" : "hidden" });
    let tick = () => {};
    let token = "session-one";
    const requests: { url: string; data?: string }[] = [];
    const menus = new Map<string, () => void>();
    const alert = vi.fn();
    runInNewContext(source, {
      document: doc, location, URL, alert,
      GM_getValue: () => enabled, GM_setValue: vi.fn(),
      GM_registerMenuCommand: (name: string, callback: () => void) => menus.set(name, callback),
      setInterval: (callback: () => void) => { tick = callback; return 1; },
      GM_xmlhttpRequest: (request: { url: string; data?: string; onload: (response: { status: number; responseText: string }) => void; onerror: () => void }) => {
        requests.push(request);
        if (!online) { request.onerror(); return; }
        request.onload({ status: 200, responseText: JSON.stringify(request.url.endsWith("/session") ? { token } : { alreadyImported: false }) });
      },
    });
    return { doc, location, requests, menus, alert, tick: () => tick(), changeSession: () => { token = "session-two"; }, show: () => { visible = true; } };
  }

  it("automatically sends a visible problem once per listening session", async () => {
    const running = runtime();
    const imports = () => running.requests.filter((request) => request.url.endsWith("/problem"));
    await vi.waitFor(() => expect(imports()).toHaveLength(1));
    expect(JSON.parse(imports()[0].data!).title).toBe("A. Example");
    running.tick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(imports()).toHaveLength(1);
    running.changeSession();
    running.tick();
    await vi.waitFor(() => expect(imports()).toHaveLength(2));
  });

  it("does not send background tabs or when automatic listening is disabled", async () => {
    const hidden = runtime({ visible: false });
    hidden.tick();
    expect(hidden.requests).toHaveLength(0);
    hidden.show();
    hidden.tick();
    await vi.waitFor(() => expect(hidden.requests.some((request) => request.url.endsWith("/problem"))).toBe(true));
    const disabled = runtime({ enabled: false });
    disabled.tick();
    expect(disabled.requests).toHaveLength(0);
    disabled.menus.get("发送当前题目到 LightCP")!();
    await vi.waitFor(() => expect(disabled.requests.some((request) => request.url.endsWith("/problem"))).toBe(true));
  });

  it("stays quiet when the IDE is offline and reports manual send failures", async () => {
    const running = runtime({ online: false });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(running.alert).not.toHaveBeenCalled();
    running.menus.get("发送当前题目到 LightCP")!();
    await vi.waitFor(() => expect(running.alert).toHaveBeenCalledWith(expect.stringContaining("开启“题目监听”")));
  });

  it("automatically imports a new Luogu problem in the same listening session after navigation", async () => {
    const running = runtime({ luogu: true });
    const imports = () => running.requests.filter((request) => request.url.endsWith("/problem"));
    await vi.waitFor(() => expect(imports()).toHaveLength(1));
    expect(JSON.parse(imports()[0].data!).title).toBe("CF1234A 示例题");
    running.doc.querySelector("#lentille-context")!.textContent = luoguDocument("P1001").querySelector("#lentille-context")!.textContent;
    running.location.href = "https://www.luogu.com.cn/problem/P1001";
    running.tick();
    await vi.waitFor(() => expect(imports()).toHaveLength(2));
    expect(JSON.parse(imports()[1].data!).url).toBe(running.location.href);
    running.tick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(imports()).toHaveLength(2);
  });
});
