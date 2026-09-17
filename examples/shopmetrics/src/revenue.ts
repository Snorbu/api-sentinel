// Daily revenue rollup — reads charges and sums settled ones.
import { listCharges } from "./paymenthub.js";

export function settledTotal(charges: { paid: boolean; amount: number }[]): number {
  return charges.filter((c) => c.paid).reduce((sum, c) => sum + c.amount, 0);
}

export async function revenueToday(): Promise<{ total: number; count: number }> {
  const { data } = await listCharges();
  const settled = data.filter((c) => c.paid);
  return { total: settledTotal(data), count: settled.length };
}
