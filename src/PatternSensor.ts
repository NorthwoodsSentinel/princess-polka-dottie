/**
 * PatternSensor — The "Mirror-brain" overwatcher.
 *
 * Watches conversation + body signal for:
 * - Circling language (same concept repeated in different words)
 * - Somatic vocabulary ("flutter", "falling", "membrane", "something's off")
 * - Trajectory signals (approaching insight, dysregulating, deep focus)
 * - Regulation state (derived from body signal + language patterns)
 *
 * Accumulates patterns across sessions. Gets sharper over time.
 *
 * Named for the associative, feeling-oriented mode of sensing —
 * the way Dottie knew before words could say.
 */

import type { ConversationExchange, PatternAssessment, BodySignal, BrainSignal } from "./types";

const SOMATIC_VOCABULARY = [
  "flutter", "falling", "swimming", "membrane", "expansion", "tingling",
  "chest", "belly", "gut", "pressure", "halo", "cool", "warm",
  "something's off", "feels like", "feels right", "can feel",
  "circling", "coming back to", "keep thinking about",
  "spinning", "grounded", "settled", "buzzing",
];

const ACCELERATION_MARKERS = [
  "let's build", "I want to", "can we", "right now",
  "what if we", "shoot", "oh shit", "holy shit",
];

export class PatternSensor implements DurableObject {
  private state: DurableObjectState;
  private recentExchanges: ConversationExchange[] = [];
  private sessionPatterns: Map<string, number> = new Map();

  constructor(state: DurableObjectState, env: any) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/exchange") {
      const exchange: ConversationExchange = await request.json();
      return this.processExchange(exchange);
    }

    if (request.method === "GET" && url.pathname === "/assessment") {
      return Response.json(this.assess());
    }

    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({
        status: "alive",
        exchanges_seen: this.recentExchanges.length,
        patterns_tracked: this.sessionPatterns.size,
      });
    }

    return new Response("Not found", { status: 404 });
  }

  private processExchange(exchange: ConversationExchange): Response {
    // Keep a sliding window of recent exchanges
    this.recentExchanges.push(exchange);
    if (this.recentExchanges.length > 20) {
      this.recentExchanges.shift();
    }

    // Extract and track concepts from the conversation window
    this.trackConceptRepetition(exchange.conversation_window);

    const assessment = this.assess(exchange.body_signal);
    return Response.json(assessment);
  }

  private trackConceptRepetition(messages: string[]) {
    // Simple concept tracking — count significant phrases across messages
    // This is the crude v1. The Durable Object's persistent storage will
    // eventually hold a learned vocabulary of Rob's circling patterns.
    const combined = messages.join(" ").toLowerCase();

    for (const [concept, count] of this.sessionPatterns) {
      // Decay old concepts
      if (count > 0) {
        this.sessionPatterns.set(concept, count - 0.1);
      }
    }

    // Track repeated multi-word phrases (3+ words appearing 2+ times)
    const words = combined.split(/\s+/);
    for (let i = 0; i < words.length - 2; i++) {
      const trigram = `${words[i]} ${words[i + 1]} ${words[i + 2]}`;
      const current = this.sessionPatterns.get(trigram) || 0;
      this.sessionPatterns.set(trigram, current + 1);
    }
  }

  private detectSomaticLanguage(messages: string[]): string[] {
    const combined = messages.join(" ").toLowerCase();
    return SOMATIC_VOCABULARY.filter((term) => combined.includes(term));
  }

  private detectAcceleration(messages: string[]): boolean {
    const combined = messages.join(" ").toLowerCase();
    return ACCELERATION_MARKERS.some((marker) => combined.includes(marker));
  }

  private inferRegulationState(
    body: BodySignal | null | undefined,
    brain: BrainSignal | null | undefined,
  ): PatternAssessment["regulation_state"] {
    if (!body && !brain) return "unknown";

    let sympatheticSignals = 0;
    let ventralSignals = 0;

    // Body signals
    if (body && body.hr !== null) {
      if (body.hr > 90) sympatheticSignals++;
      else ventralSignals++;
      if (body.hrv_rmssd !== null && body.hrv_rmssd < 25) sympatheticSignals++;
      if (body.hrv_rmssd !== null && body.hrv_rmssd >= 40) ventralSignals++;
      if (body.breath_rate !== null && body.breath_rate > 18) sympatheticSignals++;
      if (body.breath_rate !== null && body.breath_rate <= 12) ventralSignals++;
    }

    // Brain signals — alpha dominance = relaxed, beta dominance = activated
    if (brain) {
      if (brain.alpha !== null && brain.beta !== null && brain.alpha > brain.beta) {
        ventralSignals++;  // Alpha dominant = relaxed
      }
      if (brain.beta !== null && brain.alpha !== null && brain.beta > brain.alpha * 2) {
        sympatheticSignals++;  // Beta strongly dominant = activated/anxious
      }
      if (brain.theta !== null && brain.alpha !== null && brain.theta > brain.alpha) {
        ventralSignals++;  // Theta dominant = deep meditation/flow
      }
      if (brain.gamma !== null && brain.gamma > 0) {
        // Gamma present = peak cognition, not necessarily sympathetic
        // Track but don't score either way in v1
      }
    }

    if (sympatheticSignals > ventralSignals) return "sympathetic";
    if (ventralSignals > 0) return "ventral";
    return "unknown";
  }

  private assess(bodySignal?: BodySignal | null): PatternAssessment {
    const allMessages = this.recentExchanges.flatMap((e) => e.conversation_window);
    const latestBody = bodySignal ?? this.recentExchanges[this.recentExchanges.length - 1]?.body_signal ?? null;

    // Detect circling — concepts with count >= 3
    let circlingConcept: string | null = null;
    let maxRepetition = 0;
    for (const [concept, count] of this.sessionPatterns) {
      if (count >= 3 && count > maxRepetition) {
        maxRepetition = count;
        circlingConcept = concept;
      }
    }

    const somaticLanguage = this.detectSomaticLanguage(allMessages.slice(-5));
    const accelerating = this.detectAcceleration(allMessages.slice(-3));
    const latestBrain = this.recentExchanges[this.recentExchanges.length - 1]?.brain_signal ?? null;
    const regulationState = this.inferRegulationState(latestBody, latestBrain);

    // Determine trajectory
    let trajectory: PatternAssessment["trajectory_signal"] = "stable";
    if (circlingConcept && regulationState === "ventral" && somaticLanguage.length > 0) {
      trajectory = "approaching_insight";
    } else if (accelerating && regulationState === "sympathetic") {
      trajectory = "dysregulating";
    } else if (accelerating && regulationState === "ventral") {
      trajectory = "accelerating";
    } else if (regulationState === "ventral" && !accelerating && this.recentExchanges.length > 5) {
      trajectory = "deep_focus";
    }

    const confidence = Math.min(this.recentExchanges.length / 10, 1.0);

    return {
      circling_detected: circlingConcept !== null,
      circling_concept: circlingConcept,
      repetition_count: maxRepetition,
      somatic_language_detected: somaticLanguage,
      regulation_state: regulationState,
      trajectory_signal: trajectory,
      confidence: Math.round(confidence * 100) / 100,
      ts: Date.now() / 1000,
    };
  }
}
