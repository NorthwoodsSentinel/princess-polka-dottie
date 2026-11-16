// Worker router behavior: the public health route, the deny-by-default auth gate, forwarding to each overwatcher,
// /sense input validation and the full pipeline through real overwatcher instances. Synthetic data only.
import { describe, expect, it } from "vitest";
import worker, { ContextMapper, PatternSensor } from "../src/index";
import type { InjectionRecommendation } from "../src/types";
import { calmBody, exchange, fakeEnv } from "./helpers/fakes";

const BASE = "https://dottie.example";
const AUTH = { Authorization: "Bearer test-token-synthetic" };

const SECURITY_HEADERS = {
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
};

function expectSecurityHeaders(res: Response): void {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) expect(res.headers.get(k)).toBe(v);
}

function authed(path: string, init: RequestInit = {}): Request {
  return new Request(`${BASE}${path}`, { ...init, headers: { ...AUTH, ...(init.headers ?? {}) } });
}

function sense(body: string): Request {
  return authed("/sense", { method: "POST", body, headers: { "Content-Type": "application/json" } });
}

describe("exports", () => {
  it("re-exports both Durable Object classes", () => {
    expect(PatternSensor).toBeTypeOf("function");
    expect(ContextMapper).toBeTypeOf("function");
  });
});

describe("health", () => {
  it.each(["/", "/health"])("%s answers without auth, with security headers", async (path) => {
    const res = await worker.fetch(new Request(`${BASE}${path}`), fakeEnv());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");
    expectSecurityHeaders(res);
    expect(await res.json()).toEqual({
      name: "PrincessPolkaDottie",
      status: "alive",
      overwatchers: ["PatternSensor", "ContextMapper"],
      purpose: "Learning to sense a human the way a dog once did.",
    });
  });
});

describe("auth gate", () => {
  it("rejects a request with no Authorization header", async () => {
    const res = await worker.fetch(new Request(`${BASE}/pattern/health`), fakeEnv());
    expect(res.status).toBe(401);
    expect(await res.text()).toBe("Unauthorized");
    expectSecurityHeaders(res);
  });

  it("rejects a wrong token", async () => {
    const req = new Request(`${BASE}/pattern/health`, { headers: { Authorization: "Bearer wrong" } });
    expect((await worker.fetch(req, fakeEnv())).status).toBe(401);
  });

  it("rejects everything when AUTH_TOKEN is unset, even an empty bearer", async () => {
    const env = fakeEnv({ AUTH_TOKEN: undefined });
    expect((await worker.fetch(authed("/pattern/health"), env)).status).toBe(401);
    const empty = new Request(`${BASE}/pattern/health`, { headers: { Authorization: "Bearer " } });
    expect((await worker.fetch(empty, env)).status).toBe(401);
  });

  it("accepts the raw token without the Bearer prefix", async () => {
    const req = new Request(`${BASE}/pattern/health`, { headers: { Authorization: "test-token-synthetic" } });
    expect((await worker.fetch(req, fakeEnv())).status).toBe(200);
  });

  it("gates unknown paths too, then answers 404", async () => {
    expect((await worker.fetch(new Request(`${BASE}/nope`), fakeEnv())).status).toBe(401);
    const res = await worker.fetch(authed("/nope"), fakeEnv());
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Not found");
    expectSecurityHeaders(res);
  });
});

describe("forwarding", () => {
  it("routes /pattern/* to the singleton PatternSensor with the prefix stripped", async () => {
    const env = fakeEnv();
    const res = await worker.fetch(authed("/pattern/health"), env);
    expect(await res.json()).toEqual({ status: "alive", exchanges_seen: 0, patterns_tracked: 0 });
    expect((env.PATTERN_SENSOR as unknown as { names: string[] }).names).toEqual(["singleton"]);
  });

  it("routes /context/* to the singleton ContextMapper with the prefix stripped", async () => {
    const env = fakeEnv();
    const res = await worker.fetch(authed("/context/health"), env);
    expect(await res.json()).toEqual({ status: "alive", predictions_made: 0, mappings_tracked: 0 });
    expect((env.CONTEXT_MAPPER as unknown as { names: string[] }).names).toEqual(["singleton"]);
  });

  it("does not treat /pattern or /context without a trailing slash as a forward", async () => {
    expect((await worker.fetch(authed("/pattern"), fakeEnv())).status).toBe(404);
    expect((await worker.fetch(authed("/context"), fakeEnv())).status).toBe(404);
  });
});

describe("/sense validation", () => {
  it("only accepts POST", async () => {
    expect((await worker.fetch(authed("/sense"), fakeEnv())).status).toBe(404);
  });

  it("rejects invalid JSON", async () => {
    const res = await worker.fetch(sense("{not json"), fakeEnv());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid JSON body" });
    expectSecurityHeaders(res);
  });

  it.each(["null", "42", '"text"', "false"])("rejects a non-object body %s", async (body) => {
    const res = await worker.fetch(sense(body), fakeEnv());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Request body must be a JSON object" });
  });

  it("rejects a conversation that is not an array", async () => {
    const res = await worker.fetch(sense(JSON.stringify({ conversation: "hi" })), fakeEnv());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "conversation must be an array" });
  });

  it("rejects a conversation longer than 200, and accepts exactly 200", async () => {
    const tooLong = await worker.fetch(
      sense(JSON.stringify({ ...exchange(), conversation: Array(201).fill("x") })),
      fakeEnv(),
    );
    expect(tooLong.status).toBe(400);
    expect(await tooLong.json()).toEqual({ error: "conversation exceeds maximum length of 200 exchanges" });
    const atLimit = await worker.fetch(
      sense(JSON.stringify({ ...exchange(), conversation: Array(200).fill("x") })),
      fakeEnv(),
    );
    expect(atLimit.status).toBe(200);
  });

  it("does not require a conversation field (a falsy one is skipped)", async () => {
    const res = await worker.fetch(sense(JSON.stringify({ ...exchange(), conversation: "" })), fakeEnv());
    expect(res.status).toBe(200);
  });
});

describe("/sense pipeline", () => {
  it("runs PatternSensor then ContextMapper and returns the recommendation with security headers", async () => {
    const env = fakeEnv();
    const body = exchange({ conversation_window: ["what if we build it now"], body_signal: calmBody });
    const res = await worker.fetch(sense(JSON.stringify(body)), env);
    expect(res.status).toBe(200);
    expectSecurityHeaders(res);
    const r = (await res.json()) as InjectionRecommendation;
    expect(r.pattern_assessment.trajectory_signal).toBe("accelerating");
    expect(r.delivery_mode).toBe("direct");
    expect(r.context_files).toEqual(["insight-somatic-catch-event.md"]);
    expect(r.should_inject).toBe(false); // one exchange seen: confidence 0.1

    const sensorHealth = await worker.fetch(authed("/pattern/health"), env);
    expect(await sensorHealth.json()).toMatchObject({ exchanges_seen: 1 });
    const mapperHealth = await worker.fetch(authed("/context/health"), env);
    expect(await mapperHealth.json()).toMatchObject({ predictions_made: 1 });
  });

  it("forwards a POST body through /pattern/exchange", async () => {
    const env = fakeEnv();
    const res = await worker.fetch(
      new Request(`${BASE}/pattern/exchange`, {
        method: "POST",
        body: JSON.stringify(exchange()),
        headers: { ...AUTH, "Content-Type": "application/json" },
      }),
      env,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ regulation_state: "unknown" });
  });
});
