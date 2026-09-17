// PaymentHub client — the only file that knows PaymentHub's wire format.
const BASE = process.env.PAYMENTHUB_URL ?? "https://api.paymenthub.example";

export interface Charge {
  id: string;
  paid: boolean;
  status: "succeeded" | "failed" | "pending";
  amount: number;
}

export async function listCharges(): Promise<{ data: Charge[]; has_more: boolean }> {
  const res = await fetch(`${BASE}/v1/charges`);
  const body = (await res.json()) as { data: Charge[]; has_more: boolean };
  return body;
}

export async function createRefund(chargeId: string): Promise<{ id: string; status: string }> {
  const res = await fetch(`${BASE}/v1/refunds`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ charge: chargeId }),
  });
  const body = (await res.json()) as { id: string; status: string };
  return body;
}

export async function getBalance(): Promise<{ available: number; currency: string }> {
  const res = await fetch(`${BASE}/v1/balance`);
  const body = (await res.json()) as { available: number; currency: string };
  return body;
}
