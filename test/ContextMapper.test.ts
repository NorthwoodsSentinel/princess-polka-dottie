// ContextMapper behavior, asserted through its fetch interface: routing, persistence, file mapping, delivery mode,
// the injection decision, the bounded prediction history, scoring and accuracy. Synthetic data only.
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContextMapper } from "../src/ContextMapper";
import type { InjectionRecommendation, PatternAssessment, PredictionRecord } from "../src/types";
import { assessment, fakeState, fakeStorage, post } from "./helpers/fakes";

let clock = 1_700_000_000_000;
function tick(): void {
  clock += 1;
  vi.spyOn(Date, "now").mockReturnValue(clock);
}

afterEach(() => {
  vi.restoreAllMocks();
});

async function recommend(mapper: ContextMapper, a: Partial<PatternAssessment>): Promise<InjectionRecommendation> {
  tick();
  const res = await mapper.fetch(post("http://internal/recommend", assessment(a)));
  expect(res.status).toBe(200);
  return (await res.json()) as InjectionRecommendation;
}

async function getJson<T>(mapper: ContextMapper, path: string): Promise<T> {
  const res = await mapper.fetch(new Request(`http://internal${path}`));
  expect(res.status).toBe(200);
  return (await res.json()) as T;
}

describe("ContextMapper routing", () => {
  it("answers health with counts", async () => {
    const mapper = new ContextMapper(fakeState());
    expect(await getJson(mapper, "/health")).toEqual({ status: "alive", predictions_made: 0, mappings_tracked: 0 });
  });

  it("returns 404 for unknown paths and wrong methods", async () => {
    const mapper = new ContextMapper(fakeState());
    expect((await mapper.fetch(new Request("http://internal/nope"))).status).toBe(404);
    expect((await mapper.fetch(new Request("http://internal/recommend"))).status).toBe(404);
    expect((await mapper.fetch(new Request("http://internal/score"))).status).toBe(404);
    expect((await mapper.fetch(post("http://internal/health", {}))).status).toBe(404);
    expect((await mapper.fetch(post("http://internal/accuracy", {}))).status).toBe(404);
  });
});

describe("ContextMapper recommendations", () => {
  it("maps somatic terms and trajectory to deduplicated files and anchors an approaching insight", async () => {
    const mapper = new ContextMapper(fakeState());
    const r = await recommend(mapper, {
      somatic_language_detected: ["flutter", "falling", "unmapped-term"],
      trajectory_signal: "approaching_insight",
      regulation_state: "ventral",
      circling_detected: true,
      circling_concept: "the red door",
      repetition_count: 4,
      confidence: 0.9,
    });
    expect(r.context_files).toEqual([
      "patterns.md",
      "insight-somatic-catch-event.md",
      "insight-20260312-pride-pattern.md",
    ]);
    expect(r.delivery_mode).toBe("anchor");
    expect(r.should_inject).toBe(true);
    expect(r.confidence).toBe(0.9);
    expect(r.pattern_assessment.circling_concept).toBe("the red door");
    expect(r.reasoning).toBe(
      'Circling detected: "the red door" (4x) | Somatic language: flutter, falling, unmapped-term | ' +
        "Regulation: ventral | Trajectory: approaching_insight | Delivery: anchor | " +
        "Context: patterns.md, insight-somatic-catch-event.md, insight-20260312-pride-pattern.md",
    );
    expect(r.ts).toBe(clock / 1000);
  });

  it("stands by while dysregulating, even with files", async () => {
    const r = await recommend(new ContextMapper(fakeState()), {
      trajectory_signal: "dysregulating",
      regulation_state: "sympathetic",
    });
    expect(r.delivery_mode).toBe("stand_by");
    expect(r.context_files).toEqual(["insight-somatic-catch-event.md", "feedback_landing_procedure.md"]);
    expect(r.should_inject).toBe(false);
  });

  it("stands by for an approaching insight that is not ventral", async () => {
    const r = await recommend(new ContextMapper(fakeState()), {
      trajectory_signal: "approaching_insight",
      regulation_state: "sympathetic",
    });
    expect(r.delivery_mode).toBe("stand_by");
    expect(r.should_inject).toBe(false);
  });

  it("offers adjacent context in deep focus, but injects nothing without files", async () => {
    const r = await recommend(new ContextMapper(fakeState()), {
      trajectory_signal: "deep_focus",
      regulation_state: "ventral",
    });
    expect(r.delivery_mode).toBe("adjacent");
    expect(r.context_files).toEqual([]);
    expect(r.should_inject).toBe(false);
    expect(r.reasoning).toBe("Regulation: ventral | Trajectory: deep_focus | Delivery: adjacent");
  });

  it("delivers directly when accelerating and ventral, but stands by when accelerating otherwise", async () => {
    const mapper = new ContextMapper(fakeState());
    const direct = await recommend(mapper, { trajectory_signal: "accelerating", regulation_state: "ventral" });
    expect(direct.delivery_mode).toBe("direct");
    expect(direct.should_inject).toBe(true);
    const other = await recommend(mapper, { trajectory_signal: "accelerating", regulation_state: "unknown" });
    expect(other.delivery_mode).toBe("stand_by");
  });

  it("does not inject at confidence 0.5 or below", async () => {
    const r = await recommend(new ContextMapper(fakeState()), {
      trajectory_signal: "accelerating",
      regulation_state: "ventral",
      confidence: 0.5,
    });
    expect(r.delivery_mode).toBe("direct");
    expect(r.should_inject).toBe(false);
  });

  it("records each recommendation as an unscored prediction and keeps the newest 100", async () => {
    const storage = fakeStorage();
    const mapper = new ContextMapper(fakeState(storage));
    const firstClock = clock + 1;
    for (let i = 0; i < 102; i++) await recommend(mapper, {});
    const predictions = storage.data.get("predictions") as PredictionRecord[];
    expect(predictions).toHaveLength(100);
    expect(predictions[0].id).toBe(`pred_${firstClock + 2}`);
    expect(predictions[99]).toMatchObject({ id: `pred_${clock}`, outcome: "not_scored", scored_at: null });
    expect(await getJson(mapper, "/health")).toMatchObject({ predictions_made: 100 });
  });
});

