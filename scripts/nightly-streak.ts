/**
 * Nightly streak tracker (test strategy §1.6, Q5).
 *
 *   bun scripts/nightly-streak.ts [--days 30] [--branch main] [--json]
 *
 * Reads the scheduled runs of the gating nightly workflows on `main` through
 * `gh` (read-only: `gh run list`, `gh run view`) and prints the current
 * streak per gate as Markdown, for the owner to paste into the pinned streak
 * issue. It never writes to GitHub.
 *
 * The rules (§1.6), as this script reads them:
 * - **Run verdict.** `success` is green; a cancelled run is void. A failed
 *   run is red when any failed job's first failing step is a test step, and
 *   void when every failed job broke in setup ({@link SETUP_STEPS}) or lost
 *   its runner (no failing step recorded).
 * - **Re-runs.** One manual re-run is allowed per void run: attempt 2 then
 *   decides. A re-run never rescues a red first attempt, and attempts after
 *   the second are ignored.
 * - **Day verdict** (UTC, by the run's creation time): red if any run is
 *   red, else void if any run is void, else green. A day with no scheduled
 *   run at all (GitHub drops crons now and then) is void, never green.
 * - **Streak.** Consecutive green days back from yesterday (today is still
 *   running); a red day ends it, and so does a third void day.
 * - **Gates.** A gate counts a green day only if every job set it needs
 *   ran and passed that day: a job counts towards a set when its name
 *   contains the set's label (`Desktop storage soak (T1–T8) / …` → `T1–T8`).
 *   A set that never ran in the window reports the gate as not running yet.
 */
import { parseArgs } from "node:util";

export const GATING_WORKFLOWS = ["nightly.yml", "nightly-desktop.yml"] as const;

/** Steps before any test runs: a failure there voids the run (§1.6). */
export const SETUP_STEPS: readonly string[] = [
  "Set up job",
  "Checkout",
  "Set up Bun",
  "Install",
  "Install Chromium",
  "Install Playwright browsers",
  "Block Node.js",
  "Block Node.js (node.exe on Windows)",
  "Complete job",
];

export type Gate = {
  name: string;
  /** Streak days the gate needs (plan §10, strategy §1.6). */
  needs: number;
  /** Job sets, matched as substrings of job names. */
  requires: readonly string[];
};

export const GATES: readonly Gate[] = [
  { name: "Gate 2", needs: 5, requires: ["T1–T8", "T16–T18"] },
  { name: "Gate 3", needs: 7, requires: ["T1–T8", "T16–T18"] },
  {
    name: "Gate 5",
    needs: 7,
    requires: ["T1–T8", "T9–T15", "T16–T18", "T19", "library-soak"],
  },
];

export type GhStep = { name: string; conclusion: string | null };
export type GhJob = {
  name: string;
  conclusion: string | null;
  steps: GhStep[];
};
export type GhRun = {
  databaseId: number;
  workflowName: string;
  createdAt: string;
  status: string;
  conclusion: string | null;
  attempt: number;
  url: string;
};

/** One run with the jobs of its first attempt and, if re-run, its second. */
export type RunRecord = {
  run: GhRun;
  attempts: GhJob[][];
};

export type Verdict = "green" | "red" | "void" | "pending";

export type RunVerdict = {
  verdict: Verdict;
  reason: string;
  /** Jobs that passed in the deciding attempt, for gate coverage. */
  passedJobs: string[];
};

const PASSING = new Set(["success", "skipped", "neutral"]);

function passed(conclusion: string | null): boolean {
  return conclusion !== null && PASSING.has(conclusion);
}

