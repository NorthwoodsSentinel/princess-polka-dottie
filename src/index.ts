/**
 * PrincessPolkaDottie — Worker router
 *
 * Routes authenticated requests to the two overwatcher Durable Objects:
 * - PatternSensor: conversation + body signal → pattern assessment
 * - ContextMapper: pattern assessment → injection recommendation
 *
 * All endpoints require AUTH_TOKEN header match.
 */

import type { Env } from "./types";

export { PatternSensor } from "./PatternSensor";
export { ContextMapper } from "./ContextMapper";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Health check — no auth needed
    if (path === "/" || path === "/health") {
      return Response.json({
        name: "PrincessPolkaDottie",
        status: "alive",
        overwatchers: ["PatternSensor", "ContextMapper"],
        purpose: "Learning to sense a human the way a dog once did.",
      });
    }

    // Auth check — everything below requires token
    const authToken = request.headers.get("Authorization")?.replace("Bearer ", "");
    if (env.AUTH_TOKEN && authToken !== env.AUTH_TOKEN) {
      return new Response("Unauthorized", { status: 401 });
    }

    // Route to PatternSensor
    if (path.startsWith("/pattern/")) {
      const id = env.PATTERN_SENSOR.idFromName("singleton");
      const stub = env.PATTERN_SENSOR.get(id);
      const subPath = path.replace("/pattern", "");
      return stub.fetch(new Request(`http://internal${subPath}`, request));
    }

    // Route to ContextMapper
    if (path.startsWith("/context/")) {
      const id = env.CONTEXT_MAPPER.idFromName("singleton");
      const stub = env.CONTEXT_MAPPER.get(id);
      const subPath = path.replace("/context", "");
      return stub.fetch(new Request(`http://internal${subPath}`, request));
    }

    // Combined endpoint — full pipeline
    if (path === "/sense" && request.method === "POST") {
      const exchange = await request.json();

      // Step 1: Send to PatternSensor
      const patternId = env.PATTERN_SENSOR.idFromName("singleton");
      const patternStub = env.PATTERN_SENSOR.get(patternId);
      const assessmentResp = await patternStub.fetch(
        new Request("http://internal/exchange", {
          method: "POST",
          body: JSON.stringify(exchange),
          headers: { "Content-Type": "application/json" },
        }),
      );
      const assessment = await assessmentResp.json();

      // Step 2: Send assessment to ContextMapper
      const contextId = env.CONTEXT_MAPPER.idFromName("singleton");
      const contextStub = env.CONTEXT_MAPPER.get(contextId);
      const recommendationResp = await contextStub.fetch(
        new Request("http://internal/recommend", {
          method: "POST",
          body: JSON.stringify(assessment),
          headers: { "Content-Type": "application/json" },
        }),
      );
      const recommendation = await recommendationResp.json();

      return Response.json(recommendation);
    }

    return new Response("Not found", { status: 404 });
  },
};
