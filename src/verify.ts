import * as openpgp from "openpgp";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { info } from "@actions/core";
import { request } from "./utils";
import { getVksUrl, getHkpUrl, getGitHubGpgUrl, buildUrl } from "./url";

const ROBOBUN_FP = "F3DCC08A8572C0749B3E18888EAB4D40A7B22B59";
const JULY_2025 = new Date("2025-07-01");

export async function verifyBunAsset(zipPath: string, url: string, token?: string) {
  const fileName = zipPath.split(/[\\/]/).pop()!;
  
  // 1. Fetch Key (Trying OpenPGP keyserver then GitHub)
  let keyText: string;
  try {
    keyText = await (await request(getVksUrl("keys.openpgp.org", ROBOBUN_FP))).text();
  } catch {
    keyText = await (await request(getGitHubGpgUrl("robobun"))).text();
  }
  const publicKey = await openpgp.readKey({ armoredKey: keyText });

  // 2. Verify PGP Signature
  const ascText = await (await request(url + ".asc")).text();
  const verification = await openpgp.verify({
    message: await openpgp.readCleartextMessage({ cleartextMessage: ascText }),
    verificationKeys: publicKey
  });

  const sigDate = await (verification.signatures[0] as any).getCreationTime();
  const isStrict = sigDate >= JULY_2025;

  const manifestHash = (verification.data as string).split(/\r?\n/)
    .find(l => l.includes(fileName))?.match(/^([a-f0-9]{64})/i)?.[1];

  // 3. GitHub API Digest Cross-check (for releases after June 2025)
  if (isStrict) {
    const parts = new URL(url).pathname.split("/");
    const apiUrl = buildUrl("api.github.com", `/repos/${parts[1]}/${parts[2]}/releases/tags/${parts[5]}`);
    const release = await (await request(apiUrl, { 
      headers: token ? { Authorization: `token ${token}` } : {} 
    })).json();
    
    const githubDigest = release.assets.find((a: any) => a.name === fileName)?.digest;
    if (githubDigest && githubDigest.toLowerCase() !== manifestHash?.toLowerCase()) {
      throw new Error(`Security Mismatch: GitHub digest does not match signed manifest!`);
    }
  }

  // 4. Final Local File Integrity
  const actualHash = createHash("sha256").update(readFileSync(zipPath)).digest("hex");
  if (actualHash !== manifestHash) {
    throw new Error(`Integrity Failure: Local hash mismatch for ${fileName}`);
  }

  info(`Verified ${fileName} against robobun PGP signature and SHA256 digest.`);
}
