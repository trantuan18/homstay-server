import type { FastifyInstance } from "fastify";
import { createUserSupabaseClient, supabaseAdmin } from "../lib/supabase.js";

import {
  notifyBookingConfirmed,
  notifyBookingCancelled,
  notifyBookingCheckedIn,
  notifyBookingCheckedOut,
} from "../services/booking-notification.service.js";

import { authenticate } from "../middleware/auth.js";
import { pricingPlanService } from "../services/pricing-plan.service.js";
import { cleaningStatusService } from "../services/cleaning-status.service.js";

function getAccessToken(request: any): string {
  const authorization = request.headers.authorization;
  return authorization.slice(7).trim();
}

function mapAdminError(message: string) {
  const upper = message.toUpperCase();

  if (upper.includes("ADMIN_REQUIRED")) {
    return { status: 403, message: "Admin access required" };
  }

  if (
    upper.includes("USER_REQUIRED") ||
    upper.includes("ROOM_REQUIRED") ||
    upper.includes("START_END_REQUIRED") ||
    upper.includes("INVALID_TIME_RANGE") ||
    upper.includes("INVALID_GUEST_COUNT") ||
    upper.includes("BOOKING_TOO_SHORT") ||
    upper.includes("BOOKING_TOO_LONG") ||
    upper.includes("INVALID_BOOKING_STATUS")
  ) {
    return { status: 400, message };
  }

  if (upper.includes("USER_NOT_FOUND") || upper.includes("BOOKING_NOT_FOUND")) {
    return { status: 404, message };
  }

  if (
    upper.includes("ROOM_NOT_AVAILABLE") ||
    upper.includes("ROOM_BLOCKED") ||
    upper.includes("ROOM_BOOKED")
  ) {
    return { status: 409, message };
  }

  return { status: 400, message };
}

