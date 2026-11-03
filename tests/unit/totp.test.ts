import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, hashRecovery, hotp, looksLikeRecovery, newRecoveryCodes, newSecret, otpauthUri, stepAt, totp, verifyTotp } from "@/lib/totp";

// Vecteurs de test de la RFC 6238 (SHA-1, secret ASCII « 12345678901234567890 », 8 chiffres).
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890"));

describe("double authentification (TOTP)", () => {
  it("encode et décode la base 32", () => {
    expect(RFC_SECRET).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(base32Decode(RFC_SECRET).toString()).toBe("12345678901234567890");
    expect(base32Decode(newSecret())).toHaveLength(20);
  });
  it("respecte les vecteurs de la RFC 6238", () => {
    expect(totp(RFC_SECRET, 59_000, 8)).toBe("94287082");
    expect(totp(RFC_SECRET, 1111111109_000, 8)).toBe("07081804");
    expect(totp(RFC_SECRET, 1234567890_000, 8)).toBe("89005924");
    expect(totp(RFC_SECRET, 2000000000_000, 8)).toBe("69279037");
    expect(hotp(Buffer.from("12345678901234567890"), 0)).toBe("755224");
  });
  it("accepte un pas de décalage, refuse un code déjà utilisé", () => {
    const s = newSecret();
    const now = 1_800_000_000_000;
    const step = stepAt(now);
    expect(verifyTotp(s, totp(s, now), { now })).toBe(step);
    expect(verifyTotp(s, totp(s, now - 30_000), { now })).toBe(step - 1);
    expect(verifyTotp(s, totp(s, now - 90_000), { now })).toBeNull();
    expect(verifyTotp(s, totp(s, now), { now, lastStep: step })).toBeNull();
    expect(verifyTotp(s, "12345", { now })).toBeNull();
  });
  it("codes de secours et adresse à scanner", () => {
    const codes = newRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(codes[0]).toMatch(/^[a-z2-7]{4}-[a-z2-7]{4}$/);
    expect(hashRecovery(codes[0].toUpperCase().replace("-", " "))).toBe(hashRecovery(codes[0]));
    expect(looksLikeRecovery(codes[0])).toBe(true);
    expect(looksLikeRecovery("123 456")).toBe(false);
    expect(otpauthUri("ABC", "a@b.fr")).toBe("otpauth://totp/KolBase:a%40b.fr?secret=ABC&issuer=KolBase&algorithm=SHA1&digits=6&period=30");
  });
});
