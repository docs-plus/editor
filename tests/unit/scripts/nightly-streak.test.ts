import { describe, expect, it, spyOn } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { parse } from "yaml";

import {
  classifyDays,
  classifyJobs,
  classifyRun,
  collect,
  computeStreak,
  type DayReport,
  GATES,
  GATING_WORKFLOWS,
  type GhJob,
  type GhRun,
  gateDays,
  isSetupStep,
  main,
  type RunRecord,
  renderMarkdown,
  reportGates,
  runLimit,
  SETUP_STEPS,
} from "@/scripts/nightly-streak";

const SETUP = ["Set up job", "Checkout", "Set up Bun", "Install"];

function job(
  name: string,
  conclusion: string,
  failingStep?: string,
  stepConclusion = "failure",
): GhJob {
  const steps = SETUP.map((s) => ({ name: s, conclusion: "success" }));
  if (failingStep) {
    const at = steps.findIndex((s) => s.name === failingStep);
    if (at >= 0) {
      steps[at].conclusion = stepConclusion;
      steps.splice(at + 1);
    } else steps.push({ name: failingStep, conclusion: stepConclusion });
  } else steps.push({ name: "Run tests", conclusion: "success" });
  return { name, conclusion, steps };
}

const GATE_JOBS = [
  "Desktop storage soak (T1–T8) / T1 kill during append (ubuntu-24.04)",
  "Durability (T16–T18) / T16 (ubuntu-24.04)",
  "Durability (T9–T15) / T9 (ubuntu-24.04)",
  "Durability (T19) / T19 (ubuntu-24.04)",
  "library-soak",
];

const green = (names = GATE_JOBS) => names.map((n) => job(n, "success"));

let nextId = 1;
function record(
  createdAt: string,
  conclusion: string | null,
  attempts: GhJob[][],
  extra: Partial<GhRun> = {},
  workflow = "nightly.yml",
): RunRecord {
  return {
    workflow,
    run: {
      databaseId: nextId++,
      workflowName: "Nightly",
      createdAt,
      status: "completed",
      conclusion,
      attempt: attempts.length || 1,
      url: "https://example.invalid/run",
      ...extra,
    },
    attempts,
  };
}

function day(
  d: string,
  verdict: DayReport["verdict"],
  passed = GATE_JOBS,
): DayReport {
  return {
    day: d,
    verdict,
    runs: 1,
    reason: "",
    jobs: passed.map((name) => ({ name, success: true })),
  };
}

describe("classifyJobs", () => {
  it("is red when a failed job's first failing step is a test step", () => {
    expect(
      classifyJobs([
        job("soak", "failure", "Single-user soak"),
        job("pwa", "success"),
      ]),
    ).toEqual({ verdict: "red", reason: "soak › Single-user soak" });
  });

  it("is red for a timeout inside a test step", () => {
    expect(
      classifyJobs([
        job("soak", "cancelled", "Run the pwa project", "cancelled"),
      ]).verdict,
    ).toBe("red");
  });

  it("is void when every failure is in setup or lost its runner", () => {
    expect(classifyJobs([job("pwa", "failure", "Install")])).toEqual({
      verdict: "void",
      reason: "setup: pwa › Install",
    });
    expect(
      classifyJobs([{ name: "mac", conclusion: "failure", steps: [] }]).verdict,
    ).toBe("void");
  });

  it("voids a cleanup or upload step that fails after green tests", () => {
    const post = job("soak", "failure");
    post.steps.push({ name: "Post Checkout", conclusion: "failure" });
    expect(classifyJobs([post]).verdict).toBe("void");
    const upload = job("soak", "failure");
    upload.steps.push({ name: "Upload results", conclusion: "failure" });
    expect(classifyJobs([upload]).verdict).toBe("void");
  });

  it("reads a broken build or server start as red, not setup", () => {
    for (const step of ["Production build", "Start servers", "Typecheck"])
      expect(classifyJobs([job("pwa", "failure", step)]).verdict).toBe("red");
  });

  it("lets one red job outweigh setup failures elsewhere", () => {
    expect(
      classifyJobs([
        job("a", "failure", "Checkout"),
        job("b", "failure", "Run tests"),
      ]).verdict,
    ).toBe("red");
  });
});

