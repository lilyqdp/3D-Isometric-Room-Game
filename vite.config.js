import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    {
      name: "room-editor-save-layout",
      configureServer(server) {
        server.middlewares.use("/__editor/save-room-layout", async (req, res) => {
          if (req.method !== "POST") {
            res.statusCode = 405;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: false, error: "Method Not Allowed" }));
            return;
          }

          try {
            const chunks = [];
            for await (const chunk of req) chunks.push(Buffer.from(chunk));
            const rawBody = Buffer.concat(chunks).toString("utf8");
            const parsed = JSON.parse(rawBody || "{}");
            const jsonText =
              typeof parsed?.json === "string" && parsed.json.trim().length > 0 ? parsed.json : null;
            if (!jsonText) {
              res.statusCode = 400;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ ok: false, error: "Missing json payload" }));
              return;
            }

            const targetPath = resolve(process.cwd(), "public/mvp/room-layout.json");
            await writeFile(targetPath, jsonText, "utf8");

            res.statusCode = 200;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: true, path: "public/mvp/room-layout.json" }));
          } catch (error) {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(
              JSON.stringify({
                ok: false,
                error: error?.message || "Failed to save room layout",
              })
            );
          }
        });
        server.middlewares.use("/__editor/save-default-room-layout", async (req, res) => {
          if (req.method !== "POST") {
            res.statusCode = 405;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: false, error: "Method Not Allowed" }));
            return;
          }

          try {
            const chunks = [];
            for await (const chunk of req) chunks.push(Buffer.from(chunk));
            const rawBody = Buffer.concat(chunks).toString("utf8");
            const parsed = JSON.parse(rawBody || "{}");
            const jsonText =
              typeof parsed?.json === "string" && parsed.json.trim().length > 0 ? parsed.json : null;
            if (!jsonText) {
              res.statusCode = 400;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ ok: false, error: "Missing json payload" }));
              return;
            }

            const targetPath = resolve(process.cwd(), "public/mvp/default-room-layout.json");
            await writeFile(targetPath, jsonText, "utf8");

            res.statusCode = 200;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: true, path: "public/mvp/default-room-layout.json" }));
          } catch (error) {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(
              JSON.stringify({
                ok: false,
                error: error?.message || "Failed to save default room layout",
              })
            );
          }
        });
      },
    },
  ],
  build: {
    rollupOptions: {
      input: {
        main: resolve(process.cwd(), "index.html"),
        roomEditor: resolve(process.cwd(), "room-editor.html"),
      },
    },
  },
  optimizeDeps: {
    // Recast's wasm bootstrap can fail when pre-bundled by Vite.
    exclude: ["recast-navigation", "@recast-navigation/core", "@recast-navigation/three"],
  },
});