/** Classifies one attempt from its jobs (only called for a failed run). */
export function classifyJobs(jobs: readonly GhJob[]): {
  verdict: "red" | "void";
  reason: string;
} {
  const failed = jobs.filter((job) => !passed(job.conclusion));
  const voids: string[] = [];
  for (const job of failed) {
    const step = job.steps.find((s) => !passed(s.conclusion));
    if (step && !SETUP_STEPS.includes(step.name))
      return { verdict: "red", reason: `${job.name} › ${step.name}` };
    voids.push(
      step ? `${job.name} › ${step.name}` : `${job.name} (no step ran)`,
    );
  }
  return {
    verdict: "void",
    reason:
      voids.length > 0 ? `setup: ${voids.join("; ")}` : "failed, no job failed",
  };
}

function passedJobs(jobs: readonly GhJob[] | undefined): string[] {
  return (jobs ?? [])
    .filter((job) => passed(job.conclusion))
    .map((j) => j.name);
}

export function classifyRun({ run, attempts }: RunRecord): RunVerdict {
  if (run.status !== "completed")
    return { verdict: "pending", reason: run.status, passedJobs: [] };
  const [first, second] = attempts;
  if (run.attempt <= 1) {
    if (run.conclusion === "success")
      return { verdict: "green", reason: "", passedJobs: passedJobs(first) };
    if (run.conclusion === "cancelled" || run.conclusion === "skipped")
      return {
        verdict: "void",
        reason: `run ${run.conclusion}`,
        passedJobs: [],
      };
    return { ...classifyJobs(first ?? []), passedJobs: passedJobs(first) };
  }
  // Re-run: the first attempt decides unless it was void.
  if (first && first.length > 0 && first.every((job) => passed(job.conclusion)))
    return { verdict: "green", reason: "", passedJobs: passedJobs(first) };
  const firstVerdict = classifyJobs(first ?? []);
  if (firstVerdict.verdict === "red")
    return {
      verdict: "red",
      reason: `${firstVerdict.reason} (attempt 1; a re-run doesn't clear red)`,
      passedJobs: [],
    };
  const decidingIsLatest = run.attempt === 2;
  if (decidingIsLatest && run.conclusion === "success")
    return {
      verdict: "green",
      reason: "re-run after a void attempt",
      passedJobs: passedJobs(second),
    };
  const secondJobs = second ?? [];
  const secondVerdict =
    secondJobs.length > 0 && secondJobs.every((job) => passed(job.conclusion))
      ? { verdict: "green" as const, reason: "re-run after a void attempt" }
      : classifyJobs(secondJobs);
  return {
    ...secondVerdict,
    reason:
      run.attempt > 2
        ? `${secondVerdict.reason} (attempts after the 2nd ignored)`
        : secondVerdict.reason,
    passedJobs: passedJobs(second),
  };
}

export type DayReport = {
  day: string;
  verdict: Verdict;
  runs: number;
  reason: string;
  passedJobs: string[];
};

export function utcDay(iso: string): string {
  return iso.slice(0, 10);
}