describe("ContextMapper scoring and accuracy", () => {
  async function score(mapper: ContextMapper, prediction_id: string, outcome: PredictionRecord["outcome"]) {
    tick();
    return mapper.fetch(post("http://internal/score", { prediction_id, outcome }));
  }

  it("returns 404 for an unknown prediction", async () => {
    const res = await score(new ContextMapper(fakeState()), "pred_missing", "used");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Prediction not found" });
  });

  it("counts used as hits, ignored and redirected as misses, and not_scored as neither", async () => {
    const storage = fakeStorage();
    const mapper = new ContextMapper(fakeState(storage));
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      await recommend(mapper, { trajectory_signal: "accelerating", regulation_state: "ventral" });
      ids.push(`pred_${clock}`);
    }
    await recommend(mapper, { somatic_language_detected: ["membrane"] });
    const membraneId = `pred_${clock}`;

    const used = await score(mapper, ids[0], "used");
    expect(await used.json()).toEqual({ scored: true, prediction_id: ids[0], outcome: "used" });
    await score(mapper, ids[1], "ignored");
    await score(mapper, ids[2], "redirected");
    await score(mapper, ids[3], "not_scored");
    await score(mapper, membraneId, "not_scored");

    const scored = (storage.data.get("predictions") as PredictionRecord[]).find((p) => p.id === ids[0]);
    expect(scored).toMatchObject({ outcome: "used" });
    expect(typeof scored?.scored_at).toBe("number");

    expect(await getJson(mapper, "/accuracy")).toEqual({
      "insight-somatic-catch-event.md": { hits: 1, misses: 2, rate: 1 / 3 },
    });
    expect(await getJson(mapper, "/health")).toMatchObject({ mappings_tracked: 1 });
  });

  it("reports a zero rate for a mapping with no hits or misses", async () => {
    const storage = fakeStorage({ mappingAccuracy: [["patterns.md", { hits: 0, misses: 0 }]] });
    const mapper = new ContextMapper(fakeState(storage));
    expect(await getJson(mapper, "/accuracy")).toEqual({ "patterns.md": { hits: 0, misses: 0, rate: 0 } });
  });

  it("persists scoring and a new instance reloads predictions and accuracy", async () => {
    const storage = fakeStorage();
    const first = new ContextMapper(fakeState(storage));
    await recommend(first, { somatic_language_detected: ["chest"] });
    await score(first, `pred_${clock}`, "used");

    const second = new ContextMapper(fakeState(storage));
    expect(await getJson(second, "/health")).toEqual({ status: "alive", predictions_made: 1, mappings_tracked: 2 });
    expect(await getJson(second, "/accuracy")).toEqual({
      "patterns.md": { hits: 1, misses: 0, rate: 1 },
      "insight-universal-channel.md": { hits: 1, misses: 0, rate: 1 },
    });
  });
});
