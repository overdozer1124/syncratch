import {defineConfig} from "vite";
import {fileURLToPath} from "node:url";

export default defineConfig(({mode}) => {
  const input: Record<string, string> = {
    main: fileURLToPath(new URL("./index.html", import.meta.url)),
  };
  if (mode === "e2e") {
    input["collab-harness"] = fileURLToPath(
      new URL("./collab-harness.html", import.meta.url),
    );
  }
  return {
    base: process.env.BLOCKSYNC_BASE_PATH?.trim() || "/",
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
        input,
      },
    },
  };
});
