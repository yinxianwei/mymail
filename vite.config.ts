import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";
export default defineConfig(({ command }) => ({
  html: {
    cspNonce: command === "serve" ? "mygo-local-development" : undefined,
  },
  base: "./",
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "development-csp-nonce",
      transformIndexHtml(html) {
        // Vite injects a React refresh preamble only during local development.
        return command === "serve"
          ? html.replace(
              "script-src 'self';",
              "script-src 'self' 'nonce-mygo-local-development';",
            )
          : html;
      },
    },
  ],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    port: 5173,
    strictPort: true,
    // DMG staging contains an Applications symlink; never watch build output.
    watch: { ignored: ["**/build/**", "**/dist/**"] },
  },
}));
