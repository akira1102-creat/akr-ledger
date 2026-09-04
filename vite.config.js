import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Installed WebAPKs remember this URL. Keep it stable even when the
        // manifest content changes; other assets remain content-hashed.
        assetFileNames: asset => asset.names.includes("manifest.json")
          ? "assets/manifest-D8D8Hmm9.json"
          : "assets/[name]-[hash][extname]",
      },
      input: {
        index: resolve(__dirname, "app.html"),
      },
    },
  },
});