describe("classifyRun", () => {
  it("green on success, void when the run was cancelled, pending while running", () => {
    expect(
      classifyRun(record("2026-11-20T04:00:00Z", "success", [green()])).verdict,
    ).toBe("green");
    expect(
      classifyRun(record("2026-11-20T04:00:00Z", "cancelled", [[]])).verdict,
    ).toBe("void");
    expect(
      classifyRun(
        record("2026-11-20T04:00:00Z", null, [], { status: "in_progress" }),
      ).verdict,
    ).toBe("pending");
  });

  it("lets a re-run decide only after a void first attempt", () => {
    const voidFirst = [job("pwa", "failure", "Install")];
    const redFirst = [job("pwa", "failure", "Run tests")];
    expect(
      classifyRun(
        record("2026-11-20T04:00:00Z", "success", [voidFirst, green()]),
      ).verdict,
    ).toBe("green");
    const rescued = classifyRun(
      record("2026-11-20T04:00:00Z", "success", [redFirst, green()]),
    );
    expect(rescued.verdict).toBe("red");
    expect(rescued.reason).toContain("re-run doesn't clear red");
  });

  it("reads attempt 2 of a 'Re-run failed jobs' as the whole run", () => {
    // GitHub's shape (runs 43923051757, 44061357387): attempt 2 lists every
    // job; the ones not re-run are carried over with their attempt-1 result.
    const lostRunner: GhJob = {
      name: "Desktop storage soak (T1–T8) / T1 (macos-26)",
      conclusion: "cancelled",
      steps: [],
    };
    const carried = green(GATE_JOBS.slice(1));
    const rescued = classifyRun(
      record("2026-11-20T04:00:00Z", "success", [
        [lostRunner, ...carried],
        [job(lostRunner.name, "success"), ...carried],
      ]),
    );
    expect(rescued.verdict).toBe("green");
    expect(rescued.jobs.map((j) => j.name).sort()).toEqual(
      [lostRunner.name, ...GATE_JOBS.slice(1)].sort(),
    );
    // A failure that wasn't re-run is carried into attempt 2 and still counts.
    const setupFailure = job("pwa", "failure", "Install");
    const stillVoid = classifyRun(
      record("2026-11-20T04:00:00Z", "failure", [
        [lostRunner, setupFailure],
        [job(lostRunner.name, "success"), setupFailure],
      ]),
    );
    expect(stillVoid).toMatchObject({
      verdict: "void",
      reason: "setup: pwa › Install",
    });
  });

  it("ignores attempts after the second", () => {
    const voidFirst = [job("pwa", "failure", "Install")];
    const redSecond = [job("pwa", "failure", "Run tests")];
    const verdict = classifyRun(
      record("2026-11-20T04:00:00Z", "success", [voidFirst, redSecond], {
        attempt: 3,
      }),
    );
    expect(verdict.verdict).toBe("red");
    expect(verdict.reason).toContain("attempts after the 2nd ignored");
  });
});

describe("classifyDays", () => {
  it("groups by UTC day, newest first, and voids days with no run", () => {
    const days = classifyDays(
      [
        record("2026-11-20T03:50:00Z", "success", [green()]),
        record("2026-11-20T15:58:00Z", "failure", [
          [job("soak", "failure", "Soak")],
        ]),
        record("2026-11-18T23:59:00Z", "success", [green()]),
      ],
      "2026-11-18",
      "2026-11-20",
    );
    expect(days.map((d) => [d.day, d.verdict, d.runs])).toEqual([
      ["2026-11-20", "red", 2],
      ["2026-11-19", "void", 0],
      ["2026-11-18", "green", 1],
    ]);
    expect(days[1].reason).toBe("no scheduled run");
  });

  it("voids a day when a gating workflow has no run, from its first run on", () => {
    const records = [
      record("2026-11-20T04:00:00Z", "success", [green()]),
      record("2026-11-19T04:00:00Z", "success", [green()]),
      record("2026-11-19T05:00:00Z", "success", [green()], {}, "b.yml"),
      record("2026-11-18T04:00:00Z", "success", [green()]),
    ];
    const days = classifyDays(records, "2026-11-18", "2026-11-20", [
      { file: "nightly.yml", since: "2026-11-01" },
      { file: "b.yml", since: "2026-11-19" },
      { file: "never.yml", since: null },
    ]);
    expect(days.map((d) => [d.day, d.verdict, d.reason])).toEqual([
      ["2026-11-20", "void", "no scheduled run of b.yml"],
      ["2026-11-19", "green", ""],
      // Before b.yml's first run: it can't be missing yet.
      ["2026-11-18", "green", ""],
    ]);
  });

  it("is void when one run is void and none is red", () => {
    const [d] = classifyDays(
      [
        record("2026-11-20T03:50:00Z", "success", [green()]),
        record("2026-11-20T09:00:00Z", "failure", [
          [job("x", "failure", "Install")],
        ]),
      ],
      "2026-11-20",
      "2026-11-20",
    );
    expect(d.verdict).toBe("void");
  });
});

