import { serve } from "@hono/node-server";
import { bootstrapPersistRuntime } from "@blocksync/r1-persist-server/bootstrap";

const dataDir = process.env.R1_DATA_DIR;
if (!dataDir) {
  console.error("R1_DATA_DIR required");
  process.exit(1);
}
const port = Number(process.env.PORT ?? "0");

const { app, close } = bootstrapPersistRuntime(dataDir);

const server = serve({ fetch: app.fetch, port }, (info) => {
  process.stdout.write(`READY ${info.port}\n`);
});

const shutdown = () => {
  try {
    close();
  } catch {
    // ignore
  }
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

void server;
