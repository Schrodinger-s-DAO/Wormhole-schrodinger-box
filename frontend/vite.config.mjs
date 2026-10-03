import path from "path";
import { fileURLToPath } from "url";
import { defineConfig } from "vite";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  base: process.env.PAGES_BASE || "/",
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    fs: { allow: [path.resolve(root, "..")] },
    proxy: {
      "/wormhole": {
        target: "https://api.testnet.wormholescan.io",
        changeOrigin: true,
        rewrite: (requestPath) => requestPath.replace(/^\/wormhole/, "")
      }
    }
  }
});
