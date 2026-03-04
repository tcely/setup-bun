import { getCache, setCache } from "./filesystem-cache";

/**
 * Determines if the URL is metadata eligible for storage (e.g., GitHub API).
 */
function isMetadata(url: string): boolean {
  return url.includes("api.github.com");
}

/**
 * Retrieves a stored Response from the filesystem if available.
 */
export function getStoredResponse(url: string): Response | undefined {
  if (!isMetadata(url)) {
    return undefined;
  }

  const data = getCache(url);
  if (data) {
    return new Response(data, {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "X-Storage-Hit": "true",
      },
    });
  }
  return undefined;
}

/**
 * Clones the response and persists its body to storage.
 */
export async function setStoredResponse(
  url: string,
  res: Response,
): Promise<void> {
  if (!isMetadata(url) || !res.ok) {
    return;
  }

  try {
    // We clone so the original stream remains readable by the caller
    const body = await res.clone().text();
    setCache(url, body);
  } catch {
    // Fail silently to avoid breaking the main execution flow
  }
}
