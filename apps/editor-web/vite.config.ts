import {defineConfig, type Plugin} from "vite";
import {fileURLToPath} from "node:url";
import {createGzipStaticMiddleware} from "./src/compress-static.js";
import {aiChatDevProxy} from "./src/ai-chat-dev-proxy.js";

function gzipPublicAssets(): Plugin {
  const publicDir = fileURLToPath(new URL("./public", import.meta.url));
  const middleware = createGzipStaticMiddleware(publicDir);
  return {
    name: "blocksync-gzip-public-assets",
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}

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
    plugins: [gzipPublicAssets(), aiChatDevProxy()],
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
