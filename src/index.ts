/**
 * PrincessPolkaDottie — Worker router
 *
 * Routes authenticated requests to the two overwatcher Durable Objects:
 * - PatternSensor: conversation + body signal → pattern assessment
 * - ContextMapper: pattern assessment → injection recommendation
 *
 * All endpoints require AUTH_TOKEN header match.
 * "I believe that one defines oneself by reinvention." — Henry Rollins
 */

import type { Env } from "./types";

export { PatternSensor } from "./PatternSensor";
export { ContextMapper } from "./ContextMapper";

const SECURITY_HEADERS: Record<string, string> = {
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

function secureJson(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...SECURITY_HEADERS },
  });
}

function secureText(body: string, status = 200): Response {
  return new Response(body, { status, headers: SECURITY_HEADERS });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Health check — no auth needed
    if (path === "/" || path === "/health") {
      return secureJson({
        name: "PrincessPolkaDottie",
        status: "alive",
        overwatchers: ["PatternSensor", "ContextMapper"],
        purpose: "Learning to sense a human the way a dog once did.",
      });
    }

    // Auth check — deny-by-default. If AUTH_TOKEN is not set, nothing gets through.
    const authToken = request.headers.get("Authorization")?.replace("Bearer ", "");
    if (!env.AUTH_TOKEN || authToken !== env.AUTH_TOKEN) {
      return secureText("Unauthorized", 401);
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
      let exchange: any;
      try {
        exchange = await request.json();
      } catch {
        return secureJson({ error: "Invalid JSON body" }, 400);
      }

      // Input validation — require at minimum a conversation array
      if (!exchange || typeof exchange !== 'object') {
        return secureJson({ error: "Request body must be a JSON object" }, 400);
      }
      if (exchange.conversation && !Array.isArray(exchange.conversation)) {
        return secureJson({ error: "conversation must be an array" }, 400);
      }
      if (exchange.conversation && exchange.conversation.length > 200) {
        return secureJson({ error: "conversation exceeds maximum length of 200 exchanges" }, 400);
      }

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

      return secureJson(recommendation);
    }

    return secureText("Not found", 404);
  },
};
