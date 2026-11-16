// Test fakes for the Durable Object runtime: an in-memory storage, a state wrapper and a namespace that hands out
// real PatternSensor / ContextMapper instances, so router tests exercise the actual overwatchers end to end.
// Synthetic data only; nothing here touches a network or a Cloudflare account.
import { ContextMapper } from "../../src/ContextMapper";
import { PatternSensor } from "../../src/PatternSensor";
import type { BodySignal, BrainSignal, ConversationExchange, Env, PatternAssessment } from "../../src/types";

export interface FakeStorage {
  data: Map<string, unknown>;
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
}

export function fakeStorage(seed: Record<string, unknown> = {}): FakeStorage {
  const data = new Map<string, unknown>(Object.entries(seed));
  return {
    data,
    async get<T>(key: string) {
      // structuredClone mirrors the real storage: callers never share references with what was stored.
      return data.has(key) ? (structuredClone(data.get(key)) as T) : undefined;
    },
    async put(key: string, value: unknown) {
      data.set(key, structuredClone(value));
    },
  };
}

export function fakeState(storage: FakeStorage = fakeStorage()): DurableObjectState {
  return { storage } as unknown as DurableObjectState;
}

type Overwatcher = { fetch(request: Request): Promise<Response> };

/** A namespace that returns one instance per name, like a real namespace addressed with idFromName. */
export function fakeNamespace(make: () => Overwatcher): DurableObjectNamespace & { names: string[] } {
  const instances = new Map<string, Overwatcher>();
  const names: string[] = [];
  return {
    names,
    idFromName(name: string) {
      names.push(name);
      return { name } as unknown as DurableObjectId;
    },
    get(id: DurableObjectId) {
      const name = (id as unknown as { name: string }).name;
      let instance = instances.get(name);
      if (!instance) {
        instance = make();
        instances.set(name, instance);
      }
      const target = instance;
      return { fetch: (req: Request) => target.fetch(req) } as unknown as DurableObjectStub;
    },
  } as unknown as DurableObjectNamespace & { names: string[] };
}

export function fakeEnv(overrides: Partial<Env> = {}): Env {
  return {
    PATTERN_SENSOR: fakeNamespace(() => new PatternSensor(fakeState(), {})),
    CONTEXT_MAPPER: fakeNamespace(() => new ContextMapper(fakeState(), {})),
    ENVIRONMENT: "test",
    AUTH_TOKEN: "test-token-synthetic",
    ...overrides,
  };
}

export const calmBody: BodySignal = { hr: 62, hrv_rmssd: 55, breath_rate: 10, coherence: 0.8 };
export const stressedBody: BodySignal = { hr: 110, hrv_rmssd: 18, breath_rate: 22, coherence: 0.1 };

export function brain(overrides: Partial<BrainSignal> = {}): BrainSignal {
  return {
    alpha: null,
    beta: null,
    theta: null,
    delta: null,
    gamma: null,
    calm: null,
    focus: null,
    hsi: [1, 1, 1, 1],
    ...overrides,
  };
}

export function exchange(overrides: Partial<ConversationExchange> = {}): ConversationExchange {
  return {
    conversation_window: ["hello there"],
    body_signal: null,
    brain_signal: null,
    session_context: { duration_min: 1, message_count: 1 },
    ts: 1,
    ...overrides,
  };
}

export function assessment(overrides: Partial<PatternAssessment> = {}): PatternAssessment {
  return {
    circling_detected: false,
    circling_concept: null,
    repetition_count: 0,
    somatic_language_detected: [],
    regulation_state: "unknown",
    trajectory_signal: "stable",
    confidence: 1,
    ts: 1,
    ...overrides,
  };
}

export function post(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}