function addDays(day: string, delta: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

/**
 * One report per UTC day from `from` to `to` (inclusive), newest first.
 * Days with no run are void.
 */
export function classifyDays(
  records: readonly RunRecord[],
  from: string,
  to: string,
): DayReport[] {
  const byDay = new Map<string, RunVerdict[]>();
  for (const record of records) {
    const day = utcDay(record.run.createdAt);
    byDay.set(day, [...(byDay.get(day) ?? []), classifyRun(record)]);
  }
  const days: DayReport[] = [];
  for (let day = to; day >= from; day = addDays(day, -1)) {
    const verdicts = byDay.get(day) ?? [];
    const pick = (v: Verdict) => verdicts.filter((r) => r.verdict === v);
    const passed = verdicts.flatMap((v) => v.passedJobs);
    const base = { day, runs: verdicts.length, passedJobs: passed };
    if (verdicts.length === 0)
      days.push({ ...base, verdict: "void", reason: "no scheduled run" });
    else if (pick("pending").length > 0)
      days.push({
        ...base,
        verdict: "pending",
        reason: "a run is in progress",
      });
    else if (pick("red").length > 0)
      days.push({ ...base, verdict: "red", reason: pick("red")[0].reason });
    else if (pick("void").length > 0)
      days.push({ ...base, verdict: "void", reason: pick("void")[0].reason });
    else days.push({ ...base, verdict: "green", reason: "" });
  }
  return days;
}

export type Streak = {
  days: number;
  voids: number;
  /** Why counting stopped. */
  endedBy: "red" | "third void" | "window";
  lastGreen: string | null;
};

/** Walks `days` (newest first) and counts the streak per §1.6. */
export function computeStreak(days: readonly DayReport[]): Streak {
  let green = 0;
  let voids = 0;
  let lastGreen: string | null = null;
  for (const day of days) {
    if (day.verdict === "pending") continue;
    if (day.verdict === "red")
      return { days: green, voids, endedBy: "red", lastGreen };
    if (day.verdict === "void") {
      voids += 1;
      if (voids > 2)
        return { days: green, voids: 2, endedBy: "third void", lastGreen };
      continue;
    }
    green += 1;
    lastGreen ??= day.day;
  }
  return { days: green, voids, endedBy: "window", lastGreen };
}

const covers = (jobs: readonly string[], label: string) =>
  jobs.some((job) => job.toLowerCase().includes(label.toLowerCase()));

/** A gate's view of the days: green only when its job sets passed too. */
export function gateDays(gate: Gate, days: readonly DayReport[]): DayReport[] {
  return days.map((day) => {
    if (day.verdict !== "green") return day;
    const missing = gate.requires.filter((l) => !covers(day.passedJobs, l));
    return missing.length === 0
      ? day
      : { ...day, verdict: "void", reason: `missing ${missing.join(", ")}` };
  });
}

export type GateReport = {
  gate: Gate;
  /** Job sets that never ran in the window: the gate can't be met yet. */
  notRunning: string[];
  streak: Streak;
  met: boolean;
};

export function reportGates(
  days: readonly DayReport[],
  records: readonly RunRecord[],
  gates: readonly Gate[] = GATES,
): GateReport[] {
  const seen = records.flatMap((r) => r.attempts.flat().map((j) => j.name));
  return gates.map((gate) => {
    const notRunning = gate.requires.filter((l) => !covers(seen, l));
    const streak = computeStreak(gateDays(gate, days));
    return {
      gate,
      notRunning,
      streak,
      met: notRunning.length === 0 && streak.days >= gate.needs,
    };
  });
}

export type WorkflowStatus = { file: string; runs: number; found: boolean };

export function renderMarkdown(input: {
  today: string;
  workflows: readonly WorkflowStatus[];
  days: readonly DayReport[];
  gates: readonly GateReport[];
  showDays?: number;
}): string {
  const overall = computeStreak(input.days);
  const lines = [
    `## Nightly streak, ${input.today} (UTC)`,
    "",
    `Workflows: ${input.workflows
      .map((w) =>
        w.found
          ? `\`${w.file}\` (${w.runs} scheduled runs)`
          : `\`${w.file}\` (not on main yet)`,
      )
      .join(", ")}. Rules: test strategy §1.6.`,
    "",
    `Workflow-level streak (every gating job, no gate's job sets): ${overall.days} days, ${overall.voids} of 2 void days used, ended by ${overall.endedBy}.`,
    "",
    "| Gate | Needs | Streak | Void days used | Status |",
    "|---|---|---|---|---|",
  ];
  for (const { gate, notRunning, streak, met } of input.gates) {
    const status =
      notRunning.length > 0
        ? `not running yet: ${notRunning.join(", ")}`
        : met
          ? `met (last green ${streak.lastGreen})`
          : `not met (ended by ${streak.endedBy})`;
    lines.push(
      `| ${gate.name} | ${gate.needs} days | ${notRunning.length > 0 ? "n/a" : streak.days} | ${streak.voids} of 2 | ${status} |`,
    );
  }
  lines.push("", "| Day | Verdict | Runs | Reason |", "|---|---|---|---|");
  for (const day of input.days.slice(0, input.showDays ?? 14))
    lines.push(
      `| ${day.day} | ${day.verdict} | ${day.runs} | ${day.reason.replaceAll("|", "\\|")} |`,
    );
  return `${lines.join("\n")}\n`;
}

