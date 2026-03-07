#!/usr/bin/env node

import { spawn } from "node:child_process";
import * as path from "node:path";

const args = process.argv.slice(2);
const command = args[0];

if (command !== "dev") {
  console.error(`[n-ext] Unknown command: ${command}`);
  console.error("Usage: n-ext dev [...next-args]");
  process.exit(1);
}

if (process.env.NODE_ENV === "production") {
  console.error("[n-ext] Cannot run in production mode");
  process.exit(1);
}

const registerPath = path.resolve(__dirname, "runtime", "register.js");
const existingNodeOptions = process.env.NODE_OPTIONS || "";
const nodeOptions = `--require ${registerPath} ${existingNodeOptions}`.trim();

const nextArgs = ["dev", ...args.slice(1)];
const nextBin = path.resolve(process.cwd(), "node_modules", ".bin", "next");

const child = spawn(nextBin, nextArgs, {
  stdio: "inherit",
  env: {
    ...process.env,
    NODE_OPTIONS: nodeOptions,
  },
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    child.kill(signal);
  });
}
