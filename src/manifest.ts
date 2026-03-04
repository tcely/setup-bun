import * as openpgp from "openpgp";
import { info, error } from "@actions/core";
import { request } from "./utils.js";
import { getSigningKey } from "./signing-key.js";

/**
 * Fetches the clearsigned manifest (.asc) and returns the verified text content.
 */
export async function getVerifiedManifest(downloadUrl: string, token?: string): Promise<string> {
  const ascUrl = `${downloadUrl}.asc`;
  const parsedUrl = new URL(ascUrl);
  
  /**
   * Scoping the token to github.com prevents leaking credentials to 
   * third-party servers while allowing for higher rate limits and 
   * access to private repositories.
   */
  const isGitHub = "github.com" === parsedUrl.hostname;

  const res = await request(ascUrl, {
    headers: (isGitHub && token) ? { "Authorization": `token ${token}` } : {}
  });
  
  const armoredSignedMessage = await res.text();

  /**
   * We run these in parallel to avoid "waterfalling" the async work:
   * 1. getSigningKey: Resolves/validates the 'robobun' public key from storage or pool.
   * 2. readCleartextMessage: Parses the raw string into an OpenPGP message object.
   */
  const [publicKey, message] = await Promise.all([
    getSigningKey(token),
    openpgp.readCleartextMessage({ cleartextMessage: armoredSignedMessage })
  ]);

  const fingerprint = publicKey.getFingerprint().toUpperCase();

  /**
   * 'verification' holds a result object that includes the unverified data
   * and an array of signature metadata. The actual validity of the bytes
   * hasn't been checked yet.
   */
  const verification = await openpgp.verify({
    message,
    verificationKeys: publicKey
  });

  /**
   * Filter for the signature that matches our trusted robobun fingerprint.
   * This ensures we aren't misled by other signatures that might be present.
   */
  const signature = verification.signatures.find(sig => 
    fingerprint === sig.signingKey.getFingerprint().toUpperCase()
  );

  if (!signature) {
    throw new Error(`No PGP signatures from ${fingerprint} found in ${ascUrl}`);
  }

  /**
   * Log the signature details immediately. This allows us to see the 
   * identity claims before the cryptographic verification is attempted.
   */
  info("Checking PGP signature...");
  info(`- Signed On: ${signature.getCreationTime()?.toISOString() || "Unknown"}`);
  info(`- Key ID: ${signature.keyID.toHex().toLowerCase()}`);
  info(`- Fingerprint: ${fingerprint}\n`);

  const { verified, data } = signature;

  try {
    /**
     * MUST await 'verified' to perform the cryptographic check. 
     * If the signature is invalid or tampered with, this throws.
     */
    await verified;
    info("Signature verified successfully.");
  } catch (err: unknown) {
    const message = (err as Error).message;
    error(`PGP Signature verification failed: ${message}`);
    throw new Error(`PGP Signature verification failed for ${ascUrl}: ${message}`);
  }

  /**
   * 'data' is the trusted text content (the clear text)
   * extracted from the PGP signature wrapper.
   */
  return data as string;
}
