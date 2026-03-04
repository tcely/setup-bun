import { getCache, setCache } from "./filesystem-cache.js";

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
  if (!isMetadata(url)) return undefined;

  const data = getCache(url);
  if (data) {
    return new Response(data, {
      status: 200,
      headers: { 
        "Content-Type": "application/json",
        "X-Storage-Hit": "true" 
      }
    });
  }
  return undefined;
}

/**
 * Saves a response body string to persistent storage.
 */
export function setStoredResponse(url: string, body: string): void {
  if (isMetadata(url)) {
    setCache(url, body);
  }
}