describe("computeStreak", () => {
  it("counts green days back until a red day", () => {
    const streak = computeStreak([
      day("2026-11-21", "green"),
      day("2026-11-20", "green"),
      day("2026-11-19", "red"),
      day("2026-11-18", "green"),
    ]);
    expect(streak).toEqual({
      days: 2,
      voids: 0,
      endedBy: "red",
      lastGreen: "2026-11-21",
    });
  });

  it("lets two void days through and resets on the third", () => {
    const days = [
      day("2026-11-21", "green"),
      day("2026-11-20", "void"),
      day("2026-11-19", "green"),
      day("2026-11-18", "void"),
      day("2026-11-17", "green"),
      day("2026-11-16", "void"),
      day("2026-11-15", "green"),
    ];
    expect(computeStreak(days)).toMatchObject({
      days: 3,
      voids: 2,
      endedBy: "third void",
    });
  });

  it("stops at the window edge", () => {
    expect(computeStreak([day("2026-11-21", "green")]).endedBy).toBe("window");
  });
});

describe("gates", () => {
  it("defines the §1.6 thresholds over both gating workflows", () => {
    expect(GATING_WORKFLOWS).toEqual(["nightly.yml", "nightly-desktop.yml"]);
    expect(GATES.map((g) => [g.name, g.needs])).toEqual([
      ["Gate 2", 5],
      ["Gate 3", 7],
      ["Gate 5", 7],
    ]);
  });

  it("reports a gate as not running yet when a job set never ran", () => {
    const records = [
      record("2026-11-20T04:00:00Z", "success", [
        green([
          "Desktop storage soak (T1–T8) / T1 kill during append (macos-26)",
        ]),
      ]),
    ];
    const days = classifyDays(records, "2026-11-20", "2026-11-20");
    const [gate2, , gate5] = reportGates(days, records);
    expect(gate2.notRunning).toEqual(["T16–T18"]);
    expect(gate2.met).toBe(false);
    expect(gate5.notRunning).toEqual([
      "T9–T15",
      "T16–T18",
      "T19",
      "library-soak",
    ]);
  });

  it("meets Gate 2 after 5 green days with every job set", () => {
    const records = ["16", "17", "18", "19", "20"].map((d) =>
      record(`2026-11-${d}T04:00:00Z`, "success", [green()]),
    );
    const days = classifyDays(records, "2026-11-16", "2026-11-20");
    const [gate2, gate3] = reportGates(days, records);
    expect(gate2).toMatchObject({ met: true, streak: { days: 5 } });
    expect(gate3.met).toBe(false);
  });

  it("never counts a skipped job set as passed", () => {
    const skippedT19 = green().map((j) =>
      j.name.includes("T19") ? { ...j, conclusion: "skipped" } : j,
    );
    const records = [
      record("2026-11-20T04:00:00Z", "success", [skippedT19]),
      // Seen once, so Gate 5 isn't "not running yet".
      record("2026-11-19T04:00:00Z", "success", [green()]),
    ];
    const days = classifyDays(records, "2026-11-20", "2026-11-20");
    // The run itself is green: a skipped job doesn't fail it.
    expect(days[0].verdict).toBe("green");
    const gate5 = GATES[2];
    expect(gateDays(gate5, days)[0]).toMatchObject({
      verdict: "void",
      reason: "missing T19",
    });
    const report = reportGates(days, records)[2];
    expect(report.notRunning).toEqual([]);
    expect(report.streak).toMatchObject({ days: 0, voids: 1 });
  });

  it("voids a set when one matrix leg was skipped beside passing legs", () => {
    const legs = [
      job("Desktop storage soak (T1–T8) / T1 (ubuntu-24.04)", "success"),
      job("Desktop storage soak (T1–T8) / T1 (macos-26)", "skipped"),
    ];
    const records = [
      record("2026-11-20T04:00:00Z", "success", [
        [...legs, ...green(GATE_JOBS.slice(1))],
      ]),
    ];
    const days = classifyDays(records, "2026-11-20", "2026-11-20");
    const [gate2] = reportGates(days, records);
    expect(gate2.streak).toMatchObject({ days: 0, voids: 1 });
  });

  it("voids a gate's day when its jobs didn't run that day", () => {
    const records = [
      record("2026-11-20T04:00:00Z", "success", [green()]),
      record("2026-11-19T04:00:00Z", "success", [green(GATE_JOBS.slice(0, 1))]),
    ];
    const days = classifyDays(records, "2026-11-19", "2026-11-20");
    const [gate2] = reportGates(days, records);
    expect(gate2.streak).toMatchObject({ days: 1, voids: 1 });
  });
});

