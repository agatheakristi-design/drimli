export type RescheduleSlot = { start: string; end: string };

export function filterClientRescheduleSlots(params: {
  slots: RescheduleSlot[];
  policySnapshot: string | null | undefined;
  commitmentCreatedAt: string | null | undefined;
}) {
  if (params.policySnapshot !== "moderate" || !params.commitmentCreatedAt) {
    return params.slots;
  }
  const holdingLimit = Date.parse(params.commitmentCreatedAt) + 80 * 24 * 60 * 60 * 1000;
  return params.slots.filter((slot) => Date.parse(slot.end) <= holdingLimit);
}
