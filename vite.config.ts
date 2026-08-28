import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [svelte()],
  clearScreen: false,
  build: {
    // The intentionally unified CodeMirror/Lezer chunk is about 517 kB.
    // Keep warnings useful for unexpected growth without flagging that known-safe bundle.
    chunkSizeWarningLimit: 550,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              // CodeMirror and Lezer contain package-level cycles. Keep them in
              // one chunk so WebView2 never observes a half-initialized class.
              name: "codemirror",
              test: /node_modules[\\/](@codemirror|@lezer)[\\/]/,
              priority: 10,
            },
          ],
        },
      },
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});

