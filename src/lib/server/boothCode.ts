import "server-only";
import { randomBytes } from "node:crypto";

export const JOIN_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const PREFIX_LETTERS = "ABCDEFGHJKMNPQRSTUVWXYZ";

const PREFIX_LEN = 4;
const SUFFIX_LEN = 3;

function randomChars(n: number, alphabet: string): string {
  const limit = Math.floor(256 / alphabet.length) * alphabet.length;
  let out = "";
  while (out.length < n) {
    for (const byte of randomBytes((n - out.length) * 2)) {
      if (byte >= limit) continue;
      out += alphabet[byte % alphabet.length];
      if (out.length === n) break;
    }
  }
  return out;
}

function namePrefix(name: string): string {
  const letters = name
    .toUpperCase()
    .replace(/[^A-Z]/g, "")
    .slice(0, PREFIX_LEN);
  return letters.length === PREFIX_LEN
    ? letters
    : letters + randomChars(PREFIX_LEN - letters.length, PREFIX_LETTERS);
}

export function generateJoinCode(name: string): string {
  return `${namePrefix(name)}-${randomChars(SUFFIX_LEN, JOIN_CODE_ALPHABET)}`;
}
