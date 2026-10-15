import assert from "assert";
import { pricingPlanService } from "./pricing-plan.service.js";
import { cleaningStatusService } from "./cleaning-status.service.js";

async function runCheck() {
  console.log("Running self-check tests...");

  // 1. Check Pricing Plan with flexible_rate_percent
  const testPlan = pricingPlanService.create({
    name: "Self Check Test Plan",
    hourly_first_hours: 2,
    hourly_first_price: 200000,
    hourly_next_price: 50000,
    flexible_rate_percent: 10,
    standard_guest_count: 2,
    extra_guest_fee: 100000,
  });

  assert.strictEqual(testPlan.flexible_rate_percent, 10, "Plan flexible_rate_percent should be 10");

  const now = new Date("2026-10-15T10:00:00Z");
  const twoHoursLater = new Date("2026-10-15T12:00:00Z");

  const calc1 = pricingPlanService.calculatePrice(testPlan, {
    startAt: now,
    endAt: twoHoursLater,
    guestCount: 2,
  });

  // Base subtotal = 200,000. +10% = 220,000. Total = 220,000.
  assert.strictEqual(calc1.base_subtotal, 200000, "Base subtotal should be 200000");
  assert.strictEqual(calc1.flexible_rate_percent, 10, "Flexible rate percent should be 10");
  assert.strictEqual(calc1.flexible_rate_adjustment, 20000, "Flexible adjustment should be +20000");
  assert.strictEqual(calc1.subtotal, 220000, "Adjusted subtotal should be 220000");
  assert.strictEqual(calc1.total, 220000, "Total should be 220000");

  // Update with negative percent (-15%)
  const updatedPlan = pricingPlanService.update(testPlan.id, {
    flexible_rate_percent: -15,
  });
  assert(updatedPlan !== null, "Plan update should succeed");
  assert.strictEqual(updatedPlan.flexible_rate_percent, -15, "Plan flexible_rate_percent should be -15");

  const calc2 = pricingPlanService.calculatePrice(updatedPlan, {
    startAt: now,
    endAt: twoHoursLater,
    guestCount: 2,
  });
  // Base = 200,000. -15% = -30,000. Subtotal = 170,000. Total = 170,000.
  assert.strictEqual(calc2.flexible_rate_adjustment, -30000, "Flexible adjustment should be -30000");
  assert.strictEqual(calc2.subtotal, 170000, "Adjusted subtotal should be 170000");

  // Clean up
  const removed = pricingPlanService.remove(testPlan.id);
  assert.strictEqual(removed, true, "Plan removal should succeed");
  console.log("✓ Pricing plan flexible rate tests passed");

  // 2. Check Cleaning Status service
  const fakeBookingId = "test-booking-" + Date.now();
  assert.strictEqual(cleaningStatusService.get(fakeBookingId), "UNCLEANED", "Default cleaning status must be UNCLEANED");

  await cleaningStatusService.set(fakeBookingId, "CLEANED");
  assert.strictEqual(cleaningStatusService.get(fakeBookingId), "CLEANED", "Cleaning status should be updated to CLEANED");

  await cleaningStatusService.set(fakeBookingId, "UNCLEANED");
  assert.strictEqual(cleaningStatusService.get(fakeBookingId), "UNCLEANED", "Cleaning status should toggle back to UNCLEANED");
  console.log("✓ Cleaning status service tests passed");

  console.log("ALL SELF-CHECKS PASSED SUCCESSFULLY!");
}

runCheck().catch((err) => {
  console.error("Self-check failed:", err);
  process.exit(1);
});
