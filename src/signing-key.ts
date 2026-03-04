import * as openpgp from "openpgp";
import { getCache, setCache } from "./filesystem-cache.js";
import { request } from "./utils.js";
import { getVksUrl, getHkpUrl, getGitHubGpgUrl } from "./url.js";

const ROBOBUN_FP = "F3DCC08A8572C0749B3E18888EAB4D40A7B22B59";
const ROBOBUN_STORAGE_KEY = `gpg-public-key-${ROBOBUN_FP}`;

/**
 * Validates the armored key and returns a clean, re-armored string.
 */
async function getCleanArmoredKey(input: string): Promise<string> {
  const key = await openpgp.readKey({ armoredKey: input });
  const actualFp = key.getFingerprint().toUpperCase();

  if (actualFp !== ROBOBUN_FP) {
    throw new Error(`Fingerprint mismatch: expected ${ROBOBUN_FP}, got ${actualFp}`);
  }

  return key.armor();
}

/**
 * Retrieves the robobun public key from the 12-hour filesystem storage or the pool.
 */
export async function getSigningKey(): Promise<openpgp.Key> {
  // 1. Check Filesystem Storage
  const storedKey = getCache(ROBOBUN_STORAGE_KEY);
  if (storedKey) {
    try {
      const cleanKey = await getCleanArmoredKey(storedKey);
      return await openpgp.readKey({ armoredKey: cleanKey });
    } catch {
      // Fall through to fetch fresh if stored data is corrupted or fingerprint changed
    }
  }

  // 2. Resolve via Pool (VKS -> HKP -> GitHub)
  const sources = [
    getVksUrl("keys.openpgp.org", ROBOBUN_FP),
    getHkpUrl("keyserver.ubuntu.com", ROBOBUN_FP),
    getGitHubGpgUrl("robobun"),
  ];

  for (const url of sources) {
    try {
      const res = await request(url);
      const rawText = await res.text();

      if (rawText.includes("-----BEGIN PGP PUBLIC KEY BLOCK-----")) {
        const cleanKey = await getCleanArmoredKey(rawText);
        
        // 3. Persist the sanitized armored block to the filesystem
        setCache(ROBOBUN_STORAGE_KEY, cleanKey);
        
        return await openpgp.readKey({ armoredKey: cleanKey });
      }
    } catch {
      continue;
    }
  }

  throw new Error(`Failed to retrieve verified public key for ${ROBOBUN_FP} from all sources.`);
}
