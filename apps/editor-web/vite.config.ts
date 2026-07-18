import {defineConfig} from "vite";
import {fileURLToPath} from "node:url";

export default defineConfig({
  server: {
    host: "127.0.0.1",
    port: 4173,
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
  },
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        "collab-harness": fileURLToPath(new URL("./collab-harness.html", import.meta.url)),
      },
    },
  },
});
