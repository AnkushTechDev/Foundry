import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { Injectable } from "@nestjs/common";

@Injectable()
export class CryptoService {
  private readonly key: Buffer;

  constructor() {
    const encoded = process.env.ENCRYPTION_KEY ?? Buffer.alloc(32).toString("base64");
    const key = Buffer.from(encoded, "base64");
    if (key.length !== 32) {
      throw new Error("ENCRYPTION_KEY must be 32 bytes of base64");
    }
    this.key = key;
  }

  encrypt(plain: string): { ciphertext: string; iv: string; tag: string } {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    return {
      ciphertext: ciphertext.toString("base64"),
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
    };
  }

  decrypt(payload: { ciphertext: string; iv: string; tag: string }): string {
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(payload.iv, "base64"));
    decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(payload.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
  }

  hash(value: string): string {
    return createHash("sha256").update(value).digest("hex");
  }
}
