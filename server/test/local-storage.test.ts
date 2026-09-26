import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { localStorage } from "../src/storage/storage.js";

const dir = await mkdtemp(join(tmpdir(), "pw-storage-"));
afterAll(() => rm(dir, { recursive: true, force: true }));

describe("local storage (development)", () => {
  it("keeps files and their links working after a restart", async () => {
    const before = localStorage(dir, "pepper");
    await before.put("uploads/u1/a.jpg", Buffer.from("jpeg bytes"), "image/jpeg");
    const url = new URL(await before.signedGetUrl("uploads/u1/a.jpg", 3600), "http://x");

    /* a new process with the same folder and secret */
    const after = localStorage(dir, "pepper");
    expect(await after.read("uploads/u1/a.jpg")).toEqual({ body: Buffer.from("jpeg bytes"), contentType: "image/jpeg" });
    expect(after.verify("GET", "uploads/u1/a.jpg", url.searchParams.get("exp")!, url.searchParams.get("sig")!)).toBe(true);
    /* another secret can't use the link */
    expect(localStorage(dir, "other").verify("GET", "uploads/u1/a.jpg", url.searchParams.get("exp")!, url.searchParams.get("sig")!)).toBe(false);

    await after.delete("uploads/u1/a.jpg");
    expect(await after.head("uploads/u1/a.jpg")).toBeNull();
  });

  it("refuses keys outside its folder", async () => {
    await expect(localStorage(dir, "pepper").put("../escape.txt", Buffer.from("x"), "text/plain")).rejects.toThrow();
  });
});
