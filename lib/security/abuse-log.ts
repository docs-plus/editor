type AbuseEventPayload = Record<string, unknown>;

export function logAbuseEvent(event: string, payload: AbuseEventPayload): void {
  const entry = {
    type: "abuse",
    event,
    ts_iso: new Date().toISOString(),
    ...payload,
  };
  console.warn(JSON.stringify(entry));
}
