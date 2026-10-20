import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

export function createMinimapExtension() {
  return ViewPlugin.fromClass(class {
    canvas = document.createElement("canvas");
    frame = 0;
    observer: ResizeObserver;
    constructor(readonly view: EditorView) {
      this.canvas.className = "cm-classic-minimap";
      this.canvas.setAttribute("role", "slider");
      this.canvas.setAttribute("aria-label", "代码缩略图，点击或使用上下键跳转");
      this.canvas.setAttribute("aria-valuemin", "1");
      this.canvas.tabIndex = 0;
      this.canvas.addEventListener("pointerdown", this.navigate);
      this.canvas.addEventListener("keydown", this.keydown);
      view.dom.classList.add("cm-with-minimap");
      view.dom.append(this.canvas);
      this.observer = new ResizeObserver(() => this.schedule());
      this.observer.observe(view.dom);
      this.schedule();
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged || update.geometryChanged || update.selectionSet) this.schedule();
    }
    schedule() {
      cancelAnimationFrame(this.frame);
      this.frame = requestAnimationFrame(() => this.draw());
    }
    draw() {
      const width = 76, height = Math.max(1, this.view.dom.clientHeight);
      const scale = window.devicePixelRatio || 1;
      this.canvas.width = width * scale; this.canvas.height = height * scale;
      const context = this.canvas.getContext("2d");
      if (!context) return;
      context.scale(scale, scale);
      const doc = this.view.state.doc;
      const rows = Math.min(doc.lines, Math.floor(height / 3));
      const lineHeight = Math.min(3, height / doc.lines);
      const light = document.documentElement.dataset.theme === "light";
      context.font = "2px Consolas, monospace";
      for (let row = 0; row < rows; row++) {
        const number = rows < doc.lines ? Math.floor(row * doc.lines / rows) + 1 : row + 1;
        const text = doc.line(number).text.slice(0, 95);
        context.fillStyle = /^\s*\/\//.test(text) ? (light ? "#44753b" : "#709857") : (light ? "#666d81" : "#9dabc4");
        context.fillText(text, 4, rows < doc.lines ? row * 3 + 3 : row * lineHeight + 3);
      }
      const first = doc.lineAt(this.view.viewport.from).number;
      const last = doc.lineAt(this.view.viewport.to).number;
      const totalHeight = rows < doc.lines ? rows * 3 : doc.lines * lineHeight;
      context.fillStyle = light ? "#007acc22" : "#ffffff14";
      context.fillRect(0, (first - 1) / doc.lines * totalHeight, width, Math.max(10, (last - first + 1) / doc.lines * totalHeight));
      this.canvas.setAttribute("aria-valuemax", String(doc.lines));
      this.canvas.setAttribute("aria-valuenow", String(doc.lineAt(this.view.state.selection.main.head).number));
    }
    jump(line: number) {
      const target = this.view.state.doc.line(Math.max(1, Math.min(this.view.state.doc.lines, line)));
      this.view.dispatch({ selection: { anchor: target.from }, effects: EditorView.scrollIntoView(target.from, { y: "center" }) });
    }
    navigate = (event: PointerEvent) => {
      const height = Math.min(this.canvas.clientHeight, this.view.state.doc.lines * 3);
      this.jump(Math.floor((event.clientY - this.canvas.getBoundingClientRect().top) / Math.max(1, height) * this.view.state.doc.lines) + 1);
    };
    keydown = (event: KeyboardEvent) => {
      const current = this.view.state.doc.lineAt(this.view.state.selection.main.head).number;
      const deltas: Record<string, number> = { ArrowUp: -1, ArrowDown: 1, PageUp: -25, PageDown: 25 };
      const delta = deltas[event.key];
      if (delta === undefined && event.key !== "Home" && event.key !== "End") return;
      event.preventDefault();
      this.jump(event.key === "Home" ? 1 : event.key === "End" ? this.view.state.doc.lines : current + (delta ?? 0));
    };
    destroy() {
      cancelAnimationFrame(this.frame); this.observer.disconnect();
      this.canvas.remove(); this.view.dom.classList.remove("cm-with-minimap");
    }
  });
}
