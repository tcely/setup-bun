import { URL } from "node:url";
import { buildUrl } from "./url.js";
import { request } from "./utils.js";

/**
 * Interface representing GitHub release asset metadata.
 * The 'digest' (sha256:deadbeef...) is provided by GitHub for assets uploaded after July 2025.
 */
export interface AssetMetadata {
  owner: string;
  repo: string;
  tag: string;
  name: string;
  digest?: string;
}

/**
 * Decomposes a GitHub download URL into metadata components.
 * Pattern: https://github.com/{owner}/{repo}/releases/download/{tag}/{filename}
 */
export function parseAssetUrl(downloadUrl: string): AssetMetadata {
  const url = new URL(downloadUrl);
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
 * Enriches asset metadata with the official GitHub 'digest' from the API.
 */
export async function fetchAssetMetadata(
  downloadUrl: string, 
  token?: string
): Promise<AssetMetadata> {
  const meta = parseAssetUrl(downloadUrl);
  
  // Use buildUrl for the API request
  const apiUrl = buildUrl(
    "api.github.com", 
    `/repos/${meta.owner}/${meta.repo}/releases/tags/${meta.tag}`
  );
  
  const response = await request(apiUrl, {
    headers: {
      "Accept": "application/vnd.github+json",
      ...(token ? { "Authorization": `Bearer ${token}` } : {})
    }
  });

  const release = await response.json();
  const asset = release.assets?.find((a: any) => a.name === meta.name);

  return {
    ...meta,
    digest: asset?.digest
  };
}
