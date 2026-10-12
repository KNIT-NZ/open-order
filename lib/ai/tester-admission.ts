/**
 * Shared quota admission for OPEN ORDER's opt-in zero-billed tester lane.
 * Every Gemini SDK client construction is preceded by a reservation.
 * No session, prompt, IP, identifier or user data is stored by the counter.
 *
 * This is a capacity boundary, NOT the billing guarantee: the key must belong
 * to a dedicated unbilled Free Tier Gemini project. SQL migration is separate.
 */
export async function reserveTesterModelAttempt(): Promise<void> {
  if (process.env.OPEN_ORDER_INFERENCE_MODE?.trim() !== "zero-billed-test") {
    return;
  }

  // A missing migration, database error or exhausted counter must never
  // silently become an unmetered provider call. Keep DB errors private.
  try {
    const { db } = await import("../db");
    const result = await db.query<{ allowed: boolean }>(
      "SELECT public.open_order_try_admit_inference() AS allowed",
    );
    if (result.rows.length === 1 && result.rows[0]?.allowed === true) {
      return;
    }
  } catch {
    // Fail closed, including when the database is unreachable.
  }

  throw new Error(
    "OPEN ORDER testing capacity is temporarily exhausted or unavailable. Please try again later.",
  );
}
