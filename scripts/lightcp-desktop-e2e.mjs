// Development-only helper for exercising the real Tauri WebView through the
// WebView2 DevTools endpoint. Start `tauri dev` with a remote-debugging port,
// then select one of the explicit actions below. Credentials come only from
// environment variables and are never written to this repository.

const action = process.argv[2] ?? "inspect";
const actionArgument = process.argv[3] ?? "";
const endpoint = process.env.LIGHTCP_E2E_CDP_URL ?? "http://127.0.0.1:19222/json";
const username = process.env.LIGHTCP_E2E_USERNAME ?? "";
const email = process.env.LIGHTCP_E2E_EMAIL ?? "";
const password = process.env.LIGHTCP_E2E_PASSWORD ?? "";

const targets = await (await fetch(endpoint)).json();
const target = targets.find((candidate) => candidate.title === "LightCP") ?? targets[0];
if (!target?.webSocketDebuggerUrl) throw new Error("LightCP WebView target was not found");

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let requestId = 0;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  const handler = pending.get(message.id);
  if (!handler) return;
  pending.delete(message.id);
  handler(message);
});

function send(method, params = {}) {
  const id = ++requestId;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    pending.set(id, (message) => {
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    });
  });
}

async function evaluate(expression) {
  const result = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? "WebView evaluation failed");
  }
  return result.result.value;
}

function requireCredentials({ needsEmail = false } = {}) {
  if (!username || !password || (needsEmail && !email)) {
    throw new Error(
      "Set LIGHTCP_E2E_USERNAME, LIGHTCP_E2E_PASSWORD and, for registration, LIGHTCP_E2E_EMAIL",
    );
  }
}

const waitHelper = `
  const waitFor = async (predicate, timeout = 10000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const value = predicate();
      if (value) return value;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("Timed out waiting for the LightCP UI");
  };
  const setInput = (selector, value) => {
    const input = document.querySelector(selector);
    if (!(input instanceof HTMLInputElement)) throw new Error("Missing input: " + selector);
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const buttonWithText = (text) => [...document.querySelectorAll("button")]
    .find((button) => button.textContent?.trim() === text);
`;

