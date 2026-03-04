import { URL } from "node:url";
import { buildUrl } from "./url";
import { request } from "./utils";

/**
 * The date GitHub began providing mandatory digests for all release assets.
 */
export const GITHUB_DIGEST_THRESHOLD = new Date("2025-07-01");

/** 
 * Maps known GitHub digest algorithms to their expected hex lengths.
 */
const DIGEST_CONFIG = {
  sha256: 64,
  sha512: 128
} as const;

type DigestAlgorithm = keyof typeof DIGEST_CONFIG;

/** 
 * Represents a GitHub digest string in the format "algorithm:hex"
 */
export type GitHubDigest = `${DigestAlgorithm}:${string}`;

/**
 * Metadata extracted solely from the Download URL.
 */
export interface UrlAssetMetadata {
  owner: string;
  repo: string;
  tag: string;
  name: string;
}

/**
 * Complete metadata retrieved from the GitHub API.
 */
export interface AssetMetadata extends UrlAssetMetadata {
  digest?: GitHubDigest;
  updated_at: Date;
}

/**
 * Validates the algorithm and hex length, returning the clean hex string.
 */
export function getHexFromDigest(digest: GitHubDigest): string {
  const [algorithm, hex] = digest.toLowerCase().split(":");
  const expectedLength = DIGEST_CONFIG[algorithm as DigestAlgorithm];

  if (!expectedLength) {
    throw new Error(`Unsupported digest algorithm: ${algorithm}`);
  }

  if (hex.length !== expectedLength || !/^[a-f0-9]+$/.test(hex)) {
    throw new Error(`Invalid ${algorithm} hex format. Expected ${expectedLength} chars, got ${hex.length}`);
  }

  return hex;
}

/**
 * Decomposes a GitHub download URL into metadata components.
 * Pattern: https://github.com/{owner}/{repo}/releases/download/{tag}/{filename}
 */
export function parseAssetUrl(downloadUrl: string): UrlAssetMetadata {
  const url = new URL(downloadUrl);
  // Remove leading slash so index 0 is 'owner'
  const parts = url.pathname.slice(1).split("/");
  
  const owner = parts[0];
  const repo = parts[1];
  const tag = parts[4];
  const name = parts[5];

  if (!owner || !repo || !tag || !name) {
    throw new Error(`Failed to parse GitHub asset metadata from: ${downloadUrl}`);
  }

  return { owner, repo, tag, name };
}

/**
 * Enriches asset metadata with the official GitHub 'digest' and 'updated_at' from the API.
 */
export async function fetchAssetMetadata(
  downloadUrl: string, 
  token?: string
): Promise<AssetMetadata> {
  const base = parseAssetUrl(downloadUrl);
  
  // Use buildUrl for the API request: /repos/{owner}/{repo}/releases/tags/{tag}
  const apiUrl = buildUrl(
    "api.github.com", 
    `/repos/${base.owner}/${base.repo}/releases/tags/${base.tag}`
  );
  
  const response = await request(apiUrl, {
    headers: {
      "Accept": "application/vnd.github+json",
      ...(token ? { "Authorization": `Bearer ${token}` } : {})
    }
  });

  const release = await response.json();
  const asset = release.assets?.find((a: any) => a.name === base.name);

  if (!asset) {
    throw new Error(`Asset ${base.name} not found in release ${base.tag}`);
  }

  return {
    ...base,
    digest: asset.digest as GitHubDigest | undefined,
    updated_at: new Date(asset.updated_at)
  };
}
