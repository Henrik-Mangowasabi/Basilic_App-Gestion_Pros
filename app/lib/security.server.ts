import { timingSafeEqual } from "crypto";

/**
 * Comparaison de chaînes à temps constant (anti timing-attack).
 * Retourne false si l'une des valeurs est vide.
 */
export function timingSafeStringEqual(provided: string, expected: string): boolean {
  if (!provided || !expected) return false;
  try {
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
