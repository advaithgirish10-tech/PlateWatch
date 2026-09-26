import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../../auth/sessions.js";
import { parse } from "../../lib/validate.js";
import { createUpload } from "./service.js";

const Body = z.object({
  purpose: z.enum(["evidence", "report", "response", "claim"]),
  contentType: z.string().max(100),
  size: z.number().int().positive(),
  filename: z.string().min(1).max(200),
});

export async function uploadRoutes(app: FastifyInstance) {
  app.post("/api/uploads", async (req, reply) => {
    const user = requireUser(req);
    const body = parse(Body, req.body);
    return reply.status(201).send(await createUpload(app.deps, user.id, user.role === "admin", body));
  });
}
