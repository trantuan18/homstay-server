import fs from "fs";
import path from "path";
import crypto from "crypto";
import { supabaseAdmin } from "../lib/supabase.js";

export interface PricingPlan {
  id: string;
  name: string;
  description?: string;
  is_default?: boolean;

  // Giờ lẻ & combo lẻ
  hourly_first_hours: number; // e.g. 2
  hourly_first_price: number; // e.g. 249000
  hourly_next_price: number; // e.g. 69000
  combo_4h_price: number; // e.g. 359000
  combo_8h_price: number; // e.g. 489000

  // Giá qua đêm (22h - 9h)
  overnight_check_in: string; // "22:00"
  overnight_check_out: string; // "09:00"
  overnight_weekday_price: number; // 429000
  overnight_weekend_price: number; // 499000

  // Combo ngày đêm (14h - 11h)
  daily_check_in: string; // "14:00"
  daily_check_out: string; // "11:00"
  daily_weekday_price: number; // 599000
  daily_weekend_price: number; // 699000

  // Phụ thu & số người
  standard_guest_count: number; // 3
  extra_guest_fee: number; // 100000 / người / phòng / đêm
  holiday_surcharge: number; // 100000 / phòng / đêm

  created_at: string;
  updated_at: string;
}

interface PricingStore {
  plans: PricingPlan[];
  property_mappings: Record<string, string>; // property_id -> pricing_plan_id
}

const DATA_FILE = path.resolve(process.cwd(), "data", "pricing-plans.json");

const defaultInitialPlan: PricingPlan = {
  id: "default-plan-standard",
  name: "Bảng giá tiêu chuẩn",
  description: "Bảng giá tiêu chuẩn áp dụng cho giờ lẻ, qua đêm, ngày đêm và phụ thu khách thêm",
  is_default: true,
  hourly_first_hours: 2,
  hourly_first_price: 249000,
  hourly_next_price: 69000,
  combo_4h_price: 359000,
  combo_8h_price: 489000,
  overnight_check_in: "22:00",
  overnight_check_out: "09:00",
  overnight_weekday_price: 429000,
  overnight_weekend_price: 499000,
  daily_check_in: "14:00",
  daily_check_out: "11:00",
  daily_weekday_price: 599000,
  daily_weekend_price: 699000,
  standard_guest_count: 2,
  extra_guest_fee: 100000,
  holiday_surcharge: 100000,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

function readStore(): PricingStore {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const content = fs.readFileSync(DATA_FILE, "utf-8");
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed.plans) && parsed.plans.length > 0) {
        return parsed;
      }
    }
  } catch (err) {
    console.error("Error reading pricing plans store:", err);
  }

  const initialStore: PricingStore = {
    plans: [defaultInitialPlan],
    property_mappings: {},
  };
  writeStore(initialStore);
  return initialStore;
}

function writeStore(store: PricingStore): void {
  try {
    const dir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), "utf-8");
  } catch (err) {
    console.error("Error writing pricing plans store:", err);
  }
}

