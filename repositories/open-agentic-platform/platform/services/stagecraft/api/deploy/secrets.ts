import fs from "node:fs/promises";
import path from "node:path";

const SECRETS_DIR = process.env.SECRETS_DIR ?? "";

/**
 * Read secret from CSI mount (file-based) or return null.
 * Used when running in K8s with Azure Key Vault CSI driver.
 */
export async function readSecretFromDir(name: string): Promise<string | null> {
  if (!SECRETS_DIR) return null;
  const p = path.join(SECRETS_DIR, name);
  try {
    return (await fs.readFile(p, "utf8")).trim();
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return null;
    throw err;
  }
}
