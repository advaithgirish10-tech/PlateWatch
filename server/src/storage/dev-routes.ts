import type { FastifyInstance } from "fastify";
import { forbidden, notFound } from "../lib/errors.js";
import type { DevStorage } from "./storage.js";

/* development only: stands in for the S3 endpoint when STORAGE=local or memory, honouring the same signed-URL rules */
export async function devStorageRoutes(app: FastifyInstance) {
  const storage = app.deps.storage as DevStorage;
  app.addContentTypeParser("*", { parseAs: "buffer", bodyLimit: 60 * 1024 * 1024 }, (_req, body, done) => done(null, body));

  app.put<{ Params: { key: string }; Querystring: Record<string, string> }>("/api/dev/storage/:key", async (req, reply) => {
    const { exp = "", sig = "", size = "" } = req.query;
    const body = req.body as Buffer;
    if (!storage.verify("PUT", req.params.key, exp, sig, size) || String(body.length) !== size) throw forbidden("Signature or size mismatch.");
    await storage.put(req.params.key, body, req.headers["content-type"] ?? "application/octet-stream");
    return reply.status(200).send();
  });

  app.get<{ Params: { key: string }; Querystring: Record<string, string> }>("/api/dev/storage/:key", async (req, reply) => {
    const { exp = "", sig = "" } = req.query;
    if (!storage.verify("GET", req.params.key, exp, sig)) throw forbidden("Signature expired.");
    const f = await storage.read(req.params.key);
    if (!f) throw notFound();
    return reply.type(f.contentType).send(f.body);
  });
}
