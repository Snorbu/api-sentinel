const CHARGES_URL = "/v1/charges";

export async function getChargePaid(): Promise<boolean> {
  const res = await fetch(CHARGES_URL);
  const body = (await res.json()) as { paid: boolean };
  return body.paid; // uses the field that gets removed in v2
}