// ── gh adapter ─────────────────────────────────────────────────────────

type Gh = (args: string[]) => { ok: boolean; stdout: string; stderr: string };

const runGh: Gh = (args) => {
  const result = Bun.spawnSync(["gh", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    ok: result.exitCode === 0,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
};

const RUN_FIELDS =
  "databaseId,workflowName,createdAt,status,conclusion,attempt,url";

export function fetchRuns(
  gh: Gh,
  workflow: string,
  branch: string,
  limit: number,
): GhRun[] | null {
  const out = gh([
    "run",
    "list",
    "--workflow",
    workflow,
    "--branch",
    branch,
    "--event",
    "schedule",
    "--limit",
    String(limit),
    "--json",
    RUN_FIELDS,
  ]);
  if (!out.ok) {
    if (/could not find any workflows|not found/i.test(out.stderr)) return null;
    throw new Error(`gh run list ${workflow} failed: ${out.stderr.trim()}`);
  }
  return JSON.parse(out.stdout) as GhRun[];
}

export function fetchJobs(gh: Gh, runId: number, attempt: number): GhJob[] {
  const out = gh([
    "run",
    "view",
    String(runId),
    "--attempt",
    String(attempt),
    "--json",
    "jobs",
  ]);
  if (!out.ok)
    throw new Error(`gh run view ${runId} failed: ${out.stderr.trim()}`);
  const { jobs } = JSON.parse(out.stdout) as { jobs: GhJob[] };
  return jobs.map(({ name, conclusion, steps }) => ({
    name,
    conclusion,
    steps: (steps ?? []).map((s) => ({
      name: s.name,
      conclusion: s.conclusion,
    })),
  }));
}

export function collect(
  gh: Gh,
  options: { branch: string; from: string },
): { records: RunRecord[]; workflows: WorkflowStatus[] } {
  const records: RunRecord[] = [];
  const workflows: WorkflowStatus[] = [];
  for (const file of GATING_WORKFLOWS) {
    const runs = fetchRuns(gh, file, options.branch, 200);
    if (runs === null) {
      workflows.push({ file, runs: 0, found: false });
      continue;
    }
    const inWindow = runs.filter((r) => utcDay(r.createdAt) >= options.from);
    workflows.push({ file, runs: inWindow.length, found: true });
    for (const run of inWindow) {
      const attempts =
        run.status !== "completed"
          ? []
          : run.attempt >= 2
            ? [
                fetchJobs(gh, run.databaseId, 1),
                fetchJobs(gh, run.databaseId, 2),
              ]
            : [fetchJobs(gh, run.databaseId, 1)];
      records.push({ run, attempts });
    }
  }
  return { records, workflows };
}

export function main(argv: string[], gh: Gh = runGh, now = new Date()): number {
  const { values } = parseArgs({
    args: argv,
    options: {
      days: { type: "string", default: "30" },
      branch: { type: "string", default: "main" },
      json: { type: "boolean" },
    },
    strict: true,
  });
  const window = Number(values.days);
  if (!Number.isInteger(window) || window < 1) {
    console.error("--days must be a positive integer");
    return 2;
  }
  const today = now.toISOString().slice(0, 10);
  const yesterday = addDays(today, -1);
  const from = addDays(today, -window);
  const { records, workflows } = collect(gh, { branch: values.branch, from });
  // Today is still running: shown, never counted.
  const days = classifyDays(records, from, yesterday);
  const gates = reportGates(days, records);
  if (values.json)
    console.log(JSON.stringify({ today, workflows, days, gates }, null, 2));
  else console.log(renderMarkdown({ today, workflows, days, gates }));
  return 0;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
