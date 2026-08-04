#!/usr/bin/env node
/**
 * Set Syncratch classroom roster env vars on Railway via GraphQL API.
 *
 * Required:
 *   RAILWAY_TOKEN — project token (Project Settings → Tokens) OR account token
 *
 * Optional (auto-discovered when using account token):
 *   RAILWAY_PROJECT_ID, RAILWAY_ENVIRONMENT_ID, RAILWAY_SERVICE_ID
 *   RAILWAY_PROJECT_NAME (default: radiant-cooperation)
 *   RAILWAY_SERVICE_NAME (default: syncratch)
 *
 * Optional overrides:
 *   GOOGLE_CLIENT_ID — default: baked into production SPA
 *   GOOGLE_CLIENT_SECRET — if unset, roster Google credential flags are still set;
 *     Sheet sync needs this already present on the service
 *   SYNCRATCH_ADMIN_EMAILS — if unset, existing Railway value is preserved
 *   SYNCRATCH_ADMIN_GOOGLE_ACTIVE_KEY_ID — default: main
 *   SYNCRATCH_ADMIN_GOOGLE_KEY_B64 — default: generate fresh 32-byte key
 *   SYNCRATCH_STUDENT_IDENTITY_SECRET — default: generate fresh hex secret
 *
 * Usage:
 *   RAILWAY_TOKEN=xxx node scripts/railway-set-classroom-roster-env.mjs
 *   RAILWAY_TOKEN=xxx node scripts/railway-set-classroom-roster-env.mjs --dry-run
 */
import {randomBytes} from "node:crypto";

const RAILWAY_API = "https://backboard.railway.com/graphql/v2";
const DEFAULT_GOOGLE_CLIENT_ID =
  "863099193805-9j3ov2q8fcgitjokcdhv02pvcs2qcgqi.apps.googleusercontent.com";
const DEFAULT_PROJECT_NAME = "radiant-cooperation";
const DEFAULT_SERVICE_NAME = "syncratch";

const dryRun = process.argv.includes("--dry-run");

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`Missing ${name}. Get a project token from Railway → Project → Settings → Tokens.`);
    process.exit(1);
  }
  return value;
}

async function gql(token, query, variables = {}) {
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
  const response = await fetch(RAILWAY_API, {
    method: "POST",
    headers,
    body: JSON.stringify({query, variables}),
  });
  const body = await response.json();
  if (body.errors?.length) {
    throw new Error(JSON.stringify(body.errors, null, 2));
  }
  return body.data;
}

async function discoverIds(token) {
  const projectId = process.env.RAILWAY_PROJECT_ID?.trim();
  const environmentId = process.env.RAILWAY_ENVIRONMENT_ID?.trim();
  const serviceId = process.env.RAILWAY_SERVICE_ID?.trim();
  if (projectId && environmentId && serviceId) {
    return {projectId, environmentId, serviceId};
  }

  const projectName = process.env.RAILWAY_PROJECT_NAME?.trim() || DEFAULT_PROJECT_NAME;
  const serviceName = process.env.RAILWAY_SERVICE_NAME?.trim() || DEFAULT_SERVICE_NAME;

  const data = await gql(
    token,
    `query {
      projects {
        edges {
          node {
            id
            name
            services { edges { node { id name } } }
            environments { edges { node { id name } } }
          }
        }
      }
    }`,
  );

  const projects = data.projects.edges.map(edge => edge.node);
  const project =
    projects.find(p => p.name === projectName) ??
    projects.find(p => p.name.toLowerCase().includes("syncratch")) ??
    projects[0];
  if (!project) throw new Error("No Railway project found for this token.");

  const service =
    project.services.edges.map(e => e.node).find(s => s.name === serviceName) ??
    project.services.edges[0]?.node;
  if (!service) throw new Error(`No service found in project ${project.name}.`);

  const environment =
    project.environments.edges.map(e => e.node).find(e => e.name === "production") ??
    project.environments.edges[0]?.node;
  if (!environment) throw new Error(`No environment found in project ${project.name}.`);

  console.log(`Target: project=${project.name} (${project.id})`);
  console.log(`        service=${service.name} (${service.id})`);
  console.log(`        environment=${environment.name} (${environment.id})`);

  return {
    projectId: project.id,
    environmentId: environment.id,
    serviceId: service.id,
  };
}

function buildVariables() {
  const keyId = process.env.SYNCRATCH_ADMIN_GOOGLE_ACTIVE_KEY_ID?.trim() || "main";
  const keyB64 =
    process.env.SYNCRATCH_ADMIN_GOOGLE_KEY_B64?.trim() ||
    randomBytes(32).toString("base64");
  const keysJson = JSON.stringify({[keyId]: keyB64});
  const identitySecret =
    process.env.SYNCRATCH_STUDENT_IDENTITY_SECRET?.trim() ||
    randomBytes(32).toString("hex");

  const vars = {
    GOOGLE_CLIENT_ID:
      process.env.GOOGLE_CLIENT_ID?.trim() || DEFAULT_GOOGLE_CLIENT_ID,
    SYNCRATCH_CLASSROOM_ROSTER_ENABLED: "1",
    SYNCRATCH_ADMIN_GOOGLE_CREDENTIAL_ENABLED: "1",
    SYNCRATCH_ROSTER_SHEETS_ENABLED: "1",
    SYNCRATCH_ADMIN_GOOGLE_ACTIVE_KEY_ID: keyId,
    SYNCRATCH_ADMIN_GOOGLE_KEYS_JSON: keysJson,
    SYNCRATCH_STUDENT_LOCAL_AUTH_ENABLED: "1",
    SYNCRATCH_STUDENT_IDENTITY_SECRET: identitySecret,
  };

  const adminEmails = process.env.SYNCRATCH_ADMIN_EMAILS?.trim();
  if (adminEmails) vars.SYNCRATCH_ADMIN_EMAILS = adminEmails;

  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (clientSecret) vars.GOOGLE_CLIENT_SECRET = clientSecret;

  return {vars, keyId, keyB64, identitySecret};
}

async function main() {
  const token = requireEnv("RAILWAY_TOKEN");
  const {projectId, environmentId, serviceId} = await discoverIds(token);
  const {vars, keyId, identitySecret} = buildVariables();

  console.log("\nVariables to set:");
  for (const [key, value] of Object.entries(vars)) {
    const display =
      key.includes("SECRET") || key.includes("KEYS_JSON") || key === "GOOGLE_CLIENT_SECRET"
        ? `${value.slice(0, 8)}… (${value.length} chars)`
        : value;
    console.log(`  ${key}=${display}`);
  }

  if (dryRun) {
    console.log("\nDry run — no changes applied.");
    console.log(`Generated SYNCRATCH_ADMIN_GOOGLE_ACTIVE_KEY_ID=${keyId}`);
    console.log(`Generated SYNCRATCH_STUDENT_IDENTITY_SECRET=${identitySecret}`);
    return;
  }

  await gql(
    token,
    `mutation variableCollectionUpsert($input: VariableCollectionUpsertInput!) {
      variableCollectionUpsert(input: $input)
    }`,
    {
      input: {
        projectId,
        environmentId,
        serviceId,
        variables: vars,
        skipDeploys: false,
      },
    },
  );

  console.log("\nRailway variables updated. Redeploy triggered.");
  console.log("After deploy, open https://syncratch-production.up.railway.app/admin");
  console.log("Ensure Google Cloud redirect URI includes:");
  console.log("  https://syncratch-production.up.railway.app/oauth/admin-google/callback");
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
