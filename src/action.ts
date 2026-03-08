import {
  mkdirSync,
  readdirSync,
  symlinkSync,
  renameSync,
  existsSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { cwd } from "node:process";
import { isFeatureAvailable, restoreCache } from "@actions/cache";
import { addPath, saveState, info, warning } from "@actions/core";
import { writeBunfig } from "./bunfig";
import { getDownloadUrl } from "./download-url";
import { Registry } from "./registry";
import {
  downloadBun,
  exe,
  extractVersionFromUrl,
  getCacheKey,
  isVersionMatch,
} from "./utils";

export type Input = {
  customUrl?: string;
  version?: string;
  os?: string;
  arch?: string;
  avx2?: boolean;
  profile?: boolean;
  registries?: Registry[];
  noCache?: boolean;
  token?: string;
};

export type Output = {
  version: string;
  revision: string;
  bunPath: string;
  url: string;
  checksum?: string;
  cacheHit: boolean;
};

export type CacheState = {
  cacheEnabled: boolean;
  cacheHit: boolean;
  bunPath: string;
  url: string;
  checksum?: string;
  revision?: string;
};

export default async (options: Input): Promise<Output> => {
  const bunfigPath = join(cwd(), "bunfig.toml");
  writeBunfig(bunfigPath, options.registries);

  const url = await getDownloadUrl(options);
  const cacheEnabled = isCacheEnabled(options);

  const binPath = join(homedir(), ".bun", "bin");
  try {
    mkdirSync(binPath, { recursive: true });
  } catch (error) {
    if ("EEXIST" !== error.code) {
      throw error;
    }
  }
  addPath(binPath);

  const bunPath = join(binPath, exe("bun"));
  try {
    symlinkSync(bunPath, join(binPath, exe("bunx")));
  } catch (error) {
    if ("EEXIST" !== error.code) {
      throw error;
    }
  }

  let checksum: string | undefined;
  let revision: string | undefined;
  let cacheHit = false;

  const cacheState: CacheState = {
    cacheEnabled,
    cacheHit,
    bunPath,
    url,
    checksum,
    revision,
  };

  const cacheKey = getCacheKey(url);
  const statePath = `${bunPath}.json`;
  const cachePaths = [bunPath, statePath];
  if (cacheEnabled) {
    if (existsSync(statePath)) {
      try {
        const state = JSON.parse(readFileSync(statePath, "utf8")) as CacheState;
        if (state.url === url && "string" === typeof state.checksum) {
          checksum = state.checksum;
        }
        if (state.url === url && "string" === typeof state.revision) {
          cacheState.revision = state.revision;
        }
      } catch {
        warning(`Ignoring cached checksum metadata from ${statePath}`);
      }
      if (checksum) {
        cacheState.cacheHit = true;
        cacheState.checksum = checksum;
      }
    }
  }

  // Check if Bun executable already exists and matches requested version
  if (!options.customUrl && cacheState.revision && existsSync(bunPath)) {
    if (isVersionMatch(cacheState.revision, options.version)) {
      revision = cacheState.revision;
      cacheHit = cacheState.cacheHit; // Treat as cache hit to avoid unnecessary network requests
      info(`Using existing Bun installation: ${revision}`);
    }
  }

  if (!revision) {
    if (cacheEnabled) {
      const cacheRestored = await restoreCache(cachePaths, cacheKey);
      if (cacheRestored) {
        if (existsSync(statePath)) {
          try {
            const state = JSON.parse(
              readFileSync(statePath, "utf8"),
            ) as CacheState;
            if (state.url === url && "string" === typeof state.checksum) {
              checksum = state.checksum;
              cacheState.checksum = checksum;
            }
            if (state.url === url && "string" === typeof state.revision) {
              revision = state.revision;
              cacheState.revision = revision;
            }
          } catch {
            warning(`Ignoring cached checksum metadata from ${statePath}`);
          }
        }

        if (revision) {
          const expectedVersion = extractVersionFromUrl(url);
          const [actualVersion] = revision.split("+");
          if (!expectedVersion) {
            warning(
              `Could not parse expected version from URL: ${url}. Ignoring cache.`,
            );
            revision = undefined;
          } else if (actualVersion !== expectedVersion) {
            warning(
              `Cached Bun version ${revision} does not match expected version ${expectedVersion}. Re-downloading.`,
            );
            revision = undefined;
          } else if (cacheState.checksum) {
            cacheHit = true;
            cacheState.cacheHit = cacheHit;
            info(`Using a cached version of Bun: ${revision}`);
          }
        } else {
          warning(
            `Found a Bun binary (with an unknown version) at: ${bunPath}`,
          );
        }
      }
    }
  }

  if (!cacheHit) {
    info(`Downloading a new version of Bun: ${url}`);
    const result = await downloadBun(url, bunPath, options.token);
    checksum = result.checksum;
    cacheState.cacheHit = false;
    cacheState.checksum = checksum;
    revision = result.revision;
    cacheState.revision = revision;
  }

  if (!revision) {
    throw new Error(
      "Downloaded a new version of Bun, but failed to check its version? Try again.",
    );
  }

  const [version] = revision.split("+");

  cacheState.cacheHit = cacheHit;
  cacheState.checksum = checksum;
  cacheState.revision = revision;
  const stateValue = JSON.stringify(cacheState);
  if (cacheEnabled && !cacheHit) {
    writeFileSync(statePath, stateValue, "utf8");
  }
  saveState("cache", stateValue);

  return {
    version,
    revision,
    bunPath,
    url,
    checksum,
    cacheHit,
  };
};

function isCacheEnabled(options: Input): boolean {
  const { customUrl, version, noCache } = options;
  if (noCache) {
    return false;
  }
  if (customUrl) {
    return false;
  }
  if (!version || /latest|canary|action/i.test(version)) {
    return false;
  }
  return isFeatureAvailable();
}
