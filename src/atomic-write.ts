import { randomBytes } from "node:crypto";
import { renameSync, rmSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { debug } from "@actions/core";

/**
 * Generates an 8-character base36 string from 6 random bytes.
 * 6 bytes (48 bits) ensures we have enough entropy to fill 8 characters.
 */
const getTempExt = () => {
  const bytes = randomBytes(6);
  // Convert Buffer to a BigInt, then to base36
  const id = BigInt(`0x${bytes.toString("hex")}`).toString(36);
  return `.tmp.${id.slice(0, 8)}`;
};

function writeDebug(operation: string, key: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  debug(`atomic-write: ${operation} failed for key "${key}": ${message}`);
}

export function atomicWriteFileSync(path: string, value: string): void {
  const tmpPath = `${path}${getTempExt()}`;
  const tmpFilename = basename(tmpPath);

  try {
    writeFileSync(tmpPath, value, "utf8");
    renameSync(tmpPath, path);
  } catch (error) {
    try {
      rmSync(tmpPath, { force: true });
    } catch (e) {
      writeDebug("cleanup", tmpFilename, e);
    }
    throw error;
  }
}
