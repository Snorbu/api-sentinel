// Health endpoint logic — reports PaymentHub connectivity + balance.
import { getBalance } from "./paymenthub.js";

export async function healthPayload(): Promise<{ status: string; balance: number; currency: string }> {
  try {
    const b = await getBalance();
    return { status: "ok", balance: b.available, currency: b.currency };
  } catch {
    return { status: "degraded", balance: -1, currency: "USD" };
  }
}
