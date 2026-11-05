import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";

/**
 * Paramètres scrypt : N = 2^14, r = 8, p = 5, l'équivalent recommandé par l'OWASP de N = 2^17, p = 1 pour 16 Mio de
 * mémoire par calcul au lieu de 128 Mio (l'instance Render a 512 Mo). Ils sont écrits dans le hash : un hash plus ancien
 * se vérifie toujours, et il est recalculé avec les paramètres actuels à la connexion suivante (needsRehash).
 */
const PARAMS = { N: 2 ** 14, r: 8, p: 5 } as const;
const LEGACY = { N: 2 ** 14, r: 8, p: 1 } as const; // ancien format scrypt$<sel>$<hash>, paramètres par défaut de Node
const KEYLEN = 64;

type Params = { N: number; r: number; p: number };
const scrypt = (pw: string, salt: Buffer, len: number, o: Params) =>
  new Promise<Buffer>((resolve, reject) => scryptCb(pw, salt, len, { ...o, maxmem: 64 * 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key))));

/** Format stocké : scrypt$<N>$<r>$<p>$<sel base64>$<hash base64>. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, KEYLEN, PARAMS);
  return `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

function parse(stored: string): { params: Params; salt: Buffer; hash: Buffer } | null {
  const parts = stored.split("$");
  if (parts[0] !== "scrypt") return null;
  if (parts.length === 3 && parts[1] && parts[2]) return { params: LEGACY, salt: Buffer.from(parts[1], "base64"), hash: Buffer.from(parts[2], "base64") };
  if (parts.length !== 6) return null;
  const [N, r, p] = parts.slice(1, 4).map(Number);
  // Bornes : un hash altéré ne doit pas pouvoir réclamer un calcul démesuré.
  if (![N, r, p].every(Number.isInteger) || N < 2 ** 10 || N > 2 ** 17 || (N & (N - 1)) !== 0 || r < 1 || r > 16 || p < 1 || p > 16) return null;
  return { params: { N, r, p }, salt: Buffer.from(parts[4], "base64"), hash: Buffer.from(parts[5], "base64") };
}

// Hash de référence pour un compte inexistant : la réponse prend le même temps, et ne révèle pas si l'adresse existe.
let dummy: Promise<string> | null = null;

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  const parsed = stored ? parse(stored) : null;
  if (!parsed) {
    const ref = parse(await (dummy ??= hashPassword(randomBytes(18).toString("base64"))))!;
    await scrypt(password, ref.salt, ref.hash.length, ref.params);
    return false;
  }
  const actual = await scrypt(password, parsed.salt, parsed.hash.length, parsed.params);
  return actual.length === parsed.hash.length && timingSafeEqual(actual, parsed.hash);
}

/** Hash écrit avec d'autres paramètres que les actuels (ancien format compris) : à recalculer après une vérification réussie. */
export function needsRehash(stored: string) {
  const parsed = parse(stored);
  return !parsed || parsed.params.N !== PARAMS.N || parsed.params.r !== PARAMS.r || parsed.params.p !== PARAMS.p;
}

export function passwordProblem(password: string): string | null {
  if (password.length < 10) return "Le mot de passe doit contenir au moins 10 caractères.";
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password))
    return "Le mot de passe doit contenir au moins une lettre et un chiffre.";
  return null;
}
