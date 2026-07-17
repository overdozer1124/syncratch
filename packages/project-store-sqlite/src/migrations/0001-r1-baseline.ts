import type Database from "better-sqlite3";
import {createAuthSchema} from "../migrate-auth.js";
import {createAssetSchema} from "../migrate-assets.js";
import {createProjectSchema} from "../migrate.js";
import type {SchemaMigration} from "./types.js";

export const r1BaselineChecksumSource = [
  "version=1",
  "name=r1-baseline",
  "createProjectSchema:v1",
  "createAuthSchema:v1",
  "createAssetSchema:v1-with-generation",
].join("\n");

export const r1BaselineMigration: SchemaMigration = {
  version: 1,
  name: "r1-baseline",
  checksumSource: r1BaselineChecksumSource,
  checksum: "1b5519ca38da1711db8f7b7cc6da07ff55532471ee0934fa2fe0d5e2b2153362",
  apply(db: Database.Database): void {
    createProjectSchema(db);
    createAuthSchema(db);
    createAssetSchema(db);
  },
};
