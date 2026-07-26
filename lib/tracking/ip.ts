import { createHash } from "node:crypto";

/** Salted SHA-256 of the caller IP — never log raw IPs (PDPL / D5). */
export function hashIp(ip: string): string {
  return createHash("sha256")
    .update(`${process.env.IP_HASH_SALT ?? ""}:${ip}`)
    .digest("hex");
}