export const pricingPlanService = {
  list(): PricingPlan[] {
    const store = readStore();
    return store.plans;
  },

  getById(id: string): PricingPlan | null {
    const store = readStore();
    return store.plans.find((p) => p.id === id) || null;
  },

  getDefault(): PricingPlan | null {
    const store = readStore();
    return store.plans.find((p) => p.is_default) || store.plans[0] || null;
  },

  create(payload: Partial<PricingPlan>): PricingPlan {
    const store = readStore();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    if (payload.is_default) {
      store.plans.forEach((p) => {
        p.is_default = false;
      });
    }

    const newPlan: PricingPlan = {
      id,
      name: payload.name?.trim() || "Bảng giá mới",
      description: payload.description?.trim() || "",
      is_default: Boolean(payload.is_default),
      hourly_first_hours: Number(payload.hourly_first_hours) || 2,
      hourly_first_price: Number(payload.hourly_first_price) || 249000,
      hourly_next_price: Number(payload.hourly_next_price) || 69000,
      combo_4h_price: Number(payload.combo_4h_price) || 359000,
      combo_8h_price: Number(payload.combo_8h_price) || 489000,
      overnight_check_in: payload.overnight_check_in || "22:00",
      overnight_check_out: payload.overnight_check_out || "09:00",
      overnight_weekday_price: Number(payload.overnight_weekday_price) || 429000,
      overnight_weekend_price: Number(payload.overnight_weekend_price) || 499000,
      daily_check_in: payload.daily_check_in || "14:00",
      daily_check_out: payload.daily_check_out || "11:00",
      daily_weekday_price: Number(payload.daily_weekday_price) || 599000,
      daily_weekend_price: Number(payload.daily_weekend_price) || 699000,
      standard_guest_count: Number(payload.standard_guest_count) || 3,
      extra_guest_fee: Number(payload.extra_guest_fee) || 100000,
      holiday_surcharge: Number(payload.holiday_surcharge) || 100000,
      created_at: now,
      updated_at: now,
    };

    store.plans.unshift(newPlan);
    writeStore(store);
    return newPlan;
  },

  update(id: string, payload: Partial<PricingPlan>): PricingPlan | null {
    const store = readStore();
    const index = store.plans.findIndex((p) => p.id === id);
    if (index === -1) return null;

    if (payload.is_default) {
      store.plans.forEach((p) => {
        p.is_default = false;
      });
    }

    const existing = store.plans[index];
    const updated: PricingPlan = {
      ...existing,
      ...payload,
      id,
      updated_at: new Date().toISOString(),
    };

    store.plans[index] = updated;
    writeStore(store);
    return updated;
  },

  remove(id: string): boolean {
    const store = readStore();
    const prevLength = store.plans.length;
    store.plans = store.plans.filter((p) => p.id !== id);
    if (store.plans.length === prevLength) return false;

    // Remove any property mappings pointing to this plan
    for (const [propId, planId] of Object.entries(store.property_mappings)) {
      if (planId === id) {
        delete store.property_mappings[propId];
      }
    }

    // Ensure at least one default plan exists
    if (store.plans.length > 0 && !store.plans.some((p) => p.is_default)) {
      store.plans[0].is_default = true;
    }

    writeStore(store);
    return true;
  },

  getPropertyPlan(propertyId: string): PricingPlan | null {
    const store = readStore();
    const planId = store.property_mappings[propertyId];
    if (planId) {
      const plan = store.plans.find((p) => p.id === planId);
      if (plan) return plan;
    }
    return store.plans.find((p) => p.is_default) || store.plans[0] || null;
  },

  getPropertyPlanId(propertyId: string): string | null {
    const store = readStore();
    return store.property_mappings[propertyId] || null;
  },

  setPropertyPlan(propertyId: string, pricingPlanId: string | null): void {
    const store = readStore();
    if (pricingPlanId) {
      store.property_mappings[propertyId] = pricingPlanId;
    } else {
      delete store.property_mappings[propertyId];
    }
    writeStore(store);
  },

  calculatePrice(
    plan: PricingPlan,
    params: {
      startAt: Date;
      endAt: Date;
      guestCount?: number;
    },
  ) {
    const { startAt, endAt, guestCount = 1 } = params;
    const durationMinutes = Math.max(
      15,
      Math.round((endAt.getTime() - startAt.getTime()) / 60000),
    );
    const durationHours = durationMinutes / 60;

    // Day of week: 0 = CN, 1 = T2, 2 = T3, 3 = T4, 4 = T5, 5 = T6, 6 = T7
    const dayOfWeek = startAt.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 5 || dayOfWeek === 6;

    let subtotal = 0;
    let ruleLabel = "";

    // 1. Kiểm tra thuê qua đêm:
    // Thường nhận phòng từ 21:00 - 01:00 và trả phòng 07:00 - 11:00 sáng hôm sau (7h - 13h)
    const startHour = startAt.getHours();
    const endHour = endAt.getHours();
    const isOvernightTime =
      (startHour >= 21 || startHour <= 1) &&
      endHour >= 7 &&
      endHour <= 11 &&
      durationHours >= 7 &&
      durationHours <= 14;

    // 2. Kiểm tra combo ngày đêm:
    // Thường nhận phòng 13:00 - 15:00 và trả phòng 10:00 - 13:00 hôm sau (19h - 25h)
    const isDailyStay =
      durationHours >= 18 &&
      durationHours <= 26 &&
      startHour >= 12 &&
      startHour <= 16;

    if (isDailyStay) {
      subtotal = isWeekend
        ? plan.daily_weekend_price
        : plan.daily_weekday_price;
      ruleLabel = `Combo ngày đêm (${isWeekend ? "T6-CN" : "T2-T5"})`;
    } else if (isOvernightTime) {
      subtotal = isWeekend
        ? plan.overnight_weekend_price
        : plan.overnight_weekday_price;
      ruleLabel = `Giá qua đêm (${isWeekend ? "T6-CN" : "T2-T5"})`;
    } else if (durationHours >= 3.5 && durationHours <= 4.5) {
      subtotal = plan.combo_4h_price;
      ruleLabel = "Combo 4 giờ";
    } else if (durationHours >= 7.5 && durationHours <= 8.5) {
      subtotal = plan.combo_8h_price;
      ruleLabel = "Combo 8 giờ";
    } else {
      // Giờ lẻ thông thường
      if (durationHours <= plan.hourly_first_hours) {
        subtotal = plan.hourly_first_price;
        ruleLabel = `Giờ lẻ (${plan.hourly_first_hours}h đầu)`;
      } else {
        const extraHours = Math.ceil(durationHours - plan.hourly_first_hours);
        subtotal =
          plan.hourly_first_price + extraHours * plan.hourly_next_price;
        ruleLabel = `Giờ lẻ (${plan.hourly_first_hours}h đầu + ${extraHours}h tiếp theo)`;
      }
    }

    // 3. Phụ thu khách thêm
    const standardGuests =
      plan.standard_guest_count !== undefined
        ? Number(plan.standard_guest_count)
        : 2;
    let extraGuests = 0;
    let extraGuestFee = 0;
    if (guestCount > standardGuests) {
      extraGuests = guestCount - standardGuests;
      extraGuestFee = extraGuests * (plan.extra_guest_fee || 100000);
    }

    const total = subtotal + extraGuestFee;

    return {
      subtotal,
      room_price: subtotal,
      standard_guest_count: standardGuests,
      extra_guest_count: extraGuests,
      extra_guest_fee: extraGuestFee,
      extra_guest_unit_price: plan.extra_guest_fee || 100000,
      holiday_surcharge: 0,
      discount: 0,
      tax: 0,
      total,
      duration_minutes: durationMinutes,
      pricing_rule_name: `${plan.name} — ${ruleLabel}`,
      currency: "VND",
    };
  },

  async syncPropertyPlanToDatabase(
    propertyId: string,
    pricingPlanId?: string | null,
  ): Promise<void> {
    try {
      const plan =
        pricingPlanId !== undefined
          ? pricingPlanId
            ? this.getById(pricingPlanId)
            : null
          : this.getPropertyPlan(propertyId);

      const { data: rooms, error: roomsErr } = await supabaseAdmin
        .from("rooms")
        .select("id, name")
        .eq("property_id", propertyId);

      if (roomsErr || !rooms || rooms.length === 0) return;

      const roomIds = rooms.map((r) => r.id);

      if (plan) {
        const hourlyRate = Math.round(
          plan.hourly_first_price / Math.max(1, plan.hourly_first_hours),
        );
        const dailyRate = plan.daily_weekday_price;

        // 1. Update rooms base prices in Supabase database
        for (const room of rooms) {
          await supabaseAdmin
            .from("rooms")
            .update({
              base_hourly_price: hourlyRate,
              base_daily_price: dailyRate,
              updated_at: new Date().toISOString(),
            })
            .eq("id", room.id);
        }

        // 2. Synchronize weekend pricing rules in Supabase database
        const weekendHourlyRate = Math.round(
          hourlyRate * (plan.daily_weekend_price / Math.max(1, plan.daily_weekday_price)),
        );

        for (const roomId of roomIds) {
          await supabaseAdmin
            .from("pricing_rules")
            .delete()
            .eq("room_id", roomId)
            .like("rule_name", "[Bảng giá]%");

          const weekendRules = [
            {
              room_id: roomId,
              rule_name: `[Bảng giá] ${plan.name} - Thứ 6`,
              day_of_week: 5,
              start_time: "00:00:00",
              end_time: "23:59:59",
              min_duration_minutes: 60,
              max_duration_minutes: 1440,
              price: weekendHourlyRate,
              priority: 20,
              active: true,
            },
            {
              room_id: roomId,
              rule_name: `[Bảng giá] ${plan.name} - Thứ 7`,
              day_of_week: 6,
              start_time: "00:00:00",
              end_time: "23:59:59",
              min_duration_minutes: 60,
              max_duration_minutes: 1440,
              price: weekendHourlyRate,
              priority: 20,
              active: true,
            },
            {
              room_id: roomId,
              rule_name: `[Bảng giá] ${plan.name} - Chủ nhật`,
              day_of_week: 0,
              start_time: "00:00:00",
              end_time: "23:59:59",
              min_duration_minutes: 60,
              max_duration_minutes: 1440,
              price: weekendHourlyRate,
              priority: 20,
              active: true,
            },
          ];

          await supabaseAdmin.from("pricing_rules").insert(weekendRules);
        }
      } else {
        // Plan removed: delete auto-generated pricing rules
        for (const roomId of roomIds) {
          await supabaseAdmin
            .from("pricing_rules")
            .delete()
            .eq("room_id", roomId)
            .like("rule_name", "[Bảng giá]%");
        }
      }
    } catch (err) {
      console.error(
        `Failed to sync property ${propertyId} plan to database:`,
        err,
      );
    }
  },

  async syncAllPropertiesToDatabase(): Promise<void> {
    try {
      const { data: properties } = await supabaseAdmin
        .from("properties")
        .select("id");

      if (!properties || properties.length === 0) return;

      for (const prop of properties) {
        await this.syncPropertyPlanToDatabase(prop.id);
      }
    } catch (err) {
      console.error("Failed to sync all properties to database:", err);
    }
  },
};
