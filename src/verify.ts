import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { info, warning } from "@actions/core";
import { 
  fetchAssetMetadata, 
  getHexFromDigest, 
  GITHUB_DIGEST_THRESHOLD 
} from "./github-asset.js";
import { getVerifiedManifest } from "./manifest.js";
import { getGitHubManifestUrl } from "./url.js";

/**
 * Orchestrates the full integrity check: 
 * Local Hash -> GitHub API Digest (if available) -> PGP Manifest.
 */
export async function verifyAsset(zipPath: string, downloadUrl: string, token?: string): Promise<void> {
  // 1. Calculate local hash baseline first
  const fileBuffer = readFileSync(zipPath);
  const actualHash = createHash("sha256").update(fileBuffer).digest("hex").toLowerCase();

  // 2. Fetch Metadata and check GitHub API Digest
  const metadata = await fetchAssetMetadata(downloadUrl, token);

  if (metadata.updated_at >= GITHUB_DIGEST_THRESHOLD) {
    if (metadata.digest) {
      const githubHash = getHexFromDigest(metadata.digest);
      if (githubHash !== actualHash) {
        throw new Error(`Security Mismatch: GitHub API digest (${githubHash}) differs from local hash (${actualHash})!`);
      }
      info(`Verified ${metadata.name} against GitHub API digest.`);
    } else {
      warning(`GitHub digest missing for asset updated on ${metadata.updated_at.toISOString()}`);
    }
  }

  // 3. Fetch and Verify Mandatory PGP Manifest
  const manifestBaseUrl = getGitHubManifestUrl(metadata.owner, metadata.repo, metadata.tag, "SHASUMS256.txt");
  const verifiedText = await getVerifiedManifest(manifestBaseUrl, token);

  const manifestMatch = verifiedText.split(/\r?\n/)
    .find(line => line.includes(metadata.name))
    ?.match(/^([a-f0-9]{64})/i);

  if (!manifestMatch) {
    throw new Error(`No verified hash found for ${metadata.name} in the signed manifest.`);
  }
  const manifestHash = manifestMatch[1].toLowerCase();

  // Final cross-check against PGP Manifest
  if (actualHash !== manifestHash) {
    throw new Error(`Integrity Failure: Local hash (${actualHash}) does not match manifest (${manifestHash})`);
  }

  info(`Successfully verified ${metadata.name} (PGP + SHA256)`);
}