describe("renderMarkdown", () => {
  it("prints the gate table and the days for the pinned issue", () => {
    const records = [record("2026-11-20T04:00:00Z", "success", [green()])];
    const days = classifyDays(records, "2026-11-20", "2026-11-20");
    const md = renderMarkdown({
      today: "2026-11-21",
      workflows: [
        { file: "nightly.yml", runs: 1, found: true, since: "2026-11-20" },
        { file: "nightly-desktop.yml", runs: 0, found: false, since: null },
      ],
      days,
      gates: reportGates(days, records),
    });
    expect(md).toContain("## Nightly streak, 2026-11-21 (UTC)");
    expect(md).toContain("`nightly-desktop.yml` (not on main yet)");
    expect(md).toContain(
      "Workflow-level streak (every gating job, no gate's job sets): 1 days",
    );
    expect(md).toContain(
      "| Gate 2 | 5 days | 1 | 0 of 2 | not met (ended by window) |",
    );
    expect(md).toContain("| 2026-11-20 | green | 1 |  |");
  });
});

describe("main (gh adapter)", () => {
  it("reads both workflows, tolerates a missing one and counts from yesterday", () => {
    const calls: string[][] = [];
    const gh = (args: string[]) => {
      calls.push(args);
      if (args[0] === "run" && args[1] === "list") {
        if (args[3] === "nightly-desktop.yml")
          return {
            ok: false,
            stdout: "",
            stderr: "could not find any workflows named nightly-desktop.yml",
          };
        return {
          ok: true,
          stderr: "",
          stdout: JSON.stringify([
            {
              databaseId: 11,
              workflowName: "Nightly",
              createdAt: "2026-11-21T04:00:00Z",
              status: "completed",
              conclusion: "success",
              attempt: 1,
              url: "u",
            },
            {
              databaseId: 12,
              workflowName: "Nightly",
              createdAt: "2026-11-22T04:00:00Z",
              status: "completed",
              conclusion: "failure",
              attempt: 1,
              url: "u",
            },
          ]),
        };
      }
      return {
        ok: true,
        stderr: "",
        stdout: JSON.stringify({ jobs: green() }),
      };
    };
    const log = spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(main(["--days", "3"], gh, new Date("2026-11-22T12:00:00Z"))).toBe(
        0,
      );
      const md = String(log.mock.calls[0]?.[0]);
      expect(md).toContain("| 2026-11-21 | green | 1 |");
      expect(md).not.toContain("| 2026-11-22 |");
      expect(md).toContain("`nightly-desktop.yml` (not on main yet)");
    } finally {
      log.mockRestore();
    }
    expect(
      calls.every((c) => c[0] === "run" && ["list", "view"].includes(c[1])),
    ).toBe(true);
  });
});

describe("main errors", () => {
  it("prints one line and exits 1 when gh can't start", () => {
    const gh = () => ({
      ok: false,
      stdout: "",
      stderr: "",
      spawnError: "could not run gh (Executable not found in $PATH: gh)",
    });
    const error = spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(main([], gh, new Date("2026-11-22T12:00:00Z"))).toBe(1);
      expect(String(error.mock.calls[0]?.[0])).toContain("could not run gh");
    } finally {
      error.mockRestore();
    }
  });
});

describe("collect", () => {
  const run = (id: number, createdAt: string): GhRun => ({
    databaseId: id,
    workflowName: "Nightly",
    createdAt,
    status: "completed",
    conclusion: "success",
    attempt: 1,
    url: "u",
  });

  function fakeGh(runs: GhRun[]) {
    const calls: string[][] = [];
    const gh = (args: string[]) => {
      calls.push(args);
      if (args[1] === "list")
        return args[3] === "nightly.yml"
          ? { ok: true, stderr: "", stdout: JSON.stringify(runs) }
          : { ok: false, stdout: "", stderr: "HTTP 404: Not Found" };
      return { ok: true, stderr: "", stdout: JSON.stringify({ jobs: [] }) };
    };
    return { gh, calls };
  }

  it("fetches enough runs for long windows", () => {
    expect(runLimit(30)).toBe(200);
    expect(runLimit(120)).toBe(480);
    const { gh, calls } = fakeGh([]);
    collect(gh, { branch: "main", from: "2026-07-01", limit: runLimit(120) });
    expect(calls[0]).toContain("480");
  });

  it("keys records by workflow file and dates each workflow's first run", () => {
    const { gh } = fakeGh([
      run(2, "2026-11-21T04:00:00Z"),
      run(1, "2026-11-10T04:00:00Z"),
    ]);
    const { records, workflows } = collect(gh, {
      branch: "main",
      from: "2026-11-15",
      limit: 200,
    });
    expect(records.map((r) => r.workflow)).toEqual(["nightly.yml"]);
    expect(workflows).toEqual([
      { file: "nightly.yml", runs: 1, found: true, since: "2026-11-10" },
      { file: "nightly-desktop.yml", runs: 0, found: false, since: null },
    ]);
  });

  it("warns when the run list was cut short inside the window", () => {
    const { gh } = fakeGh([
      run(2, "2026-11-21T04:00:00Z"),
      run(1, "2026-11-20T04:00:00Z"),
    ]);
    const error = spyOn(console, "error").mockImplementation(() => {});
    try {
      const { workflows } = collect(gh, {
        branch: "main",
        from: "2026-11-01",
        limit: 2,
      });
      expect(String(error.mock.calls[0]?.[0])).toContain(
        "more than 2 scheduled runs",
      );
      // Truncated: the workflow is required for the whole window.
      expect(workflows[0].since).toBe("2026-11-01");
    } finally {
      error.mockRestore();
    }
  });
});

