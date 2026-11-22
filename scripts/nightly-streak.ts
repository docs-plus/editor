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
 *   void when every failed job broke in a setup step ({@link isSetupStep})
 *   or lost its runner (no failing step recorded).
 * - **Re-runs.** One manual re-run is allowed per void run: attempt 2 then
 *   decides. A re-run never rescues a red first attempt, and attempts after
 *   the second are ignored. GitHub lists every job in attempt 2, the ones
 *   not re-run carried over with their attempt-1 result (checked on real
 *   "Re-run failed jobs" runs, 2026-11-22), so attempt 2 alone holds the
 *   run's jobs.
 * - **Day verdict** (UTC, by the run's creation time): red if any run is
 *   red, else void if any run is void, else green. A day with no scheduled
 *   run at all (GitHub drops crons now and then) is void, never green, and
 *   so is a day when one gating workflow has no scheduled run, from the
 *   day of that workflow's first scheduled run on.
 * - **Streak.** Consecutive green days back from yesterday (today is still
 *   running); a red day ends it, and so does a third void day.
 * - **Gates.** A gate counts a green day only if every job set it needs
 *   ran and passed that day: a job counts towards a set when its name
 *   contains the set's label (`Desktop storage soak (T1–T8) / …` → `T1–T8`),
 *   and the set passed only when every such job finished `success` (a
 *   skipped job or matrix leg didn't run, so it never counts).
 *   A set that never ran in the window reports the gate as not running yet.
 */
import { parseArgs } from "node:util";

export const GATING_WORKFLOWS = ["nightly.yml", "nightly-desktop.yml"] as const;

/**
 * Infrastructure steps: a failure there voids the run (§1.6). Every other
 * step of a gating job is a test step and reads red, builds, server starts
 * and audits included (a broken build on `main` is a product failure, not
 * an outage). `tests/unit/scripts/nightly-streak.test.ts` reads every step
 * of the gating workflows and fails on one that is in neither list, so a
 * new step needs a decision here.
 */
export const SETUP_STEPS: readonly string[] = [
  // GitHub's own steps around every job.
  "Set up job",
  "Complete job",
  // Toolchain and dependency downloads.
  "Checkout",
  "Set up Bun",
  "Install",
  "Install Chromium",
  "Block Node.js",
  "Block Node.js (node.exe on Windows)",
  "Allow the Chromium sandbox (electron/electron#42510)",
  // Artifact uploads: they run after the tests and carry no verdict.
  "Upload failure artifacts",
  "Upload results",
  "Upload server log",
  "Upload server log and report",
  "Upload test results",
  "Upload the installers",
  // Moving the exported renderer between jobs of the desktop shell workflow.
  "Upload out/",
  "Download out/",
];

/** GitHub's cleanup steps (`Post Checkout`, `Post Set up Bun`, …). */
const POST_STEP = /^Post /;

export function isSetupStep(name: string): boolean {
  return SETUP_STEPS.includes(name) || POST_STEP.test(name);
}

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
  /** The workflow file (`nightly.yml`); `run.workflowName` is its title. */
  workflow: string;
  run: GhRun;
  attempts: GhJob[][];
};

export type Verdict = "green" | "red" | "void" | "pending";

/** A job of the deciding attempt; only `success` counts for a gate. */
export type JobOutcome = { name: string; success: boolean };

export type RunVerdict = {
  verdict: Verdict;
  reason: string;
  /** Jobs of the deciding attempt, for gate coverage. */
  jobs: JobOutcome[];
};

/** Didn't fail: enough for a run verdict. Gates need `success` itself. */
const NOT_FAILED = new Set(["success", "skipped", "neutral"]);

function passed(conclusion: string | null): boolean {
  return conclusion !== null && NOT_FAILED.has(conclusion);
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
    if (step && !isSetupStep(step.name))
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

function outcomes(jobs: readonly GhJob[] | undefined): JobOutcome[] {
  return (jobs ?? []).map((job) => ({
    name: job.name,
    success: job.conclusion === "success",
  }));
}

export function classifyRun({ run, attempts }: RunRecord): RunVerdict {
  if (run.status !== "completed")
    return { verdict: "pending", reason: run.status, jobs: [] };
  const [first, second] = attempts;
  if (run.attempt <= 1) {
    if (run.conclusion === "success")
      return { verdict: "green", reason: "", jobs: outcomes(first) };
    if (run.conclusion === "cancelled" || run.conclusion === "skipped")
      return {
        verdict: "void",
        reason: `run ${run.conclusion}`,
        jobs: [],
      };
    return { ...classifyJobs(first ?? []), jobs: outcomes(first) };
  }
  // Re-run: the first attempt decides unless it was void.
  if (first && first.length > 0 && first.every((job) => passed(job.conclusion)))
    return { verdict: "green", reason: "", jobs: outcomes(first) };
  const firstVerdict = classifyJobs(first ?? []);
  if (firstVerdict.verdict === "red")
    return {
      verdict: "red",
      reason: `${firstVerdict.reason} (attempt 1; a re-run doesn't clear red)`,
      jobs: [],
    };
  const decidingIsLatest = run.attempt === 2;
  if (decidingIsLatest && run.conclusion === "success")
    return {
      verdict: "green",
      reason: "re-run after a void attempt",
      jobs: outcomes(second),
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
    jobs: outcomes(second),
  };
}

export type DayReport = {
  day: string;
  verdict: Verdict;
  runs: number;
  reason: string;
  /** Jobs of every run that day, for gate coverage. */
  jobs: JobOutcome[];
};

export function utcDay(iso: string): string {
  return iso.slice(0, 10);
}

function addDays(day: string, delta: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

/** A gating workflow a day needs a run of, from its first scheduled run. */
export type RequiredWorkflow = { file: string; since: string | null };

/**
 * One report per UTC day from `from` to `to` (inclusive), newest first.
 * Days with no run are void, and so are days missing a run of a workflow in
 * `required` (on or after its `since` day).
 */
export function classifyDays(
  records: readonly RunRecord[],
  from: string,
  to: string,
  required: readonly RequiredWorkflow[] = [],
): DayReport[] {
  const byDay = new Map<string, RunVerdict[]>();
  const workflowsByDay = new Map<string, Set<string>>();
  for (const record of records) {
    const day = utcDay(record.run.createdAt);
    byDay.set(day, [...(byDay.get(day) ?? []), classifyRun(record)]);
    const ran = workflowsByDay.get(day) ?? new Set<string>();
    ran.add(record.workflow);
    workflowsByDay.set(day, ran);
  }
  const days: DayReport[] = [];
  for (let day = to; day >= from; day = addDays(day, -1)) {
    const verdicts = byDay.get(day) ?? [];
    const pick = (v: Verdict) => verdicts.filter((r) => r.verdict === v);
    const jobs = verdicts.flatMap((v) => v.jobs);
    const base = { day, runs: verdicts.length, jobs };
    const ran = workflowsByDay.get(day) ?? new Set<string>();
    const absent = required
      .filter((w) => w.since !== null && day >= w.since && !ran.has(w.file))
      .map((w) => w.file);
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
    else if (absent.length > 0)
      days.push({
        ...base,
        verdict: "void",
        reason: `no scheduled run of ${absent.join(", ")}`,
      });
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

const carries = (job: string, label: string) =>
  job.toLowerCase().includes(label.toLowerCase());

const covers = (jobs: readonly string[], label: string) =>
  jobs.some((job) => carries(job, label));

/** A set passed when it has jobs and every one of them finished `success`. */
function setPassed(jobs: readonly JobOutcome[], label: string): boolean {
  const labelled = jobs.filter((job) => carries(job.name, label));
  return labelled.length > 0 && labelled.every((job) => job.success);
}

/** A gate's view of the days: green only when its job sets passed too. */
export function gateDays(gate: Gate, days: readonly DayReport[]): DayReport[] {
  return days.map((day) => {
    if (day.verdict !== "green") return day;
    const missing = gate.requires.filter((l) => !setPassed(day.jobs, l));
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

export type WorkflowStatus = {
  file: string;
  runs: number;
  found: boolean;
  /** UTC day of its first scheduled run (the window start if truncated). */
  since: string | null;
};

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

type GhResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
  /** Set when `gh` could not start at all (not installed, not on PATH). */
  spawnError?: string;
};
type Gh = (args: string[]) => GhResult;

const runGh: Gh = (args) => {
  try {
    const result = Bun.spawnSync(["gh", ...args], {
      stdout: "pipe",
      stderr: "pipe",
    });
    return {
      ok: result.exitCode === 0,
      stdout: result.stdout.toString(),
      stderr: result.stderr.toString(),
    };
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      stdout: "",
      stderr: "",
      spawnError: `could not run gh (${why}); install the GitHub CLI and run gh auth login`,
    };
  }
};

/** Runs `gh`, throwing a one-line error when it could not start. */
function callGh(gh: Gh, args: string[]): GhResult {
  const out = gh(args);
  if (out.spawnError) throw new Error(out.spawnError);
  return out;
}

const RUN_FIELDS =
  "databaseId,workflowName,createdAt,status,conclusion,attempt,url";

export function fetchRuns(
  gh: Gh,
  workflow: string,
  branch: string,
  limit: number,
): GhRun[] | null {
  const out = callGh(gh, [
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
  const out = callGh(gh, [
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

/** Runs to fetch for a window of `days`: two crons a day, with room. */
export function runLimit(days: number): number {
  return Math.max(200, days * 4);
}

export function collect(
  gh: Gh,
  options: { branch: string; from: string; limit: number },
): { records: RunRecord[]; workflows: WorkflowStatus[] } {
  const records: RunRecord[] = [];
  const workflows: WorkflowStatus[] = [];
  for (const file of GATING_WORKFLOWS) {
    const runs = fetchRuns(gh, file, options.branch, options.limit);
    if (runs === null) {
      workflows.push({ file, runs: 0, found: false, since: null });
      continue;
    }
    const inWindow = runs.filter((r) => utcDay(r.createdAt) >= options.from);
    const earliest = runs.map((r) => utcDay(r.createdAt)).sort()[0] ?? null;
    // A full page whose oldest run is still inside the window was cut
    // short: older days would read "no scheduled run" when they had one.
    const truncated =
      runs.length >= options.limit &&
      earliest !== null &&
      earliest > options.from;
    if (truncated)
      console.error(
        `warning: ${file} has more than ${options.limit} scheduled runs; days before ${earliest} may be missing runs`,
      );
    workflows.push({
      file,
      runs: inWindow.length,
      found: true,
      since: truncated ? options.from : earliest,
    });
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
      records.push({ workflow: file, run, attempts });
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
  let collected: ReturnType<typeof collect>;
  try {
    collected = collect(gh, {
      branch: values.branch,
      from,
      limit: runLimit(window),
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
  const { records, workflows } = collected;
  // Today is still running: shown, never counted.
  const days = classifyDays(records, from, yesterday, workflows);
  const gates = reportGates(days, records);
  if (values.json)
    console.log(JSON.stringify({ today, workflows, days, gates }, null, 2));
  else console.log(renderMarkdown({ today, workflows, days, gates }));
  return 0;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
