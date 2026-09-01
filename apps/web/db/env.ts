import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * `.env.local` for the db scripts. They run under tsx, not Next, so nothing
 * has read the file for them. A variable already in the environment wins
 * over the file, the way Next treats it; on Vercel there is no file at all
 * and the project settings are the environment.
 */
export function loadLocalEnv(): void {
  const file = resolve(import.meta.dirname, "..", ".env.local");
  if (existsSync(file)) process.loadEnvFile(file);
}
