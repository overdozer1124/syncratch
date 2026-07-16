import { createAssetFsStore } from "./index.ts";

const [root, sha256, bytesJson] = process.argv.slice(2);
if (!root || !sha256 || !bytesJson) {
  throw new Error("usage: concurrent-put-child <root> <sha256> <bytes-json>");
}

const bytes = new Uint8Array(JSON.parse(bytesJson) as number[]);
const result = createAssetFsStore(root).putIfAbsent(sha256, bytes);
process.stdout.write(JSON.stringify(result));