let output;
switch (action) {
  case "inspect":
    output = await evaluate(`({
      title: document.title,
      text: document.body.innerText,
      authScreen: document.querySelector(".auth-card") !== null,
      workbench: document.querySelector(".app-shell") !== null,
    })`);
    break;

  case "prepare-register":
    requireCredentials({ needsEmail: true });
    output = await evaluate(`(async () => {
      ${waitHelper}
      const switchButton = buttonWithText("创建账号");
      if (switchButton) switchButton.click();
      await waitFor(() => document.querySelector("#register-username"));
      setInput("#register-username", ${JSON.stringify(username)});
      setInput("#register-email", ${JSON.stringify(email)});
      setInput("#register-password", ${JSON.stringify(password)});
      setInput("#register-confirm", ${JSON.stringify(password)});
      return {
        screen: document.querySelector("#auth-form-title")?.textContent?.trim(),
        username: document.querySelector("#register-username")?.value,
        email: document.querySelector("#register-email")?.value,
        passwordLength: document.querySelector("#register-password")?.value.length,
      };
    })()`);
    break;

  case "submit-register":
    output = await evaluate(`(async () => {
      ${waitHelper}
      const submit = document.querySelector("form .auth-submit");
      if (!(submit instanceof HTMLButtonElement)) throw new Error("Register submit button is missing");
      submit.click();
      await waitFor(() => document.querySelector(".app-shell") || document.querySelector(".auth-message.error"), 20000);
      return { text: document.body.innerText, registered: document.querySelector(".app-shell") !== null };
    })()`);
    break;

  case "login":
    requireCredentials();
    output = await evaluate(`(async () => {
      ${waitHelper}
      const loginSwitch = buttonWithText("返回登录");
      if (loginSwitch) loginSwitch.click();
      await waitFor(() => document.querySelector("#login-identifier"));
      setInput("#login-identifier", ${JSON.stringify(username)});
      setInput("#login-password", ${JSON.stringify(password)});
      document.querySelector("form .auth-submit")?.click();
      await waitFor(() => document.querySelector(".app-shell") || document.querySelector(".auth-message.error"), 20000);
      return { text: document.body.innerText, loggedIn: document.querySelector(".app-shell") !== null };
    })()`);
    break;

  case "templates":
    output = await evaluate(`(async () => {
      ${waitHelper}
      const templatesButton = await waitFor(() => document.querySelector('button[aria-label="模板"]'));
      templatesButton.click();
      await waitFor(() => document.body.innerText.includes("Empty C++") || document.body.innerText.includes("模板"), 20000);
      await new Promise((resolve) => setTimeout(resolve, 500));
      return {
        text: document.body.innerText,
        defaults: ["Empty C++", "Contest C++", "Multi Test C++"]
          .filter((name) => document.body.innerText.includes(name)),
      };
    })()`);
    break;

  case "category":
    output = await evaluate(`(async () => {
      ${waitHelper}
      const categoryName = ${JSON.stringify(actionArgument)};
      if (!categoryName) throw new Error("Pass the category name as the third argument");
      if (!document.querySelector(".template-sidebar-panel")) {
        const templatesButton = await waitFor(() => document.querySelector('button[aria-label="模板"]'));
        templatesButton.click();
      }
      const category = await waitFor(() => [...document.querySelectorAll(".category-row-main")]
        .find((button) => button.textContent?.trim() === categoryName), 20000);
      category.click();
      await waitFor(() => {
        const summary = document.querySelector(".template-list-summary");
        return summary && !summary.textContent?.includes("正在加载");
      }, 20000);
      await new Promise((resolve) => setTimeout(resolve, 300));
      return {
        category: categoryName,
        selected: category.getAttribute("aria-selected"),
        summary: document.querySelector(".template-list-summary")?.textContent?.trim(),
        templateNames: [...document.querySelectorAll(".template-list-row strong")]
          .map((node) => node.textContent?.trim())
          .filter(Boolean),
        emptyMessage: document.querySelector(".template-list-empty")?.textContent?.trim() ?? null,
      };
    })()`);
    break;

  case "import-local-templates":
    output = await evaluate(`(async () => {
      const invoke = window.__TAURI_INTERNALS__?.invoke;
      if (typeof invoke !== "function") throw new Error("Tauri invoke is unavailable");
      return await invoke("cloud_import_local_templates");
    })()`);
    break;

  case "cloud-template-stats":
    output = await evaluate(`(async () => {
      const invoke = window.__TAURI_INTERNALS__?.invoke;
      if (typeof invoke !== "function") throw new Error("Tauri invoke is unavailable");
      const base = { search: "", favoriteOnly: false, recentOnly: false, categoryId: null, sort: "manual" };
      const [files, snippets, categories] = await Promise.all([
        invoke("cloud_list_templates", { filter: { ...base, kind: "file" } }),
        invoke("cloud_list_templates", { filter: { ...base, kind: "snippet" } }),
        invoke("cloud_list_template_categories"),
      ]);
      return {
        files: files.map((item) => ({ id: item.id, name: item.name })),
        snippetCount: snippets.length,
        categoryCount: categories.length,
        total: files.length + snippets.length,
      };
    })()`);
    break;

  case "cloud-file-details":
    output = await evaluate(`(async () => {
      const invoke = window.__TAURI_INTERNALS__?.invoke;
      if (typeof invoke !== "function") throw new Error("Tauri invoke is unavailable");
      const filter = { kind: "file", search: "", favoriteOnly: false, recentOnly: false, categoryId: null, sort: "manual" };
      const files = await invoke("cloud_list_templates", { filter });
      return await Promise.all(files.map((item) => invoke("cloud_get_template", { id: item.id })));
    })()`);
    break;

  case "reload":
    await send("Page.reload", { ignoreCache: true });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    output = await evaluate(`({ text: document.body.innerText, workbench: document.querySelector(".app-shell") !== null })`);
    break;

  case "logout":
    output = await evaluate(`(async () => {
      ${waitHelper}
      const settings = await waitFor(() => document.querySelector('button[aria-label="设置"]'));
      settings.click();
      const logout = await waitFor(() => buttonWithText("退出登录"));
      logout.click();
      await waitFor(() => document.querySelector("#login-identifier"));
      return { text: document.body.innerText, loggedOut: true };
    })()`);
    break;

  default:
    throw new Error(`Unknown action: ${action}`);
}

console.log(JSON.stringify(output, null, 2));
socket.close();
