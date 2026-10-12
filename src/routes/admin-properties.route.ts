import type { FastifyInstance } from "fastify";
import { authenticate } from "../middleware/auth.js";
import { supabaseAdmin, createUserSupabaseClient } from "../lib/supabase.js";
import { describePropertyUpdateError } from "../lib/property-update-error.js";
import { pricingPlanService } from "../services/pricing-plan.service.js";

const UNLIMITED_BOOKING_MINUTES = 2_147_483_647;

const normalizeTimezone = (value?: string | null) => {
  const raw = (value || "Asia/Ho_Chi_Minh").trim();
  const key = raw.toLowerCase();
  const aliases: Record<string, string> = {
    "gmt+0700": "Asia/Ho_Chi_Minh",
    "gmt+7": "Asia/Ho_Chi_Minh",
    "utc+7": "Asia/Ho_Chi_Minh",
    "gmt+0800": "Asia/Singapore",
    "gmt+8": "Asia/Singapore",
    "utc+8": "Asia/Singapore",
    gmt: "Etc/GMT",
    utc: "Etc/UTC",
  };

  if (aliases[key]) return aliases[key];

  const supported = (Intl as any).supportedValuesOf?.("timeZone");
  if (Array.isArray(supported)) {
    if (supported.includes(raw)) return raw;
    const alt = raw.replace(/^etc\//i, "Etc/");
    if (supported.includes(alt)) return alt;
  }

  return "Asia/Ho_Chi_Minh";
};

function generateSlug(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${base || "property"}-${Date.now().toString(36)}`;
}

export async function adminPropertiesRoute(app: FastifyInstance) {
  // =========================================================
  // ADMIN CHECK
  // =========================================================
  async function requireAdmin(accessToken: string) {
    const userClient = createUserSupabaseClient(accessToken);

    const { data, error } = await userClient.rpc("is_admin");

    if (error || data !== true) {
      throw new Error("ADMIN_REQUIRED");
    }
  }

  // =========================================================
  // GET ALL PROPERTIES
  // GET /api/admin/properties
  // =========================================================
  app.get(
    "/api/admin/properties",
    { preHandler: authenticate },
    async (request, reply) => {
      try {
        const token = request.headers.authorization?.replace("Bearer ", "");

        if (!token) {
          return reply.status(401).send({
            success: false,
            message: "Missing access token",
          });
        }

        await requireAdmin(token);

        const query = request.query as {
          status?: string;
          owner_id?: string;
          city?: string;
          search?: string;
          limit?: string;
          offset?: string;
        };

        const limit = Math.min(Math.max(Number(query.limit ?? 20), 1), 100);

        const offset = Math.max(Number(query.offset ?? 0), 0);

        let dbQuery = supabaseAdmin
          .from("properties")
          .select(
            `
            id,
            owner_id,
            name,
            slug,
            description,
            address,
            city,
            country,
            latitude,
            longitude,
            timezone,
            booking_interval_minutes,
            minimum_booking_minutes,
            maximum_booking_minutes,
            check_in_time,
            check_out_time,
            cancellation_deadline_hours,
            cancellation_fee_percent,
            status,
            created_at,
            updated_at,
            profiles!properties_owner_id_fkey (
              id,
              full_name,
              phone,
              avatar_url
            )
          `,
            { count: "exact" },
          )
          .order("created_at", {
            ascending: false,
          })
          .range(offset, offset + limit - 1);

        if (query.status) {
          dbQuery = dbQuery.eq("status", query.status);
        }

        if (query.owner_id) {
          dbQuery = dbQuery.eq("owner_id", query.owner_id);
        }

        if (query.city?.trim()) {
          dbQuery = dbQuery.ilike("city", `%${query.city.trim()}%`);
        }

        if (query.search?.trim()) {
          dbQuery = dbQuery.or(
            `name.ilike.%${query.search.trim()}%,slug.ilike.%${query.search.trim()}%`,
          );
        }

        const { data, error, count } = await dbQuery;

        if (error) {
          return reply.status(400).send({
            success: false,
            message: "Failed to get properties",
            error: error.message,
          });
        }

        const enriched = (data ?? []).map((p) => {
          const plan = pricingPlanService.getPropertyPlan(p.id);
          const planId = pricingPlanService.getPropertyPlanId(p.id);
          return {
            ...p,
            pricing_plan_id: planId,
            pricing_plan: plan,
          };
        });

        return {
          success: true,
          data: enriched,
          pagination: {
            total: count ?? 0,
            limit,
            offset,
          },
        };
      } catch (error: any) {
        if (error?.message === "ADMIN_REQUIRED") {
          return reply.status(403).send({
            success: false,
            message: "Admin access required",
          });
        }

        return reply.status(500).send({
          success: false,
          message: error?.message ?? "Internal server error",
        });
      }
    },
  );

  // =========================================================
  // GET PROPERTY DETAIL
  // GET /api/admin/properties/:id
  // =========================================================
  app.get(
    "/api/admin/properties/:id",
    { preHandler: authenticate },
    async (request, reply) => {
      try {
        const token = request.headers.authorization?.replace("Bearer ", "");

        if (!token) {
          return reply.status(401).send({
            success: false,
            message: "Missing access token",
          });
        }

        await requireAdmin(token);

        const { id } = request.params as {
          id: string;
        };

        const { data, error } = await supabaseAdmin
          .from("properties")
          .select(
            `
            *,
            profiles!properties_owner_id_fkey (
              id,
              full_name,
              phone,
              avatar_url
            ),
            rooms (
              id,
              name,
              slug,
              capacity,
              base_hourly_price,
              base_daily_price,
              status
            )
          `,
          )
          .eq("id", id)
          .single();

        if (error) {
          return reply.status(404).send({
            success: false,
            message: "Property not found",
          });
        }

        const plan = pricingPlanService.getPropertyPlan(data.id);
        const planId = pricingPlanService.getPropertyPlanId(data.id);

        return {
          success: true,
          data: {
            ...data,
            pricing_plan_id: planId,
            pricing_plan: plan,
          },
        };
      } catch (error: any) {
        if (error?.message === "ADMIN_REQUIRED") {
          return reply.status(403).send({
            success: false,
            message: "Admin access required",
          });
        }

        return reply.status(500).send({
          success: false,
          message: error?.message ?? "Internal server error",
        });
      }
    },
  );

  // =========================================================
  // CREATE PROPERTY
  // POST /api/admin/properties
  // =========================================================
  app.post(
    "/api/admin/properties",
    { preHandler: authenticate },
    async (request, reply) => {
      try {
        const token = request.headers.authorization?.replace("Bearer ", "");

        if (!token) {
          return reply.status(401).send({
            success: false,
            message: "Missing access token",
          });
        }

        await requireAdmin(token);

        const body = (request.body ?? {}) as any;

        const name = (body.name ?? "").trim();
        if (!name) {
          return reply.status(400).send({
            success: false,
            message: "name is required",
          });
        }

        const ownerId = body.owner_id || (request as any).user?.id;
        if (!ownerId) {
          return reply.status(400).send({
            success: false,
            message: "owner_id is required",
          });
        }

        const slug = (body.slug ?? "").trim() || generateSlug(name);

        const payload = {
          owner_id: ownerId,
          name,
          slug,
          description: body.description ? String(body.description).trim() : null,
          address: body.address ? String(body.address).trim() : null,
          city: body.city ? String(body.city).trim() : null,
          country: body.country ? String(body.country).trim() : "Vietnam",
          latitude: body.latitude ?? null,
          longitude: body.longitude ?? null,
          timezone: normalizeTimezone(body.timezone),
          booking_interval_minutes: body.booking_interval_minutes ?? 60,
          minimum_booking_minutes: body.minimum_booking_minutes ?? 60,
          maximum_booking_minutes: UNLIMITED_BOOKING_MINUTES,
          check_in_time: body.check_in_time ?? null,
          check_out_time: body.check_out_time ?? null,
          cancellation_deadline_hours: body.cancellation_deadline_hours ?? 24,
          cancellation_fee_percent: body.cancellation_fee_percent ?? 0,
          status: body.status ?? "ACTIVE",
        };

        const { data, error } = await supabaseAdmin
          .from("properties")
          .insert(payload)
          .select()
          .single();

        if (error) {
          return reply.status(400).send({
            success: false,
            message: "Failed to create property",
            error: error.message,
          });
        }

        if (body.pricing_plan_id !== undefined) {
          pricingPlanService.setPropertyPlan(data.id, body.pricing_plan_id || null);
          await pricingPlanService.syncPropertyPlanToDatabase(data.id, body.pricing_plan_id || null);
        }

        const plan = pricingPlanService.getPropertyPlan(data.id);
        const planId = pricingPlanService.getPropertyPlanId(data.id);

        return reply.status(201).send({
          success: true,
          data: {
            ...data,
            pricing_plan_id: planId,
            pricing_plan: plan,
          },
        });
      } catch (error: any) {
        if (error?.message === "ADMIN_REQUIRED") {
          return reply.status(403).send({
            success: false,
            message: "Admin access required",
          });
        }

        return reply.status(500).send({
          success: false,
          message: error?.message ?? "Internal server error",
        });
      }
    },
  );

  // =========================================================
  // UPDATE PROPERTY
  // PATCH /api/admin/properties/:id
  // =========================================================
  app.route({
    method: ["PATCH", "PUT"],
    url: "/api/admin/properties/:id",
    preHandler: authenticate,
    handler: async (request, reply) => {
      try {
        const token = request.headers.authorization?.replace("Bearer ", "");

        if (!token) {
          return reply.status(401).send({
            success: false,
            message: "Missing access token",
          });
        }

        await requireAdmin(token);

        const { id } = request.params as {
          id: string;
        };

        const body = request.body as any;

        const allowedFields = [
          "owner_id",
          "name",
          "slug",
          "description",
          "address",
          "city",
          "country",
          "latitude",
          "longitude",
          "timezone",
          "booking_interval_minutes",
          "minimum_booking_minutes",
          "maximum_booking_minutes",
          "check_in_time",
          "check_out_time",
          "cancellation_deadline_hours",
          "cancellation_fee_percent",
          "status",
        ];

        const payload: Record<string, any> = {};

        for (const field of allowedFields) {
          if (body[field] !== undefined) {
            const value =
              typeof body[field] === "string"
                ? body[field].trim()
                : body[field];
            payload[field] =
              field === "timezone" ? normalizeTimezone(value) : value;
          }
        }

        if (Object.keys(payload).length === 0 && body.pricing_plan_id === undefined) {
          return reply.status(400).send({
            success: false,
            code: "NO_FIELDS_TO_UPDATE",
            message: "No fields to update",
          });
        }

        let propertyData: any = null;

        if (Object.keys(payload).length > 0) {
          payload.maximum_booking_minutes = UNLIMITED_BOOKING_MINUTES;
          payload.updated_at = new Date().toISOString();

          const { data, error } = await supabaseAdmin
            .from("properties")
            .update(payload)
            .eq("id", id)
            .select()
            .maybeSingle();

          if (error) {
            const updateError = describePropertyUpdateError(error);
            return reply.status(400).send({
              success: false,
              ...updateError,
              details: error.message,
            });
          }

          if (!data) {
            return reply.status(404).send({
              success: false,
              code: "PROPERTY_NOT_FOUND",
              message: "The property you are trying to edit was not found.",
            });
          }
          propertyData = data;
        } else {
          const { data, error } = await supabaseAdmin
            .from("properties")
            .select()
            .eq("id", id)
            .maybeSingle();

          if (error || !data) {
            return reply.status(404).send({
              success: false,
              code: "PROPERTY_NOT_FOUND",
              message: "The property you are trying to edit was not found.",
            });
          }
          propertyData = data;
        }

        if (body.pricing_plan_id !== undefined) {
          pricingPlanService.setPropertyPlan(id, body.pricing_plan_id || null);
          await pricingPlanService.syncPropertyPlanToDatabase(id, body.pricing_plan_id || null);
        }

        const plan = pricingPlanService.getPropertyPlan(id);
        const planId = pricingPlanService.getPropertyPlanId(id);

        return {
          success: true,
          data: {
            ...propertyData,
            pricing_plan_id: planId,
            pricing_plan: plan,
          },
        };
      } catch (error: any) {
        if (error?.message === "ADMIN_REQUIRED") {
          return reply.status(403).send({
            success: false,
            message: "Admin access required",
          });
        }

        return reply.status(500).send({
          success: false,
          message: error?.message ?? "Internal server error",
        });
      }
    },
  });

  // =========================================================
  // DEACTIVATE PROPERTY
  // DELETE /api/admin/properties/:id
  // =========================================================
  app.delete(
    "/api/admin/properties/:id",
    { preHandler: authenticate },
    async (request, reply) => {
      try {
        const token = request.headers.authorization?.replace("Bearer ", "");

        if (!token) {
          return reply.status(401).send({
            success: false,
            message: "Missing access token",
          });
        }

        await requireAdmin(token);

        const { id } = request.params as {
          id: string;
        };

        const { data, error } = await supabaseAdmin
          .from("properties")
          .update({
            status: "INACTIVE",
            updated_at: new Date().toISOString(),
          })
          .eq("id", id)
          .select()
          .single();

        if (error) {
          return reply.status(404).send({
            success: false,
            message: "Property not found",
          });
        }

        return {
          success: true,
          message: "Property deactivated successfully",
          data,
        };
      } catch (error: any) {
        if (error?.message === "ADMIN_REQUIRED") {
          return reply.status(403).send({
            success: false,
            message: "Admin access required",
          });
        }

        return reply.status(500).send({
          success: false,
          message: error?.message ?? "Internal server error",
        });
      }
    },
  );
}
