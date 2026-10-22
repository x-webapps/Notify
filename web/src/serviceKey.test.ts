import { describe, expect, it } from "vitest";
import { readServiceKey } from "./serviceKey";

const good = {
  type: "service_account",
  project_id: "my-app-12345",
  client_email: "firebase-adminsdk-abc@my-app-12345.iam.gserviceaccount.com",
  private_key: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n",
};

describe("readServiceKey", () => {
  it("returns the project id and email", () => {
    expect(readServiceKey(JSON.stringify(good))).toEqual({ projectId: "my-app-12345", email: good.client_email });
  });

  it("rejects things that are not a service account key", () => {
    for (const text of [
      "nope",
      "null",
      JSON.stringify({ ...good, type: "authorized_user" }),
      JSON.stringify({ ...good, project_id: "Bad_ID" }),
      JSON.stringify({ ...good, client_email: "nope" }),
      JSON.stringify({ ...good, private_key: "secret" }),
      JSON.stringify({ ...good, pad: "x".repeat(21_000) }),
    ]) {
      expect(() => readServiceKey(text)).toThrow();
    }
  });

  it("never puts the private key in an error message", () => {
    try {
      readServiceKey(JSON.stringify({ ...good, project_id: "Bad_ID" }));
    } catch (e) {
      expect(String(e)).not.toContain("BEGIN PRIVATE KEY");
    }
  });
});
