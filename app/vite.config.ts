import { defineConfig } from "vite";

/**
 * Vite configuration for the robotalk simulator.
 *
 * The browser calls the parser at the same origin under `/parse`; Vite proxies
 * that path to the FastAPI backend on port 8000. This keeps the OpenAI key on
 * the server and avoids any CORS handling in the browser.
 */
export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      "/parse": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
      "/health": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
});
