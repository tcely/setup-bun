import { createHash } from "node:crypto";
import { readFileSync, unlinkSync } from "node:fs";
import { info, warning } from "@actions/core";
import {
  fetchAssetMetadata,
  getHexFromDigest,
  GITHUB_DIGEST_THRESHOLD,
} from "./github-asset";
import { getVerifiedManifest } from "./manifest";
import { getGitHubManifestUrl } from "./url";

/**
 * Orchestrates the full integrity check:
 * Local Hash -> GitHub API Digest (if available) -> PGP Manifest.
 *
 * Unlinks (deletes) the zipPath if any digest comparison fails to prevent
 * processing of untrusted binaries.
 */
export async function verifyAsset(
  zipPath: string,
  downloadUrl: string,
  token?: string,
): Promise<void> {
  /**
   * 1. Establish the Local Baseline.
   * We hash the file immediately after download. If this doesn't match
   * subsequent checks, the file on disk is either corrupted or tampered with.
   */
  const fileBuffer = readFileSync(zipPath);
  const actualHash = createHash("sha256")
    .update(fileBuffer)
    .digest("hex")
    .toLowerCase();

  /**
   * 2. Fetch Metadata and check GitHub API Digest.
   * Retrieves the specific upload date and GitHub's infrastructure checksum.
   */
  const metadata = await fetchAssetMetadata(downloadUrl, token);

  /**
   * GitHub began providing immutable 'digests' for release assets in June 2025.
   * For assets updated after our threshold, we cross-reference our local hash
   * with GitHub's infrastructure hash.
   */
  if (metadata.updated_at >= GITHUB_DIGEST_THRESHOLD) {
    info(`Verifying via asset metadata: ${metadata.name}`);
    if (metadata.digest) {
      const githubHash = getHexFromDigest(metadata.digest);
      if (githubHash !== actualHash) {
        unlinkSync(zipPath);
        throw new Error(
          `Security Mismatch: GitHub API digest (${githubHash}) differs from local hash (${actualHash})!`,
        );
      }
      info(`GitHub API digest matched! (${metadata.digest})`);
    } else {
      warning(
        `GitHub digest missing for asset updated on ${metadata.updated_at.toISOString()}`,
      );
    }
  }

  /**
   * 3. Fetch and Verify Mandatory PGP Manifest.
   * Even if the GitHub API check passes, we MUST verify the file against the
   * developer's (robobun) signed manifest to ensure end-to-end authenticity.
   */
  const manifestBaseUrl = getGitHubManifestUrl(
    metadata.owner,
    metadata.repo,
    metadata.tag,
    "SHASUMS256.txt",
  );
  const verifiedText = await getVerifiedManifest(manifestBaseUrl, token);

  /**
   * Find the specific hash for this asset filename within the verified
   * cleartext of the SHASUMS256.txt file.
   */
  const manifestMatch = verifiedText
    .split(/\r?\n/)
    .find((line) => line.includes(metadata.name))
    ?.match(/^([a-f0-9]+) [* ]/i);

  if (!manifestMatch) {
    unlinkSync(zipPath);
    throw new Error(
      `No verified hash found for ${metadata.name} in the signed manifest.`,
    );
  }

  /**
   * index [1] contains the first capture group (the 64-char hex string)
   */
  const manifestHash = manifestMatch[1].toLowerCase();

  /**
   * Final cross-check: The local file hash must exactly match the
   * hash that was cryptographically signed by robobun.
   */
  if (actualHash !== manifestHash) {
    unlinkSync(zipPath);
    throw new Error(
      `Integrity Failure: Local hash (${actualHash}) does not match manifest (${manifestHash})`,
    );
  }

  info(`Successfully verified ${metadata.name} (PGP + SHA256)`);
}
