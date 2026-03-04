import * as openpgp from "openpgp";
import { request } from "./utils.js";
import { getSigningKey } from "./signing-key.js";

/**
 * Fetches the clearsigned manifest (.asc) and returns the verified text content.
 */
export async function getVerifiedManifest(downloadUrl: string, token?: string): Promise<string> {
  const ascUrl = `${downloadUrl}.asc`;
  const res = await request(ascUrl, {
    headers: token ? { "Authorization": `Bearer ${token}` } : {}
  });
  const cleartextMessage = await res.text();

  const [publicKey, message] = await Promise.all([
    getSigningKey(),
    openpgp.readCleartextMessage({ cleartextMessage })
  ]);

  const verification = await openpgp.verify({
    message,
    verificationKeys: publicKey
  });

  const { verified, data } = verification.signatures;

  try {
    // This performs the actual cryptographic check
    await verified;
  } catch (err: unknown) {
    throw new Error(`PGP Signature verification failed for ${ascUrl}: ${(err as Error).message}`);
  }

  return data as string;
}
