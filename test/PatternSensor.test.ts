// PatternSensor behavior, asserted through its fetch interface: routing, persistence, the sliding window, concept
// tracking with decay and pruning, regulation-state inference and trajectory selection. Synthetic data only.
import { describe, expect, it } from "vitest";
import { PatternSensor } from "../src/PatternSensor";
import type { ConversationExchange, PatternAssessment } from "../src/types";
import { brain, calmBody, exchange, fakeState, fakeStorage, post, stressedBody } from "./helpers/fakes";

async function send(sensor: PatternSensor, ex: ConversationExchange): Promise<PatternAssessment> {
  const res = await sensor.fetch(post("http://internal/exchange", ex));
  expect(res.status).toBe(200);
  return (await res.json()) as PatternAssessment;
}

async function getJson<T>(sensor: PatternSensor, path: string): Promise<T> {
  const res = await sensor.fetch(new Request(`http://internal${path}`));
  expect(res.status).toBe(200);
  return (await res.json()) as T;
}

describe("PatternSensor routing", () => {
  it("answers health with counts", async () => {
    const sensor = new PatternSensor(fakeState(), {});
    expect(await getJson(sensor, "/health")).toEqual({ status: "alive", exchanges_seen: 0, patterns_tracked: 0 });
  });

  it("returns 404 for unknown paths and wrong methods", async () => {
    const sensor = new PatternSensor(fakeState(), {});
    expect((await sensor.fetch(new Request("http://internal/nope"))).status).toBe(404);
    expect((await sensor.fetch(new Request("http://internal/exchange"))).status).toBe(404);
    expect((await sensor.fetch(post("http://internal/assessment", {}))).status).toBe(404);
    expect((await sensor.fetch(post("http://internal/health", {}))).status).toBe(404);
  });

  it("assesses an empty sensor as unknown and stable with zero confidence", async () => {
    const sensor = new PatternSensor(fakeState(), {});
    const a = await getJson<PatternAssessment>(sensor, "/assessment");
    expect(a).toMatchObject({
      circling_detected: false,
      circling_concept: null,
      repetition_count: 0,
      somatic_language_detected: [],
      regulation_state: "unknown",
      trajectory_signal: "stable",
      confidence: 0,
    });
    expect(typeof a.ts).toBe("number");
  });
});

describe("PatternSensor persistence", () => {
  it("persists exchanges and patterns, and a new instance reloads them", async () => {
    const storage = fakeStorage();
    const first = new PatternSensor(fakeState(storage), {});
    await send(first, exchange({ conversation_window: ["one two three four"] }));
    expect(storage.data.get("recentExchanges")).toHaveLength(1);
    expect(storage.data.get("sessionPatterns")).toEqual([
      ["one two three", 1],
      ["two three four", 1],
    ]);

    const second = new PatternSensor(fakeState(storage), {});
    expect(await getJson(second, "/health")).toEqual({ status: "alive", exchanges_seen: 1, patterns_tracked: 2 });
  });

  it("loads storage only once per instance", async () => {
    const storage = fakeStorage();
    let reads = 0;
    const get = storage.get.bind(storage);
    storage.get = async <T>(key: string) => {
      reads++;
      return get<T>(key);
    };
    const sensor = new PatternSensor(fakeState(storage), {});
    await getJson(sensor, "/health");
    await getJson(sensor, "/health");
    expect(reads).toBe(2); // two keys, read once
  });

  it("keeps a sliding window of 20 exchanges", async () => {
    const sensor = new PatternSensor(fakeState(), {});
    for (let i = 0; i < 22; i++) await send(sensor, exchange({ conversation_window: [`m${i}`] }));
    expect(await getJson(sensor, "/health")).toMatchObject({ exchanges_seen: 20 });
  });
});

describe("PatternSensor concept tracking", () => {
  it("decays positive counts by 0.1 and leaves non-positive counts alone", async () => {
    const storage = fakeStorage({
      sessionPatterns: [
        ["old phrase here", 2],
        ["spent phrase here", 0],
      ],
    });
    const sensor = new PatternSensor(fakeState(storage), {});
    await send(sensor, exchange({ conversation_window: ["short"] }));
    const patterns = new Map(storage.data.get("sessionPatterns") as [string, number][]);
    expect(patterns.get("old phrase here")).toBeCloseTo(1.9);
    expect(patterns.get("spent phrase here")).toBe(0);
  });

  it("detects circling once a trigram reaches 3 and reports the strongest one", async () => {
    const sensor = new PatternSensor(fakeState(), {});
    const a = await send(
      sensor,
      exchange({ conversation_window: ["the red door the red door the red door", "the red door again"] }),
    );
    expect(a.circling_detected).toBe(true);
    expect(a.circling_concept).toBe("the red door");
    expect(a.repetition_count).toBe(4);
  });

  it("prunes to the 500 highest-scoring patterns", async () => {
    const seed: [string, number][] = [];
    for (let i = 0; i < 500; i++) seed.push([`seed ${i} x`, 10 + i]);
    const storage = fakeStorage({ sessionPatterns: seed });
    const sensor = new PatternSensor(fakeState(storage), {});
    await send(sensor, exchange({ conversation_window: ["alpha beta gamma delta"] }));
    const patterns = storage.data.get("sessionPatterns") as [string, number][];
    expect(patterns).toHaveLength(500);
    const keys = patterns.map(([k]) => k);
    expect(keys).not.toContain("alpha beta gamma");
    expect(keys).not.toContain("beta gamma delta");
    expect(keys).toContain("seed 499 x");
  });
});

