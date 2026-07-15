import { join } from "node:path";
import { serve } from "@hono/node-server";
import { bootstrapPersistRuntime } from "./bootstrap.js";

const dataDir = process.env.R1_DATA_DIR ?? join(process.cwd(), "data");
const port = Number(process.env.PORT ?? "8787");
const { app } = bootstrapPersistRuntime(dataDir);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`r1-persist-server listening on ${info.port} data=${dataDir}`);
});
