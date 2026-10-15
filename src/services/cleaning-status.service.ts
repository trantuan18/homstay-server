import fs from "fs";
import path from "path";
import { supabaseAdmin } from "../lib/supabase.js";

export type CleaningStatus = "UNCLEANED" | "CLEANED";

const DATA_FILE = path.resolve(process.cwd(), "data", "booking-cleaning.json");

function readStore(): Record<string, CleaningStatus> {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const content = fs.readFileSync(DATA_FILE, "utf-8");
      return JSON.parse(content) || {};
    }
  } catch (err) {
    console.error("Error reading booking cleaning store:", err);
  }
  return {};
}

function writeStore(store: Record<string, CleaningStatus>): void {
  try {
    const dir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), "utf-8");
  } catch (err) {
    console.error("Error writing booking cleaning store:", err);
  }
}

export const cleaningStatusService = {
  get(bookingId: string): CleaningStatus {
    const store = readStore();
    return store[bookingId] || "UNCLEANED";
  },

  getAll(): Record<string, CleaningStatus> {
    return readStore();
  },

  async set(bookingId: string, status: CleaningStatus): Promise<CleaningStatus> {
    const normalized: CleaningStatus = status === "CLEANED" ? "CLEANED" : "UNCLEANED";
    const store = readStore();
    const oldStatus = store[bookingId] || "UNCLEANED";
    store[bookingId] = normalized;
    writeStore(store);

    // Persist to database audit_logs
    void (async () => {
      try {
        await supabaseAdmin.from("audit_logs").insert({
          action: "BOOKING_CLEANING_STATUS_CHANGED",
          entity_type: "BOOKING",
          entity_id: bookingId,
          old_value: { cleaning_status: oldStatus },
          new_value: { cleaning_status: normalized },
        });

        // Also try direct column update if the column exists
        await supabaseAdmin
          .from("bookings")
          .update({ cleaning_status: normalized } as any)
          .eq("id", bookingId);
      } catch (err) {
        // Safe catch for schema discrepancies
      }
    })();

    return normalized;
  },
};
