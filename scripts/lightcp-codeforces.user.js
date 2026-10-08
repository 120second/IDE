// ==UserScript==
// @name         LightCP Codeforces 题目导入
// @namespace    lightcp
// @version      1.1.0
// @description  将 Codeforces 或洛谷题面和样例发送到 LightCP，洛谷 CF 题优先使用中文翻译。
// @match        https://codeforces.com/problemset/problem/*
// @match        https://codeforces.com/contest/*/problem/*
// @match        https://codeforces.com/gym/*/problem/*
// @match        https://*.codeforces.com/problemset/problem/*
// @match        https://*.codeforces.com/contest/*/problem/*
// @match        https://*.codeforces.com/gym/*/problem/*
// @match        https://www.luogu.com.cn/problem/*
// @match        https://luogu.com.cn/problem/*
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      127.0.0.1
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
  'use strict';
  const ENDPOINT = 'http://127.0.0.1:27121';

  function sampleText(pre) {
    if (!pre) return '';
    // CF's newer sample markup uses block lines; its older markup uses <br>.
    const lines = Array.from(pre.children).filter((el) => el.classList.contains('test-example-line'));
    const text = lines.length
      ? lines.map((line) => line.textContent || '').join('\n')
      : Array.from(pre.childNodes).map(function walk(node) {
          if (node.nodeType === 3) return node.textContent || '';
          if (node.nodeName === 'BR') return '\n';
          return Array.from(node.childNodes).map(walk).join('');
        }).join('');
    const normalized = text.replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ');
    return normalized.endsWith('\n') ? normalized : normalized + '\n';
  }

  function codeFence(text, language = '') {
    const runs = text.match(/`+/g) || [];
    const fence = '`'.repeat(Math.max(3, ...runs.map((run) => run.length + 1)));
    return `\n\n${fence}${language}\n${text.replace(/\r\n?/g, '\n').replace(/\n$/, '')}\n${fence}\n\n`;
  }

  function absoluteUrl(raw, base) {
    try {
      const url = new URL(raw, base);
      if (!['https:', 'http:'].includes(url.protocol)) return '';
      // Percent-encode Markdown delimiters without altering URL semantics.
      return url.href.replace(/[()<>]/g, (c) => encodeURIComponent(c));
    } catch { return ''; }
  }

  function htmlToMarkdown(root, base) {
    function mathText(node) {
      if (node.nodeType === 3) return node.textContent || '';
      const children = Array.from(node.childNodes).map(mathText).join('');
      if (node.nodeName === 'SUP') return `^{${children}}`;
      if (node.nodeName === 'SUB') return `_{${children}}`;
      return children;
    }
    function convert(node) {
      if (node.nodeType === 3) {
        return (node.textContent || '').replace(/\u00a0/g, ' ')
          .replace(/\$\$\$([\s\S]*?)\$\$\$/g, (_, tex) => `$${tex}$`);
      }
      if (node.nodeType !== 1) return '';
      const el = node;
      if (el.tagName === 'LIGHTCP-SAMPLES') return '\n\n' + el.textContent + '\n\n';
      if (el.matches('.MathJax, .MathJax_Display, .MathJax_Preview, .MJX_Assistive_MathML, .MathJax_SVG, .MathJax_SVG_Display')) return '';
      if (el.matches('script[type^="math/tex"]')) {
        const tex = el.textContent || '';
        return el.getAttribute('type').includes('mode=display') ? `\n\n$$\n${tex}\n$$\n\n` : `$${tex}$`;
      }
      if (el.matches('script, style, button, .sample-tests, .header')) return '';
      if (el.matches('.katex-display, .katex, mjx-container')) {
        const tex = el.querySelector('annotation[encoding="application/x-tex"]')?.textContent
          || el.getAttribute('data-tex');
        if (tex) return el.matches('.katex-display, [display="true"]') ? `\n\n$$\n${tex}\n$$\n\n` : `$${tex}$`;
      }
      if (el.matches('.tex-span')) return `$${mathText(el)}$`;
      if (el.tagName === 'PRE') return codeFence(sampleText(el));
      if (el.tagName === 'IMG') {
        const url = absoluteUrl(el.getAttribute('src'), base);
        const alt = (el.getAttribute('alt') || '').replace(/[\[\]\\]/g, '\\$&');
        return url ? `![${alt}](${url})` : '';
      }
      const children = Array.from(el.childNodes).map(convert).join('');
      switch (el.tagName) {
        case 'BR': return '\n';
        case 'STRONG': case 'B': return `**${children}**`;
        case 'EM': case 'I': return `*${children}*`;
        case 'CODE': return '`' + children.replace(/`/g, '\\`') + '`';
        case 'SUP': return `$^{${mathText(el)}}$`;
        case 'SUB': return `$_{${mathText(el)}}$`;
        case 'A': {
          const url = absoluteUrl(el.getAttribute('href'), base);
          return url ? `[${children.replace(/\]/g, '\\]')}](${url})` : children;
        }
        case 'H1': case 'H2': case 'H3': case 'H4': return `\n\n${'#'.repeat(Number(el.tagName[1]))} ${children.trim()}\n\n`;
        case 'LI': return `\n${el.parentElement?.tagName === 'OL' ? '1.' : '-'} ${children.trim()}\n`;
        case 'UL': case 'OL': return `\n\n${children}\n\n`;
        case 'TABLE': {
          const rows = Array.from(el.rows).map((row) => Array.from(row.cells).map((cell) =>
            Array.from(cell.childNodes).map(convert).join('').trim().replace(/\|/g, '\\|').replace(/\n/g, '<br>')));
          if (!rows.length) return '';
          const width = Math.max(...rows.map((row) => row.length));
          const rowText = (row) => '| ' + Array.from({ length: width }, (_, i) => row[i] || '').join(' | ') + ' |';
          return '\n\n' + [rowText(rows[0]), rowText(Array(width).fill('---')), ...rows.slice(1).map(rowText)].join('\n') + '\n\n';
        }
        case 'P': case 'DIV': case 'SECTION': return `\n\n${children.trim()}\n\n`;
        default: return children;
      }
    }
    return Array.from(root.childNodes).map(convert).join('').trim();
  }

  function isLuogu(href) {
    return ['www.luogu.com.cn', 'luogu.com.cn'].includes(new URL(href).hostname);
  }

  function luoguId(href) {
    const match = new URL(href).pathname.match(/^\/problem\/([A-Za-z][A-Za-z0-9_]{0,79})\/?$/);
    if (!match) throw new Error('请打开单道洛谷题目页面。');
    return match[1];
  }

  function extractLuoguProblem(doc, href) {
    const pid = luoguId(href);
    let context;
    try { context = JSON.parse(doc.querySelector('#lentille-context')?.textContent || 'null'); }
    catch { throw new Error('无法读取洛谷题面数据，请刷新题目后重试。'); }
    const data = context?.data;
    const problem = data?.problem;
    if (!problem || problem.pid !== pid) throw new Error('洛谷题目尚未载入，请等待页面加载完成后重试。');
    // Luogu exposes the original Markdown. Prefer the Chinese translation even
    // when the browser is showing an English CF statement.
    const content = [data.translations?.['zh-CN'], problem.contenu, problem.content]
      .find((item) => item?.locale === 'zh-CN' && typeof item.description === 'string' && item.description.trim())
      || [problem.contenu, problem.content].find((item) => typeof item?.description === 'string' && item.description.trim());
    if (!content) throw new Error('没有找到洛谷题面。请先登录或确认有权查看该题目。');
    const name = content.name || problem.name;
    if (typeof name !== 'string' || !name.trim()) throw new Error('没有找到洛谷题目名称。');
    const title = `${pid} ${name.trim()}`;
    const url = `https://www.luogu.com.cn/problem/${pid}`;
    const rawSamples = problem.samples ?? [];
    if (!Array.isArray(rawSamples) || rawSamples.some((pair) => !Array.isArray(pair) || pair.length !== 2 || pair.some((value) => typeof value !== 'string'))) {
      throw new Error('洛谷样例输入输出格式错误，请刷新题目后重试。');
    }
    const sample = (text) => text.replace(/\r\n?/g, '\n').replace(/\n?$/, '\n');
    const samples = rawSamples.map(([input, output]) => ({ input: sample(input), expectedOutput: sample(output) }));
    const time = problem.limits?.time?.[0], memory = problem.limits?.memory?.[0];
    const sections = [`# ${title}`, `[洛谷题目链接](${url})`];
    if (typeof problem.vjudge?.link === 'string') {
      const original = absoluteUrl(problem.vjudge.link, url);
      if (original) sections.push(`[原题链接](${original})`);
    }
    const limits = [Number.isFinite(time) && `时限：${time} ms`, Number.isFinite(memory) && `内存：${memory} KB`].filter(Boolean);
    if (limits.length) sections.push(limits.join(' · '));
    for (const [key, heading] of [['background', '题目背景'], ['description', '题目描述'], ['formatI', '输入格式'], ['formatO', '输出格式']]) {
      if (typeof content[key] === 'string' && content[key].trim()) sections.push(`## ${heading}\n\n${content[key].trim()}`);
    }
    samples.forEach((pair, i) => sections.push(`## 样例输入 ${i + 1}` + codeFence(pair.input) + `## 样例输出 ${i + 1}` + codeFence(pair.expectedOutput)));
    if (typeof content.hint === 'string' && content.hint.trim()) sections.push(`## 说明/提示\n\n${content.hint.trim()}`);
    return { title, url, markdown: sections.join('\n\n') + '\n', samples };
  }

  function extractProblem(doc, href) {
    if (isLuogu(href)) return extractLuoguProblem(doc, href);
    const statement = doc.querySelector('.problem-statement');
    const title = statement?.querySelector('.header .title')?.textContent?.trim();
    if (!statement || !title) throw new Error('没有找到题面。请打开单道 CF 题目并等待页面载入。');
    const url = new URL(href);
    url.search = ''; url.hash = '';
    const inputs = Array.from(statement.querySelectorAll('.sample-test .input pre'));
    const outputs = Array.from(statement.querySelectorAll('.sample-test .output pre'));
    if (inputs.length !== outputs.length) throw new Error('样例输入输出数量不一致，请刷新题目后重试。');
    const samples = inputs.map((pre, i) => ({ input: sampleText(pre), expectedOutput: sampleText(outputs[i]) }));
    function propertyValue(selector) {
      const value = statement.querySelector(selector)?.cloneNode(true);
      value?.querySelector('.property-title')?.remove();
      return value?.textContent?.trim();
    }
    const time = propertyValue('.time-limit');
    const memory = propertyValue('.memory-limit');
    const sections = [`# ${title}`, `[Codeforces 题目链接](${url.href})`, [time && `时限：${time}`, memory && `内存：${memory}`].filter(Boolean).join(' · ')];
    // Preserve the original DOM (including any local translation extension).
    const body = statement.cloneNode(true);
    body.querySelector('.header')?.remove();
    body.querySelectorAll('.section-title').forEach((heading) => {
      const replacement = doc.createElement('h2');
      replacement.textContent = heading.textContent;
      heading.replaceWith(replacement);
    });
    const sampleMarkdown = samples.map((sample, i) =>
      `## 样例输入 ${i + 1}` + codeFence(sample.input) + `## 样例输出 ${i + 1}` + codeFence(sample.expectedOutput)
    ).join('\n\n');
    body.querySelectorAll('.sample-tests').forEach((block) => {
      const replacement = doc.createElement('lightcp-samples');
      replacement.textContent = sampleMarkdown;
      block.replaceWith(replacement);
    });
    sections.push(htmlToMarkdown(body, url.href));
    return { title, url: url.href, markdown: sections.filter(Boolean).join('\n\n') + '\n', samples };
  }

  async function loadProblem(doc, href) {
    if (!isLuogu(href)) return extractProblem(doc, href);
    const pid = luoguId(href);
    try {
      const context = JSON.parse(doc.querySelector('#lentille-context')?.textContent || 'null');
      if (context?.data?.problem?.pid === pid) return extractLuoguProblem(doc, href);
    } catch { /* A client-side page transition may leave the initial context stale. */ }
    const url = new URL(`/problem/${pid}`, href);
    url.searchParams.set('lang', 'zh-CN');
    // Same-origin, authenticated page fetch: no private site API or eval needed.
    const response = await fetch(url.href, { credentials: 'same-origin', signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error(`洛谷题面读取失败（HTTP ${response.status}），请在浏览器中确认已登录且可查看题目。`);
    return extractLuoguProblem(new DOMParser().parseFromString(await response.text(), 'text/html'), href);
  }

  function pageKey(href) {
    const url = new URL(href);
    return url.origin + url.pathname.replace(/\/$/, '');
  }

  // CommonJS test hook; does not exist in a userscript sandbox.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { extractProblem, extractLuoguProblem, loadProblem, sampleText, htmlToMarkdown };
    return;
  }

  function request(path, options = {}) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: options.body ? 'POST' : 'GET', url: ENDPOINT + path, timeout: 15000,
        headers: { 'X-LightCP-Client': 'lightcp-userscript-v1', ...options.headers },
        ...(options.body ? { data: JSON.stringify(options.body) } : {}),
        onload(response) {
          try {
            const result = JSON.parse(response.responseText);
            if (response.status < 200 || response.status >= 300) throw new Error(result.error || `HTTP ${response.status}`);
            resolve(result);
          } catch (error) { reject(error); }
        },
        onerror() { reject(new Error('无法连接 LightCP，请在 IDE 中先打开工作区并开启“题目监听”。')); },
        ontimeout() { reject(new Error('导入超时，请检查 IDE。题目可能已经保存，再次发送会打开已有文件。')); },
      });
    });
  }

  let sending = false;
  let button;
  let sentKey;
  let autoFollow = GM_getValue('lightcp-auto-follow', true);
  async function sendProblem(session, automatic = false) {
    if (sending) return;
    sending = true;
    if (button) { button.disabled = true; button.textContent = '正在发送…'; }
    try {
      const href = location.href;
      const problem = await loadProblem(document, href);
      if (pageKey(location.href) !== pageKey(href) || (automatic && (!autoFollow || document.visibilityState !== 'visible'))) return;
      session ||= await request('/session');
      const imported = await request('/problem', {
        body: problem,
        headers: { 'Content-Type': 'application/json', 'X-LightCP-Token': session.token },
      });
      sentKey = `${session.token}:${pageKey(href)}`;
      if (button) button.textContent = imported.alreadyImported ? '已在 LightCP 打开' : '已导入 LightCP';
    } catch (error) {
      if (button) button.textContent = '发送失败 · 点击重试';
      if (!automatic) alert(`LightCP：${error.message}`);
    } finally {
      sending = false;
      if (button) button.disabled = false;
    }
  }

  GM_registerMenuCommand('发送当前题目到 LightCP', () => void sendProblem());
  GM_registerMenuCommand('开启自动题目监听', () => { autoFollow = true; GM_setValue('lightcp-auto-follow', true); void follow(); });
  GM_registerMenuCommand('关闭自动题目监听', () => { autoFollow = false; GM_setValue('lightcp-auto-follow', false); });
  function mountButton() {
    if (button?.isConnected) return;
    const luogu = isLuogu(location.href);
    if (luogu && !/^\/problem\/[A-Za-z][A-Za-z0-9_]{0,79}\/?$/.test(new URL(location.href).pathname)) return;
    const header = luogu ? document.body : document.querySelector('.problem-statement .header');
    if (!header) return;
    button = document.createElement('button');
    button.type = 'button'; button.textContent = '发送到 LightCP';
    button.style.cssText = 'margin:12px auto;padding:8px 16px;border:1px solid #278977;border-radius:5px;background:#e8f6f1;color:#14594d;cursor:pointer;font:600 14px sans-serif;';
    if (luogu) button.style.cssText += 'position:fixed;right:20px;bottom:20px;z-index:10000;box-shadow:0 2px 10px #0002;';
    button.addEventListener('click', () => void sendProblem());
    header.appendChild(button);
  }
  mountButton();

  let checking = false;
  async function follow() {
    mountButton();
    if (isLuogu(location.href) && !/^\/problem\/[A-Za-z][A-Za-z0-9_]{0,79}\/?$/.test(new URL(location.href).pathname)) return;
    if (!autoFollow || sending || checking || document.visibilityState !== 'visible') return;
    checking = true;
    try {
      const session = await request('/session');
      if (`${session.token}:${pageKey(location.href)}` !== sentKey && autoFollow && document.visibilityState === 'visible') {
        await sendProblem(session, true);
      }
    } catch { /* IDE is not listening: stay quiet until the user enables it. */ }
    finally { checking = false; }
  }
  setInterval(() => void follow(), 3000);
  document.addEventListener('visibilitychange', () => void follow());
  void follow();
})();
