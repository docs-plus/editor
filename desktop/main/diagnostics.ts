/**
 * Main's diagnostics ring (desktop architecture §9): the last 2,000 events,
 * each a code plus numbers or short enum strings. Never document text,
 * titles, paths, URLs or ids: refusals log a code, not what was refused.
 *
 * `TINYDOCY_DIAGNOSTICS_STDOUT=1` also prints each event as one JSON line
 * (CI reads the quit timings from it). The `electron` Playwright project
 * reads the ring through `globalThis.__tinydocyDiagnostics`.
 * Writing `logs/diagnostics.jsonl` and Copy diagnostics come with P2.9a.
 */
export type SafeFields = Record<string, number | boolean | string>;
export type DiagnosticEvent = { t: number; event: string } & SafeFields;

const CAPACITY = 2000;
const MAX_STRING = 40;

class Diagnostics {
  private readonly ring: DiagnosticEvent[] = [];
  private readonly echo = process.env.TINYDOCY_DIAGNOSTICS_STDOUT === "1";

  log(event: string, fields: SafeFields = {}): void {
    try {
      const safe: SafeFields = {};
      for (const [key, value] of Object.entries(fields))
        safe[key] =
          typeof value === "string" ? value.slice(0, MAX_STRING) : value;
      const entry = { ...safe, t: Math.round(performance.now()), event };
      this.ring.push(entry);
      if (this.ring.length > CAPACITY) this.ring.shift();
      if (this.echo)
        process.stdout.write(`[tinydocy] ${JSON.stringify(entry)}\n`);
    } catch {
      // Logging never throws into a caller (quit paths included).
    }
  }

  events(): DiagnosticEvent[] {
    return this.ring.slice();
  }

  count(event: string): number {
    return this.ring.filter((e) => e.event === event).length;
  }
}

export const diagnostics = new Diagnostics();
(globalThis as { __tinydocyDiagnostics?: Diagnostics }).__tinydocyDiagnostics =
  diagnostics;
