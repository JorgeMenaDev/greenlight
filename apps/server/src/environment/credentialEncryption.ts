import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const value = process.env["GREENLIGHT_CREDENTIAL_KEY"];
delete process.env["GREENLIGHT_CREDENTIAL_KEY"];

const key = () => {
  if (!value || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(
      "Saved credentials require the desktop secure store or GREENLIGHT_CREDENTIAL_KEY from a secret store.",
    );
  }
  return Buffer.from(value, "hex");
};

export const encryptPassword = (password: string, project: string, authRef: string) => {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), nonce);
  cipher.setAAD(Buffer.from(JSON.stringify([project, authRef])));
  const ciphertext = Buffer.concat([cipher.update(password, "utf8"), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString("base64");
};

export const decryptPassword = (value: string, project: string, authRef: string) => {
  const payload = Buffer.from(value, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key(), payload.subarray(0, 12));
  decipher.setAAD(Buffer.from(JSON.stringify([project, authRef])));
  decipher.setAuthTag(payload.subarray(12, 28));
  return Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]).toString("utf8");
};
