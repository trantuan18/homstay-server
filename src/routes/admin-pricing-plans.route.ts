import type { FastifyInstance } from "fastify";
import { createUserSupabaseClient } from "../lib/supabase.js";
import { authenticate } from "../middleware/auth.js";
import { pricingPlanService } from "../services/pricing-plan.service.js";

export async function adminPricingPlansRoute(app: FastifyInstance) {
  async function requireAdmin(accessToken: string) {
    const userClient = createUserSupabaseClient(accessToken);
    const { data, error } = await userClient.rpc("is_admin");
    if (error || data !== true) {
      throw new Error("ADMIN_REQUIRED");
    }
  }

  // GET /api/admin/pricing-plans
  app.get(
    "/api/admin/pricing-plans",
    { preHandler: authenticate },
    async (request, reply) => {
      try {
        const token = request.headers.authorization?.replace("Bearer ", "");
        if (!token) return reply.status(401).send({ success: false, message: "Missing token" });
        await requireAdmin(token);

        const plans = pricingPlanService.list();
        return reply.send({
          success: true,
          data: plans,
        });
      } catch (err: any) {
        if (err?.message === "ADMIN_REQUIRED") {
          return reply.status(403).send({ success: false, message: "Admin access required" });
        }
        return reply.status(500).send({ success: false, message: err?.message || "Internal error" });
      }
    },
  );

  // GET /api/admin/pricing-plans/:id
  app.get(
    "/api/admin/pricing-plans/:id",
    { preHandler: authenticate },
    async (request, reply) => {
      try {
        const token = request.headers.authorization?.replace("Bearer ", "");
        if (!token) return reply.status(401).send({ success: false, message: "Missing token" });
        await requireAdmin(token);

        const { id } = request.params as { id: string };
        const plan = pricingPlanService.getById(id);
        if (!plan) {
          return reply.status(404).send({ success: false, message: "Pricing plan not found" });
        }

        return reply.send({
          success: true,
          data: plan,
        });
      } catch (err: any) {
        if (err?.message === "ADMIN_REQUIRED") {
          return reply.status(403).send({ success: false, message: "Admin access required" });
        }
        return reply.status(500).send({ success: false, message: err?.message || "Internal error" });
      }
    },
  );

  // POST /api/admin/pricing-plans
  app.post(
    "/api/admin/pricing-plans",
    { preHandler: authenticate },
    async (request, reply) => {
      try {
        const token = request.headers.authorization?.replace("Bearer ", "");
        if (!token) return reply.status(401).send({ success: false, message: "Missing token" });
        await requireAdmin(token);

        const body = request.body as any;
        if (!body.name?.trim()) {
          return reply.status(400).send({ success: false, message: "Tên bảng giá là bắt buộc" });
        }

        const newPlan = pricingPlanService.create(body);
        return reply.status(201).send({
          success: true,
          data: newPlan,
        });
      } catch (err: any) {
        if (err?.message === "ADMIN_REQUIRED") {
          return reply.status(403).send({ success: false, message: "Admin access required" });
        }
        return reply.status(500).send({ success: false, message: err?.message || "Internal error" });
      }
    },
  );

  // PUT /api/admin/pricing-plans/:id
  app.put(
    "/api/admin/pricing-plans/:id",
    { preHandler: authenticate },
    async (request, reply) => {
      try {
        const token = request.headers.authorization?.replace("Bearer ", "");
        if (!token) return reply.status(401).send({ success: false, message: "Missing token" });
        await requireAdmin(token);

        const { id } = request.params as { id: string };
        const body = request.body as any;

        const updated = pricingPlanService.update(id, body);
        if (!updated) {
          return reply.status(404).send({ success: false, message: "Pricing plan not found" });
        }

        await pricingPlanService.syncAllPropertiesToDatabase();

        return reply.send({
          success: true,
          data: updated,
        });
      } catch (err: any) {
        if (err?.message === "ADMIN_REQUIRED") {
          return reply.status(403).send({ success: false, message: "Admin access required" });
        }
        return reply.status(500).send({ success: false, message: err?.message || "Internal error" });
      }
    },
  );

  // DELETE /api/admin/pricing-plans/:id
  app.delete(
    "/api/admin/pricing-plans/:id",
    { preHandler: authenticate },
    async (request, reply) => {
      try {
        const token = request.headers.authorization?.replace("Bearer ", "");
        if (!token) return reply.status(401).send({ success: false, message: "Missing token" });
        await requireAdmin(token);

        const { id } = request.params as { id: string };
        const ok = pricingPlanService.remove(id);
        if (!ok) {
          return reply.status(404).send({ success: false, message: "Pricing plan not found" });
        }

        await pricingPlanService.syncAllPropertiesToDatabase();

        return reply.send({
          success: true,
          message: "Pricing plan deleted successfully",
        });
      } catch (err: any) {
        if (err?.message === "ADMIN_REQUIRED") {
          return reply.status(403).send({ success: false, message: "Admin access required" });
        }
        return reply.status(500).send({ success: false, message: err?.message || "Internal error" });
      }
    },
  );
}
