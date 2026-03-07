import { defineConfig } from "vite";

export default defineConfig({
  optimizeDeps: {
    // Recast's wasm bootstrap can fail when pre-bundled by Vite.
    exclude: ["recast-navigation", "@recast-navigation/core", "@recast-navigation/three"],
  },
});
