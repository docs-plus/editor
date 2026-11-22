import { describe, expect, it, spyOn } from "bun:test";

import {
  classifyDays,
  classifyJobs,
  classifyRun,
  computeStreak,
  type DayReport,
  GATES,
  GATING_WORKFLOWS,
  type GhJob,
  type GhRun,
  main,
  type RunRecord,
  renderMarkdown,
  reportGates,
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
): RunRecord {
  return {
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
  return { day: d, verdict, runs: 1, reason: "", passedJobs: passed };
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
        { file: "nightly.yml", runs: 1, found: true },
        { file: "nightly-desktop.yml", runs: 0, found: false },
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
