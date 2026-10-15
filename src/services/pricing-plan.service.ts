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

  // Giá linh hoạt (% tăng hoặc giảm: ví dụ +10 hoặc -15)
  flexible_rate_percent?: number;

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
  flexible_rate_percent: 0,
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

    // Also persist store snapshot to Supabase database (audit_logs)
    void (async () => {
      try {
        await supabaseAdmin.from("audit_logs").insert({
          action: "PRICING_STORE_SYNC",
          entity_type: "PRICING_STORE",
          entity_id: "global",
          new_value: store,
        });
      } catch (err) {
        console.error("Failed to backup pricing plans to database:", err);
      }
    })();
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
      flexible_rate_percent: Number(payload.flexible_rate_percent) || 0,
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
      flexible_rate_percent:
        payload.flexible_rate_percent !== undefined
          ? Number(payload.flexible_rate_percent)
          : (existing.flexible_rate_percent || 0),
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

    const startHour = startAt.getHours();
    const endHour = endAt.getHours();

    // Helper: kiểm tra đêm cuối tuần (T6, T7, CN)
    const isWeekendNight = (d: Date) => {
      const day = d.getDay();
      return day === 5 || day === 6 || day === 0; // T6, T7, CN
    };

    let baseSubtotal = 0;
    let ruleLabel = "";
    let stayType: "HOURLY" | "OVERNIGHT" | "DAILY" | "MULTI_DAY" = "HOURLY";
    let nightsCount = 0;

    // Tính số ngày chênh lệch lịch giữa ngày nhận và ngày trả
    const dStart = new Date(startAt.getFullYear(), startAt.getMonth(), startAt.getDate());
    const dEnd = new Date(endAt.getFullYear(), endAt.getMonth(), endAt.getDate());
    const calendarDaysDiff = Math.max(0, Math.round((dEnd.getTime() - dStart.getTime()) / (1000 * 60 * 60 * 24)));

    // 1. Kiểm tra hình thức thuê THEO NGÀY ĐÊM (Daily stay hoặc Multi-day stay)
    // Áp dụng khi khách ở >= 24h, hoặc có chuyển ngày và thời lượng >= 16h, hoặc rơi vào khung check-in trưa/chiều (12h-16h) và check-out trưa hôm sau (9h-14h)
    const isDailyOrMultiDay =
      durationHours >= 24 ||
      (calendarDaysDiff >= 1 && durationHours >= 16) ||
      (calendarDaysDiff >= 1 && startHour >= 12 && startHour <= 16 && endHour >= 9 && endHour <= 14);

    // 2. Kiểm tra hình thức thuê QUA ĐÊM (Overnight)
    // Nhận phòng tối/đêm (>= 20:00 hoặc <= 02:00 sáng hôm sau), trả phòng sáng hôm sau (<= 12:00 trưa), thời lượng 6h - 15h
    const isOvernightTime =
      !isDailyOrMultiDay &&
      calendarDaysDiff >= 1 &&
      (startHour >= 20 || startHour <= 2) &&
      endHour >= 6 &&
      endHour <= 12 &&
      durationHours >= 6 &&
      durationHours <= 15;

    if (isDailyOrMultiDay) {
      // Số đêm lưu trú: tối thiểu 1 đêm
      nightsCount = Math.max(1, calendarDaysDiff);
      if (durationHours > nightsCount * 24 + 4) {
        nightsCount = Math.ceil(durationHours / 24);
      }

      stayType = nightsCount > 1 ? "MULTI_DAY" : "DAILY";
      let weekdayNights = 0;
      let weekendNights = 0;

      // Duyệt qua từng đêm để tính giá chuẩn xác từng đêm theo ngày thường vs cuối tuần
      for (let i = 0; i < nightsCount; i++) {
        const nightDate = new Date(dStart.getTime() + i * 24 * 60 * 60 * 1000);
        if (isWeekendNight(nightDate)) {
          weekendNights++;
          baseSubtotal += (plan.daily_weekend_price || plan.daily_weekday_price || 0);
        } else {
          weekdayNights++;
          baseSubtotal += (plan.daily_weekday_price || 0);
        }
      }

      if (nightsCount === 1) {
        const isWk = weekendNights > 0;
        ruleLabel = `Combo ngày đêm (${isWk ? "Cuối tuần T6-CN" : "Trong tuần T2-T5"})`;
      } else {
        ruleLabel = `Theo ngày (${nightsCount} đêm: ${weekdayNights} ngày thường, ${weekendNights} cuối tuần)`;
      }

      // Xử lý phụ thu trả muộn / nhận sớm cho gói ngày đêm nếu vượt quá 2 tiếng
      const expectedCheckIn = 14;
      const expectedCheckOut = 12;
      const earlyHours = startHour < expectedCheckIn ? Math.max(0, expectedCheckIn - startHour) : 0;
      const lateHours = endHour > expectedCheckOut ? Math.max(0, endHour - expectedCheckOut) : 0;
      const extraStayHours = Math.max(0, Math.round(durationHours - nightsCount * 22));

      if (extraStayHours >= 2 && nightsCount === 1 && earlyHours + lateHours > 0) {
        const extraHoursCharge = Math.min(
          (earlyHours + lateHours) * (plan.hourly_next_price || 50000),
          Math.round((plan.daily_weekday_price || 500000) * 0.5) // tối đa 50% tiền phòng
        );
        if (extraHoursCharge > 0) {
          baseSubtotal += extraHoursCharge;
          ruleLabel += ` + Phụ trội giờ (${earlyHours + lateHours}h)`;
        }
      }
    } else if (isOvernightTime) {
      stayType = "OVERNIGHT";
      nightsCount = 1;
      const isWeekend = isWeekendNight(startAt);
      baseSubtotal = isWeekend
        ? (plan.overnight_weekend_price || plan.overnight_weekday_price || 0)
        : (plan.overnight_weekday_price || 0);
      ruleLabel = `Giá qua đêm (${isWeekend ? "Cuối tuần T6-CN" : "Trong tuần T2-T5"})`;
    } else {
      // 3. THUÊ THEO GIỜ LẺ & COMBO
      stayType = "HOURLY";
      nightsCount = 0;

      // Tính giá theo giờ lẻ tiêu chuẩn
      let hourlyStandardPrice = 0;
      if (durationHours <= plan.hourly_first_hours) {
        hourlyStandardPrice = plan.hourly_first_price;
      } else {
        const extraHours = Math.ceil(durationHours - plan.hourly_first_hours);
        hourlyStandardPrice = plan.hourly_first_price + extraHours * plan.hourly_next_price;
      }

      // Xem xét combo 4h và combo 8h nếu tiết kiệm hơn cho khách
      let bestPrice = hourlyStandardPrice;
      let bestRule = durationHours <= plan.hourly_first_hours
        ? `Giờ lẻ (${plan.hourly_first_hours}h đầu)`
        : `Giờ lẻ (${plan.hourly_first_hours}h đầu + ${Math.ceil(durationHours - plan.hourly_first_hours)}h tiếp theo)`;

      if (durationHours >= 3.0 && durationHours <= 5.0 && plan.combo_4h_price) {
        const extraOver4h = durationHours > 4 ? Math.ceil(durationHours - 4) * plan.hourly_next_price : 0;
        const combo4hTotal = plan.combo_4h_price + extraOver4h;
        if (combo4hTotal <= bestPrice) {
          bestPrice = combo4hTotal;
          bestRule = extraOver4h > 0 ? `Combo 4 giờ (+${Math.ceil(durationHours - 4)}h phụ trội)` : "Combo 4 giờ";
        }
      }

      if (durationHours >= 6.5 && durationHours <= 9.5 && plan.combo_8h_price) {
        const extraOver8h = durationHours > 8 ? Math.ceil(durationHours - 8) * plan.hourly_next_price : 0;
        const combo8hTotal = plan.combo_8h_price + extraOver8h;
        if (combo8hTotal <= bestPrice) {
          bestPrice = combo8hTotal;
          bestRule = extraOver8h > 0 ? `Combo 8 giờ (+${Math.ceil(durationHours - 8)}h phụ trội)` : "Combo 8 giờ";
        }
      }

      // Trần giá (Price Cap): Tiền giờ không được vượt quá giá nguyên ngày đêm hôm đó
      const dayCap = isWeekendNight(startAt) ? plan.daily_weekend_price : plan.daily_weekday_price;
      if (dayCap && bestPrice > dayCap) {
        bestPrice = dayCap;
        bestRule = "Trọn gói trong ngày (Chạm mức tối đa ngày)";
      }

      baseSubtotal = bestPrice;
      ruleLabel = bestRule;
    }

    // 4. Điều chỉnh giá linh hoạt (% tăng hoặc giảm)
    const flexibleRatePercent = Number(plan.flexible_rate_percent || 0);
    const flexibleAdjustment = Math.round(baseSubtotal * (flexibleRatePercent / 100));
    const adjustedSubtotal = Math.max(0, baseSubtotal + flexibleAdjustment);

    // 5. Phụ thu khách thêm (tính theo số đêm nếu ở theo ngày, hoặc tính 1 lần nếu theo giờ/1 đêm)
    const standardGuests =
      plan.standard_guest_count !== undefined
        ? Number(plan.standard_guest_count)
        : 2;
    let extraGuests = 0;
    let extraGuestFee = 0;
    if (guestCount > standardGuests) {
      extraGuests = guestCount - standardGuests;
      const nightMultiplier = Math.max(1, nightsCount);
      extraGuestFee = extraGuests * (plan.extra_guest_fee || 100000) * nightMultiplier;
    }

    const total = adjustedSubtotal + extraGuestFee;

    const percentText = flexibleRatePercent > 0 ? `+${flexibleRatePercent}%` : `${flexibleRatePercent}%`;
    const pricingRuleName =
      flexibleRatePercent !== 0
        ? `${plan.name} — ${ruleLabel} (${percentText})`
        : `${plan.name} — ${ruleLabel}`;

    return {
      subtotal: adjustedSubtotal,
      room_price: adjustedSubtotal,
      base_subtotal: baseSubtotal,
      stay_type: stayType,
      nights_count: nightsCount,
      duration_hours: Math.round(durationHours * 10) / 10,
      duration_minutes: durationMinutes,
      flexible_rate_percent: flexibleRatePercent,
      flexible_rate_adjustment: flexibleAdjustment,
      standard_guest_count: standardGuests,
      extra_guest_count: extraGuests,
      extra_guest_fee: extraGuestFee,
      extra_guest_unit_price: plan.extra_guest_fee || 100000,
      holiday_surcharge: 0,
      discount: 0,
      tax: 0,
      total,
      pricing_rule_name: pricingRuleName,
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
        const flexFactor = 1 + (Number(plan.flexible_rate_percent) || 0) / 100;
        const hourlyRate = Math.round(
          (plan.hourly_first_price / Math.max(1, plan.hourly_first_hours)) * flexFactor,
        );
        const dailyRate = Math.round(plan.daily_weekday_price * flexFactor);

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
