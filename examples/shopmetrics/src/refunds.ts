// Refund queue processor — creates refunds for disputed charges.
import { createRefund } from "./paymenthub.js";

export async function processRefundQueue(queue: string[]): Promise<string[]> {
  const results: string[] = [];
  for (const chargeId of queue) {
    const refund = await createRefund(chargeId);
    results.push(refund.id);
  }
  return results;
}