describe("PatternSensor language detection", () => {
  it("reports somatic vocabulary found in the last five messages", async () => {
    const sensor = new PatternSensor(fakeState(), {});
    const a = await send(sensor, exchange({ conversation_window: ["My Chest has a Flutter", "feels like falling"] }));
    expect(a.somatic_language_detected).toEqual(["flutter", "falling", "chest", "feels like"]);
  });
});

describe("PatternSensor regulation state", () => {
  const stateFor = async (ex: Partial<ConversationExchange>) =>
    (await send(new PatternSensor(fakeState(), {}), exchange(ex))).regulation_state;

  it("is unknown with neither body nor brain signal", async () => {
    expect(await stateFor({})).toBe("unknown");
  });

  it("is ventral for a calm body and sympathetic for a stressed one", async () => {
    expect(await stateFor({ body_signal: calmBody })).toBe("ventral");
    expect(await stateFor({ body_signal: stressedBody })).toBe("sympathetic");
  });

  it("ignores the rest of the body signal when heart rate is missing", async () => {
    expect(await stateFor({ body_signal: { ...stressedBody, hr: null } })).toBe("unknown");
  });

  it("scores heart rate alone when the other body fields are null or mid-range", async () => {
    expect(await stateFor({ body_signal: { hr: 95, hrv_rmssd: null, breath_rate: null, coherence: null } })).toBe(
      "sympathetic",
    );
    expect(await stateFor({ body_signal: { hr: 70, hrv_rmssd: 30, breath_rate: 15, coherence: null } })).toBe(
      "ventral",
    );
  });

  it("reads alpha dominance as ventral and strong beta dominance as sympathetic", async () => {
    expect(await stateFor({ brain_signal: brain({ alpha: 10, beta: 5 }) })).toBe("ventral");
    expect(await stateFor({ brain_signal: brain({ alpha: 5, beta: 11 }) })).toBe("sympathetic");
  });

  it("reads theta over alpha as ventral", async () => {
    expect(await stateFor({ brain_signal: brain({ alpha: 5, theta: 6 }) })).toBe("ventral");
  });

  it("does not score gamma or partial bands", async () => {
    expect(await stateFor({ brain_signal: brain({ gamma: 3 }) })).toBe("unknown");
    expect(await stateFor({ brain_signal: brain({ gamma: 0, alpha: 5 }) })).toBe("unknown");
    expect(await stateFor({ brain_signal: brain({ beta: 5 }) })).toBe("unknown");
    expect(await stateFor({ brain_signal: brain({ theta: 5 }) })).toBe("unknown");
  });

  it("is unknown when signals tie at zero, sympathetic when they outnumber ventral", async () => {
    expect(await stateFor({ brain_signal: brain({ alpha: 5, beta: 6 }) })).toBe("unknown");
    expect(await stateFor({ body_signal: calmBody, brain_signal: brain({ alpha: 1, beta: 10 }) })).toBe("ventral");
    expect(await stateFor({ body_signal: stressedBody, brain_signal: brain({ alpha: 10, beta: 1 }) })).toBe(
      "sympathetic",
    );
  });

  it("falls back to the latest stored body signal when assessed without one", async () => {
    const sensor = new PatternSensor(fakeState(), {});
    await send(sensor, exchange({ body_signal: stressedBody }));
    expect((await getJson<PatternAssessment>(sensor, "/assessment")).regulation_state).toBe("sympathetic");
  });
});

describe("PatternSensor trajectory", () => {
  it("is approaching_insight when circling, ventral and somatic together", async () => {
    const sensor = new PatternSensor(fakeState(), {});
    const a = await send(
      sensor,
      exchange({ conversation_window: ["my gut my gut my gut my gut"], body_signal: calmBody }),
    );
    expect(a.trajectory_signal).toBe("approaching_insight");
  });

  it("is dysregulating when accelerating and sympathetic", async () => {
    const sensor = new PatternSensor(fakeState(), {});
    const a = await send(sensor, exchange({ conversation_window: ["let's build it"], body_signal: stressedBody }));
    expect(a.trajectory_signal).toBe("dysregulating");
  });

  it("is accelerating when accelerating and ventral", async () => {
    const sensor = new PatternSensor(fakeState(), {});
    const a = await send(sensor, exchange({ conversation_window: ["what if we try"], body_signal: calmBody }));
    expect(a.trajectory_signal).toBe("accelerating");
  });

  it("is deep_focus when ventral and calm for more than five exchanges", async () => {
    const sensor = new PatternSensor(fakeState(), {});
    let a: PatternAssessment | undefined;
    for (let i = 0; i < 6; i++)
      a = await send(sensor, exchange({ conversation_window: [`n${i}`], body_signal: calmBody }));
    expect(a?.trajectory_signal).toBe("deep_focus");
    expect(a?.confidence).toBe(0.6);
  });

  it("stays stable when ventral for five exchanges or fewer, and when accelerating with unknown state", async () => {
    const sensor = new PatternSensor(fakeState(), {});
    const a = await send(sensor, exchange({ conversation_window: ["quiet"], body_signal: calmBody }));
    expect(a.trajectory_signal).toBe("stable");
    const b = await send(new PatternSensor(fakeState(), {}), exchange({ conversation_window: ["can we go"] }));
    expect(b.trajectory_signal).toBe("stable");
  });

  it("caps confidence at 1", async () => {
    const sensor = new PatternSensor(fakeState(), {});
    let a: PatternAssessment | undefined;
    for (let i = 0; i < 12; i++) a = await send(sensor, exchange({ conversation_window: [`c${i}`] }));
    expect(a?.confidence).toBe(1);
  });
});
