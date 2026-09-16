import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { verifyWebhookSignature } from "./signature";

const SECRET = "webhook-signing-secret";

function sign(body: Buffer, secret: string = SECRET): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

describe("webhook signature verification", () => {
  const body = Buffer.from(JSON.stringify({ action: "created", installation: { id: 123 } }), "utf8");

  it("accepts a correctly signed body", () => {
    expect(verifyWebhookSignature(body, sign(body), SECRET)).toBe(true);
  });

  it("rejects a signature computed with the wrong secret", () => {
    expect(verifyWebhookSignature(body, sign(body, "not-the-secret"), SECRET)).toBe(false);
  });

  it("rejects when the body was tampered after signing", () => {
    const original = sign(body);
    const tampered = Buffer.from(
      JSON.stringify({ action: "deleted", installation: { id: 123 } }),
      "utf8",
    );
    expect(verifyWebhookSignature(tampered, original, SECRET)).toBe(false);
  });

  it("rejects a missing signature header", () => {
    expect(verifyWebhookSignature(body, undefined, SECRET)).toBe(false);
  });

  it("rejects when the secret is unset", () => {
    expect(verifyWebhookSignature(body, sign(body), "")).toBe(false);
  });
});
