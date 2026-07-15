import { describe, expect, it } from "vitest";
import {
  GATE0_OPCODES,
  buildMotionProject,
  buildRepeatProject,
  buildIfGotoxyProject,
  buildLooksAndOperatorsProject,
  createAdapter,
  loadProjectJson,
  type RuntimeSnapshot,
} from "./index.js";

function fingerprint(s: RuntimeSnapshot): string {
  const vars: Record<string, number | string> = {};
  for (const [k, v] of Object.entries(s.variables)) {
    vars[k] =
      typeof v === "string" && v !== "" && !Number.isNaN(Number(v))
        ? Number(v)
        : v;
  }
  return JSON.stringify({ targets: s.targets, variables: vars });
}

async function stepUntilIdle(
  adapter: Awaited<ReturnType<typeof createAdapter>>,
  max = 80,
): Promise<RuntimeSnapshot> {
  let last = adapter.observe();
  for (let i = 0; i < max; i++) {
    last = await adapter.stepVisual();
    if ((adapter.vm.runtime.threads ?? []).length === 0) break;
  }
  return last;
}

describe("GATE0_OPCODES coverage table", () => {
  it("declares exactly the ten Gate 0 opcodes", () => {
    expect([...GATE0_OPCODES].sort()).toEqual(
      [
        "control_if",
        "control_repeat",
        "data_setvariableto",
        "data_variable",
        "event_whenflagclicked",
        "looks_say",
        "motion_gotoxy",
        "motion_movesteps",
        "operator_add",
        "operator_equals",
      ].sort(),
    );
  });

  const cases: Array<{
    name: string;
    opcodes: readonly string[];
    project: () => Record<string, unknown>;
    expectFinal: (s: RuntimeSnapshot) => void;
    /** After N visual steps from a fresh greenFlag session */
    boundarySteps: Array<{
      afterStep: number;
      currentBlockId: string | null;
      x?: number;
      y?: number;
      score?: number;
    }>;
  }> = [
    {
      name: "hat + set + move (event/data/motion)",
      opcodes: [
        "event_whenflagclicked",
        "data_setvariableto",
        "motion_movesteps",
      ],
      project: () => buildMotionProject({ steps: 10, variableValue: "5" }),
      expectFinal: (s) => {
        expect(s.targets[0]?.x).toBe(10);
        expect(Number(s.variables.score)).toBe(5);
      },
      boundarySteps: [
        { afterStep: 1, currentBlockId: "set", x: 0, score: 0 },
        { afterStep: 2, currentBlockId: "move", x: 0, score: 5 },
        { afterStep: 3, currentBlockId: null, x: 10, score: 5 },
      ],
    },
    {
      name: "hat + control_repeat + move",
      opcodes: [
        "event_whenflagclicked",
        "control_repeat",
        "motion_movesteps",
      ],
      project: () => buildRepeatProject({ times: 2, steps: 10 }),
      expectFinal: (s) => {
        expect(s.targets[0]?.x).toBe(20);
      },
      boundarySteps: [
        { afterStep: 1, currentBlockId: "repeat", x: 0 },
        // control_repeat completes without running child
        { afterStep: 2, currentBlockId: "move", x: 0 },
        // first move only (+10); not a combined control+move in step 2
        { afterStep: 3, currentBlockId: null, x: 10 },
        { afterStep: 4, currentBlockId: "move", x: 10 },
        { afterStep: 5, currentBlockId: null, x: 20 },
      ],
    },
    {
      name: "hat + control_if + operator_equals + motion_gotoxy",
      opcodes: [
        "event_whenflagclicked",
        "control_if",
        "operator_equals",
        "motion_gotoxy",
      ],
      project: () => buildIfGotoxyProject(),
      expectFinal: (s) => {
        expect(s.targets[0]?.x).toBe(40);
        expect(s.targets[0]?.y).toBe(-5);
      },
      boundarySteps: [
        { afterStep: 1, currentBlockId: "iff", x: 0 },
        { afterStep: 2, currentBlockId: "goto", x: 0 },
        { afterStep: 3, currentBlockId: null, x: 40, y: -5 },
      ],
    },
    {
      name: "hat + looks_say + operators + data_variable + move",
      opcodes: [
        "event_whenflagclicked",
        "looks_say",
        "data_setvariableto",
        "operator_add",
        "data_variable",
        "motion_movesteps",
      ],
      project: () => buildLooksAndOperatorsProject(),
      expectFinal: (s) => {
        expect(Number(s.variables.score)).toBe(3);
        expect(s.targets[0]?.x).toBe(8);
      },
      boundarySteps: [
        { afterStep: 1, currentBlockId: "say", x: 0, score: 0 },
        { afterStep: 2, currentBlockId: "set", x: 0, score: 0 },
        { afterStep: 3, currentBlockId: "move", x: 0, score: 3 },
        { afterStep: 4, currentBlockId: null, x: 8, score: 3 },
      ],
    },
  ];

  it("table covers every GATE0_OPCODE at least once", () => {
    const seen = new Set<string>();
    for (const c of cases) for (const op of c.opcodes) seen.add(op);
    for (const op of GATE0_OPCODES) {
      expect(seen.has(op), `missing coverage for ${op}`).toBe(true);
    }
  });

  for (const c of cases) {
    it(`boundaries: ${c.name}`, async () => {
      const a = await createAdapter();
      await loadProjectJson(a, c.project());
      let step = 0;
      for (const row of c.boundarySteps) {
        while (step < row.afterStep) {
          await a.stepVisual();
          step++;
        }
        const snap = a.observe();
        expect(snap.currentBlockId, `step ${row.afterStep} block`).toBe(
          row.currentBlockId,
        );
        if (row.x !== undefined) {
          expect(snap.targets[0]?.x, `step ${row.afterStep} x`).toBe(row.x);
        }
        if (row.y !== undefined) {
          expect(snap.targets[0]?.y, `step ${row.afterStep} y`).toBe(row.y);
        }
        if (row.score !== undefined) {
          expect(
            Number(snap.variables.score),
            `step ${row.afterStep} score`,
          ).toBe(row.score);
        }
      }
      a.dispose();
    });

    it(`parity runToEnd vs visual: ${c.name}`, async () => {
      const project = c.project();
      const run = await createAdapter();
      await loadProjectJson(run, project);
      const endRun = await run.runToEnd();
      run.dispose();

      const step = await createAdapter();
      await loadProjectJson(step, project);
      const endStep = await stepUntilIdle(step);
      step.dispose();

      c.expectFinal(endRun);
      c.expectFinal(endStep);
      expect(fingerprint(endStep)).toEqual(fingerprint(endRun));
    });
  }
});