export async function adminBookingsRoute(app: FastifyInstance) {
  // =========================================================
  // GET ALL BOOKINGS
  // =========================================================

  app.get(
    "/api/admin/bookings",
    {
      preHandler: authenticate,
    },
    async (request, reply) => {
      const query = request.query as {
        property_id?: string;
        room_id?: string;
        status?: string;
        payment_status?: string;
        from?: string;
        to?: string;
        start_date?: string;
        end_date?: string;
        overlap_start?: string;
        overlap_end?: string;
      };

      const fromDate = query.from ?? query.start_date;
      const toDate = query.to ?? query.end_date;
      const from = fromDate
        ? /^\d{4}-\d{2}-\d{2}$/.test(fromDate)
          ? `${fromDate}T00:00:00.000Z`
          : fromDate
        : undefined;
      const to = toDate
        ? /^\d{4}-\d{2}-\d{2}$/.test(toDate)
          ? `${toDate}T23:59:59.999Z`
          : toDate
        : undefined;

      const isInvalidDate = (value: string | undefined) => {
        if (!value) return false;
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) return true;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
        return parsed.toISOString().slice(0, 10) !== value;
      };

      if (
        isInvalidDate(fromDate) ||
        isInvalidDate(toDate) ||
        (from && to && new Date(from) > new Date(to))
      ) {
        return reply.status(400).send({
          success: false,
          message: "INVALID_DATE_RANGE",
        });
      }

      const accessToken = getAccessToken(request);
      const userSupabase = createUserSupabaseClient(accessToken);

      let queryBuilder = userSupabase
        .from("bookings")
        .select(
          `
          id,
          booking_code,
          user_id,
          property_id,
          room_id,
          start_at,
          end_at,
          guest_count,
          guest_name,
          guest_phone,
          guest_email,
          subtotal,
          discount,
          tax,
          total,
          currency,
          status,
          payment_status,
          expires_at,
          notes,
          cancelled_at,
          created_at,
          updated_at
        `,
        )
        .order("start_at", { ascending: false });

      if (query.property_id) {
        queryBuilder = queryBuilder.eq("property_id", query.property_id);
      }

      if (query.room_id) {
        queryBuilder = queryBuilder.eq("room_id", query.room_id);
      }

      if (
        query.status &&
        query.status !== "ALL" &&
        query.status !== "all" &&
        query.status !== ""
      ) {
        const statuses = (
          Array.isArray(query.status)
            ? query.status
            : String(query.status).split(",")
        )
          .map((s) => s.trim())
          .filter((s) => s && s.toUpperCase() !== "ALL");

        if (statuses.length === 1) {
          queryBuilder = queryBuilder.eq("status", statuses[0]);
        } else if (statuses.length > 1) {
          queryBuilder = queryBuilder.in("status", statuses);
        }
      }

      if (query.payment_status) {
        queryBuilder = queryBuilder.eq("payment_status", query.payment_status);
      }

      if (from && to) {
        queryBuilder = queryBuilder.gte("end_at", from).lte("start_at", to);
      } else if (from) {
        queryBuilder = queryBuilder.gte("end_at", from);
      } else if (to) {
        queryBuilder = queryBuilder.lte("start_at", to);
      }

      if (query.overlap_start) {
        queryBuilder = queryBuilder.gt("end_at", query.overlap_start);
      }

      if (query.overlap_end) {
        queryBuilder = queryBuilder.lt("start_at", query.overlap_end);
      }

      const { data, error } = await queryBuilder;

      if (error) {
        return reply.status(400).send({
          success: false,
          message: "Failed to get admin bookings",
          error: error.message,
        });
      }

      const enriched = (data ?? []).map((b: any) => {
        const cleaning_status = cleaningStatusService.get(b.id) || b.cleaning_status || "UNCLEANED";
        if (!b.property_id || !b.start_at || !b.end_at) {
          return { ...b, cleaning_status };
        }
        const plan = pricingPlanService.getPropertyPlan(b.property_id);
        if (!plan) return { ...b, cleaning_status };
        const calculated = pricingPlanService.calculatePrice(plan, {
          startAt: new Date(b.start_at),
          endAt: new Date(b.end_at),
          guestCount: b.guest_count || 1,
        });
        return {
          ...b,
          cleaning_status,
          price_breakdown: calculated,
        };
      });

      return {
        success: true,
        data: enriched,
      };
    },
  );

  // =========================================================
  // GET BOOKING DETAIL
  // =========================================================

  app.get(
    "/api/admin/bookings/:id",
    {
      preHandler: authenticate,
    },
    async (request, reply) => {
      const { id } = request.params as {
        id: string;
      };

      const accessToken = getAccessToken(request);
      const userSupabase = createUserSupabaseClient(accessToken);

      const { data, error } = await userSupabase
        .from("bookings")
        .select(
          `
          *,
          payments (
            id,
            provider,
            transaction_id,
            amount,
            currency,
            status,
            paid_at,
            created_at
          )
        `,
        )
        .eq("id", id)
        .maybeSingle();

      if (error) {
        return reply.status(400).send({
          success: false,
          message: "Failed to get booking",
          error: error.message,
        });
      }

      if (!data) {
        return reply.status(404).send({
          success: false,
          message: "Booking not found",
        });
      }

      const cleaning_status = cleaningStatusService.get(data.id) || (data as any).cleaning_status || "UNCLEANED";
      let enriched: any = {
        ...data,
        cleaning_status,
      };
      const propertyId = (data as any)?.property_id;
      if (propertyId && (data as any)?.start_at && (data as any)?.end_at) {
        const plan = pricingPlanService.getPropertyPlan(propertyId);
        if (plan) {
          const calculated = pricingPlanService.calculatePrice(plan, {
            startAt: new Date((data as any).start_at),
            endAt: new Date((data as any).end_at),
            guestCount: (data as any).guest_count || 1,
          });
          enriched = {
            ...enriched,
            price_breakdown: calculated,
          };
        }
      }

      return {
        success: true,
        data: enriched,
      };
    },
  );

  // =========================================================
  // CREATE BOOKING FOR CUSTOMER
  // =========================================================

  app.post(
    "/api/admin/bookings",
    {
      preHandler: authenticate,
    },
    async (request, reply) => {
      const body = request.body as {
        user_id?: string;
        room_id?: string;
        start_at?: string;
        end_at?: string;
        guest_count?: number;
        guest_name?: string;
        guest_phone?: string;
        guest_email?: string;
        notes?: string;
      };


      if (!body.room_id) {
        return reply.status(400).send({
          success: false,
          message: "room_id is required",
        });
      }

      if (!body.start_at || !body.end_at) {
        return reply.status(400).send({
          success: false,
          message: "start_at and end_at are required",
        });
      }

      const startAt = new Date(body.start_at);
      const endAt = new Date(body.end_at);

      if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
        return reply.status(400).send({
          success: false,
          message: "Invalid date format",
        });
      }

      if (startAt >= endAt) {
        return reply.status(400).send({
          success: false,
          message: "end_at must be after start_at",
        });
      }

      const guestCount = body.guest_count ?? 1;

      if (!Number.isInteger(guestCount) || guestCount <= 0) {
        return reply.status(400).send({
          success: false,
          message: "guest_count must be a positive integer",
        });
      }

      const accessToken = getAccessToken(request);
      const userSupabase = createUserSupabaseClient(accessToken);

      let bookingUserId: string | undefined = body.user_id;
      if (!bookingUserId) {
        const { data: authData } = await userSupabase.auth.getUser();
        bookingUserId = authData?.user?.id;
      }

      const { data: roomData } = await supabaseAdmin
        .from("rooms")
        .select("id, capacity, property_id")
        .eq("id", body.room_id)
        .maybeSingle();

      // Ensure room capacity accommodates the guest count to prevent DB RPC INVALID_GUEST_COUNT rejection
      if (roomData && guestCount > (roomData.capacity ?? 0)) {
        await supabaseAdmin
          .from("rooms")
          .update({ capacity: guestCount })
          .eq("id", body.room_id);
      }

      const { data, error } = await userSupabase.rpc("admin_create_booking", {
        p_user_id: bookingUserId,
        p_room_id: body.room_id,
        p_start_at: startAt.toISOString(),
        p_end_at: endAt.toISOString(),
        p_guest_count: guestCount,
        p_guest_name: body.guest_name ?? null,
        p_guest_phone: body.guest_phone ?? null,
        p_guest_email: body.guest_email ?? null,
        p_notes: body.notes ?? null,
      } as any);

      if (error) {
        const mapped = mapAdminError(error.message);

        return reply.status(mapped.status).send({
          success: false,
          message: mapped.message,
          error: error.message,
        });
      }

      let finalBooking = Array.isArray(data) ? data[0] : data;

      if (finalBooking?.id && roomData?.property_id) {
        const plan = pricingPlanService.getPropertyPlan(roomData.property_id);
        if (plan) {
          const calculated = pricingPlanService.calculatePrice(plan, {
            startAt,
            endAt,
            guestCount,
          });

          const feeBreakdownNote = `[Chi tiết phí] Tiền phòng: ${new Intl.NumberFormat("vi-VN").format(calculated.room_price)} ₫` +
            (calculated.extra_guest_fee > 0
              ? ` | Phụ thu khách thêm: +${new Intl.NumberFormat("vi-VN").format(calculated.extra_guest_fee)} ₫ (${calculated.extra_guest_count} khách, từ người thứ ${calculated.standard_guest_count + 1})`
              : "") +
            ` | Bảng giá: ${calculated.pricing_rule_name}`;

          const combinedNotes = body.notes
            ? `${body.notes}\n${feeBreakdownNote}`
            : feeBreakdownNote;

          const { data: updatedBooking, error: updatePriceErr } =
            await supabaseAdmin
              .from("bookings")
              .update({
                subtotal: calculated.subtotal,
                discount: calculated.discount,
                tax: calculated.tax,
                total: calculated.total,
                currency: calculated.currency,
                host_note: feeBreakdownNote,
                notes: combinedNotes,
                updated_at: new Date().toISOString(),
              })
              .eq("id", finalBooking.id)
              .select()
              .single();

          if (!updatePriceErr && updatedBooking) {
            finalBooking = {
              ...updatedBooking,
              price_breakdown: calculated,
            };
          }
        }
      }

      return reply.status(201).send({
        success: true,
        message: "Booking created successfully",
        data: finalBooking,
      });
    },
  );

  // =========================================================
  // UPDATE BOOKING STATUS
  // =========================================================

  const updateBookingStatusHandler = async (request: any, reply: any) => {
    const authHeader = request.headers.authorization;

    if (!authHeader?.startsWith("Bearer ")) {
      return reply.code(401).send({
        success: false,
        message: "Missing access token",
      });
    }

    const token = authHeader.substring(7);

    const userClient = createUserSupabaseClient(token);

    const { data: isAdmin, error: adminError } =
      await userClient.rpc("is_admin");

    if (adminError || isAdmin !== true) {
      return reply.code(403).send({
        success: false,
        message: "ADMIN_REQUIRED",
      });
    }

    const { id } = request.params as {
      id: string;
    };

    const { status, reason } = request.body as {
      status?: string;
      reason?: string;
    };

    if (!status) {
      return reply.code(400).send({
        success: false,
        message: "STATUS_REQUIRED",
      });
    }

    const ALLOWED_STATUSES = [
      "PENDING",
      "CONFIRMED",
      "CHECKED_IN",
      "CHECKED_OUT",
      "CANCELLED",
      "EXPIRED",
      "NO_SHOW",
    ];

    if (!ALLOWED_STATUSES.includes(status)) {
      return reply.code(400).send({
        success: false,
        message: "INVALID_BOOKING_STATUS",
      });
    }

    const normalizedReason = String(reason ?? "Admin status update").trim();

    const { data: booking, error: findError } = await supabaseAdmin
      .from("bookings")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (findError) {
      return reply.code(500).send({
        success: false,
        message: findError.message,
      });
    }

    if (!booking) {
      return reply.code(404).send({
        success: false,
        message: "BOOKING_NOT_FOUND",
      });
    }

    const { data: authUser } = await userClient.auth.getUser();
    let isSuperAdmin = false;
    if (authUser?.user?.id) {
      const { data: roleRow } = await supabaseAdmin
        .from("user_roles")
        .select("role")
        .eq("user_id", authUser.user.id)
        .maybeSingle();
      isSuperAdmin = roleRow?.role === "SUPER_ADMIN";
    }

    const validTransitions: Record<string, string[]> = {
      PENDING: ["CONFIRMED", "CANCELLED", "EXPIRED"],
      CONFIRMED: ["CHECKED_IN", "CANCELLED", "NO_SHOW"],
      CHECKED_IN: ["CHECKED_OUT", "CANCELLED"],
    };

    if (!isSuperAdmin && booking.status !== status) {
      const allowed = validTransitions[booking.status];
      if (!allowed || !allowed.includes(status)) {
        return reply.code(400).send({
          success: false,
          message: "INVALID_STATUS_TRANSITION",
        });
      }
    }

    if (
      status === "CHECKED_IN" &&
      !isSuperAdmin &&
      !["PAID", "PARTIAL"].includes(booking.payment_status)
    ) {
      return reply.code(400).send({
        success: false,
        message: "PAYMENT_REQUIRED",
      });
    }

    const updatePayload: Record<string, any> = {
      status,
      updated_at: new Date().toISOString(),
    };

    if (status === "CANCELLED") {
      updatePayload.cancelled_at = new Date().toISOString();
      updatePayload.cancelled_reason = normalizedReason;
    }

    const { data: updatedBooking, error: updateError } = await supabaseAdmin
      .from("bookings")
      .update(updatePayload)
      .eq("id", id)
      .select()
      .single();

    if (updateError) {
      return reply.code(500).send({
        success: false,
        message: updateError.message,
      });
    }

    const notificationData = {
      userId: booking.user_id,
      bookingCode: booking.booking_code,
      startAt: booking.start_at,
      endAt: booking.end_at,
    };

    if (status === "CONFIRMED") {
      notifyBookingConfirmed(notificationData).catch(() => {});
    } else if (status === "CANCELLED") {
      notifyBookingCancelled(notificationData).catch(() => {});
    } else if (status === "CHECKED_IN") {
      notifyBookingCheckedIn(notificationData).catch(() => {});
    } else if (status === "CHECKED_OUT") {
      notifyBookingCheckedOut(notificationData).catch(() => {});
    }

    return reply.send({
      success: true,
      message: "BOOKING_STATUS_UPDATED",
      data: updatedBooking,
    });
  };

  app.patch(
    "/api/admin/bookings/:id/status",
    { preHandler: authenticate },
    updateBookingStatusHandler,
  );
  app.put(
    "/api/admin/bookings/:id/status",
    { preHandler: authenticate },
    updateBookingStatusHandler,
  );
  app.patch(
    "/api/admin/bookings/:id",
    { preHandler: authenticate },
    updateBookingStatusHandler,
  );

  // =========================================================
  // CALCULATE BOOKING PRICE
  // =========================================================

  app.get(
    "/api/admin/bookings/price",
    { preHandler: authenticate },
    async (request, reply) => {
      const query = request.query as {
        room_id?: string;
        start_at?: string;
        end_at?: string;
        guest_count?: string | number;
      };

      if (!query.room_id) {
        return reply.status(400).send({
          success: false,
          message: "room_id is required",
        });
      }

      const parseDate = (val: unknown): Date | null => {
        if (typeof val !== "string" || !val.trim()) return null;
        const d = new Date(val);
        return Number.isNaN(d.getTime()) ? null : d;
      };

      const startAt = parseDate(query.start_at);
      const endAt = parseDate(query.end_at);

      if (!startAt || !endAt) {
        return reply.status(400).send({
          success: false,
          message: "Invalid start_at or end_at",
        });
      }

      if (startAt >= endAt) {
        return reply.status(400).send({
          success: false,
          message: "end_at must be after start_at",
        });
      }

      // Check if room belongs to a property with an assigned pricing plan
      const { data: roomData } = await supabaseAdmin
        .from("rooms")
        .select("property_id")
        .eq("id", query.room_id)
        .maybeSingle();

      if (roomData?.property_id) {
        const plan = pricingPlanService.getPropertyPlan(roomData.property_id);
        if (plan) {
          const guestCount = Number((query as any).guest_count || 1);
          const calculated = pricingPlanService.calculatePrice(plan, {
            startAt,
            endAt,
            guestCount,
          });
          return {
            success: true,
            data: {
              room_id: query.room_id,
              ...calculated,
            },
          };
        }
      }

      const { data, error } = await supabaseAdmin.rpc(
        "calculate_booking_price",
        {
          p_room_id: query.room_id,
          p_start_at: startAt.toISOString(),
          p_end_at: endAt.toISOString(),
        },
      );

      if (error) {
        return reply.status(400).send({
          success: false,
          message: "Failed to calculate booking price",
          error: error.message,
        });
      }

      const result = Array.isArray(data) ? data[0] : data;

      if (!result) {
        return reply.status(500).send({
          success: false,
          message: "Price calculation returned no result",
        });
      }

      return {
        success: true,
        data: result,
      };
    },
  );

  // =========================================================
  // UPDATE CLEANING STATUS
  // =========================================================
  app.patch(
    "/api/admin/bookings/:id/cleaning-status",
    {
      preHandler: authenticate,
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as { cleaning_status?: "UNCLEANED" | "CLEANED" };
      const status = body.cleaning_status === "CLEANED" ? "CLEANED" : "UNCLEANED";

      const updated = await cleaningStatusService.set(id, status);

      return reply.send({
        success: true,
        data: {
          id,
          cleaning_status: updated,
        },
      });
    },
  );
}

