import {defineConfig, type Connect, type Plugin} from "vite";
import {fileURLToPath} from "node:url";
import {createGzipStaticMiddleware} from "./src/compress-static.js";

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

/**
 * Dev-only AI chat proxy. Must not statically import `@blocksync/ai-assist`
 * (TypeScript workspace package) — Vite config evaluation runs under Node ESM
 * and cannot resolve its `.js` → `.ts` import specifiers. Load via ssrLoadModule.
 * Preview/production use collab-host `POST /ai/chat` instead.
 */
function aiChatDevProxy(): Plugin {
  return {
    name: "blocksync-ai-chat-dev-proxy",
    configureServer(server) {
      let middleware: Connect.NextHandleFunction | undefined;
      server.middlewares.use((req, res, next) => {
        void (async () => {
          try {
            if (!middleware) {
              const mod = (await server.ssrLoadModule(
                "/src/ai-chat-dev-proxy.ts",
              )) as {
                createAiChatDevMiddleware: () => Connect.NextHandleFunction;
              };
              middleware = mod.createAiChatDevMiddleware();
            }
            middleware(req, res, next);
          } catch (error) {
            next(error instanceof Error ? error : new Error(String(error)));
          }
        })();
      });
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