/**
 * Steps of the gating workflows that are tests (a failure reads red). With
 * `SETUP_STEPS`, every step must be in exactly one list: a new step fails
 * this test until someone decides which.
 */
const TEST_STEPS = [
  "Production build",
  "Start servers",
  "Start dev servers",
  "Start Hocuspocus",
  "Desktop export",
  "Web-only files are back in app/",
  "Audit dependencies",
  "Audit the harness dependencies",
  "Typecheck",
  "Build",
  "Typecheck and build the harness",
  "Run the pwa project",
  "Run the desktop project",
  "Palette budget",
  "Yjs reconnection and rapid tab switch",
  "Multi-user soak (30 s, 3 users)",
  "Single-user soak (5 min, 50 headings)",
  "Distributed edits (100 clients, 30 s)",
  "Conflicting edits (100 clients, 30 s)",
  "Alternating colour soak (50,000 toggles, 3 clients)",
  "Mixed-version soak (300 rounds per phase)",
  "Smoke",
  "Soak",
];

/** GitHub adds these to every job; no workflow file names them. */
const GITHUB_STEPS = ["Set up job", "Complete job"];

type WorkflowFile = {
  jobs: Record<
    string,
    { uses?: string; steps?: { name?: string; uses?: string; run?: string }[] }
  >;
};

function gatingWorkflowSteps(): { file: string; steps: (string | null)[] }[] {
  const dir = join(process.cwd(), ".github", "workflows");
  const files = new Set<string>(
    GATING_WORKFLOWS.filter((f) => existsSync(join(dir, f))),
  );
  const out: { file: string; steps: (string | null)[] }[] = [];
  for (const file of files) {
    const workflow = parse(
      readFileSync(join(dir, file), "utf8"),
    ) as WorkflowFile;
    const steps: (string | null)[] = [];
    for (const job of Object.values(workflow.jobs)) {
      // Reusable workflows the gating ones call run under their names.
      const local = job.uses?.match(/^\.\/\.github\/workflows\/(.+)$/)?.[1];
      if (local) files.add(local);
      for (const step of job.steps ?? []) steps.push(step.name ?? null);
    }
    out.push({ file, steps });
  }
  return out;
}

describe("step classification guard", () => {
  const workflows = gatingWorkflowSteps();
  const named = workflows.flatMap((w) => w.steps.filter((s) => s !== null));

  it("reads the gating workflows and the reusable ones they call", () => {
    expect(workflows.map((w) => w.file)).toEqual(
      expect.arrayContaining([
        "nightly.yml",
        "desktop-storage-soak.yml",
        "desktop-smoke.yml",
      ]),
    );
  });

  it("names every step (an unnamed step can't be classified)", () => {
    for (const { file, steps } of workflows)
      expect({ file, unnamed: steps.filter((s) => s === null).length }).toEqual(
        { file, unnamed: 0 },
      );
  });

  it("puts every step in exactly one of setup and test", () => {
    const unclassified = [...new Set(named)].filter(
      (name) => isSetupStep(name) === TEST_STEPS.includes(name),
    );
    expect(unclassified).toEqual([]);
  });

  it("lists no setup step that no workflow has", () => {
    const stale = SETUP_STEPS.filter(
      (name) => !GITHUB_STEPS.includes(name) && !named.includes(name),
    );
    expect(stale).toEqual([]);
    expect(TEST_STEPS.filter((name) => !named.includes(name))).toEqual([]);
  });
});
