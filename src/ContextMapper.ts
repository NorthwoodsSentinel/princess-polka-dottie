/**
 * ContextMapper — The "Archie-brain" overwatcher.
 *
 * Takes pattern assessments from the PatternSensor and maps them
 * to specific memory files and context that should be injected
 * into the active AI session.
 *
 * Decides:
 * - WHAT context is relevant based on patterns detected
 * - WHEN to inject based on regulation state
 * - HOW to deliver (direct, anchor, adjacent, stand by)
 *
 * Accumulates mapping accuracy across sessions. Learns which
 * files are relevant to which patterns.
 */

import type { PatternAssessment, InjectionRecommendation, PredictionRecord, Env } from "./types";

/** Known memory file mappings — seed data, will grow with learning */
const CONTEXT_MAPPINGS: Record<string, string[]> = {
  // Somatic language triggers
  "flutter": ["patterns.md"],
  "falling": ["patterns.md", "insight-somatic-catch-event.md"],
  "membrane": ["insight-somatic-catch-event.md"],
  "expansion": ["patterns.md", "insight-universal-channel.md"],
  "chest": ["patterns.md", "insight-universal-channel.md"],
  "drop": ["patterns.md"], // The Drop pattern
  "circling": ["insight-universal-channel.md"],

  // Trajectory triggers
  "approaching_insight": ["patterns.md", "insight-20260312-pride-pattern.md"],
  "dysregulating": ["insight-somatic-catch-event.md", "feedback_landing_procedure.md"],
  "accelerating": ["insight-somatic-catch-event.md"],
};

/** Delivery mode based on regulation state + trajectory */
function determineDeliveryMode(
  assessment: PatternAssessment,
): InjectionRecommendation["delivery_mode"] {
  // Dysregulating → stop everything
  if (assessment.trajectory_signal === "dysregulating") {
    return "stand_by";
  }

  // Approaching insight while regulated → gentle anchors only
  if (
    assessment.trajectory_signal === "approaching_insight" &&
    assessment.regulation_state === "ventral"
  ) {
    return "anchor";
  }

  // Deep focus → adjacent context that supports without redirecting
  if (assessment.trajectory_signal === "deep_focus") {
    return "adjacent";
  }

  // Accelerating but regulated → direct is fine
  if (
    assessment.trajectory_signal === "accelerating" &&
    assessment.regulation_state === "ventral"
  ) {
    return "direct";
  }

  // Default
  return "stand_by";
}

const MAX_PREDICTIONS = 100;

export class ContextMapper implements DurableObject {
  private state: DurableObjectState;
  private predictions: PredictionRecord[] = [];
  private mappingAccuracy: Map<string, { hits: number; misses: number }> = new Map();
  private initialized = false;

  constructor(state: DurableObjectState, env: any) {
    this.state = state;
  }

  /** Load persisted state from storage before handling any request */
  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    const storedPredictions = await this.state.storage.get<PredictionRecord[]>("predictions");
    if (storedPredictions) this.predictions = storedPredictions;
    const storedAccuracy = await this.state.storage.get<[string, { hits: number; misses: number }][]>("mappingAccuracy");
    if (storedAccuracy) this.mappingAccuracy = new Map(storedAccuracy);
    this.initialized = true;
  }

  /** Persist mutable state to storage */
  private async persist(): Promise<void> {
    await this.state.storage.put("predictions", this.predictions);
    await this.state.storage.put("mappingAccuracy", [...this.mappingAccuracy.entries()]);
  }

  async fetch(request: Request): Promise<Response> {
    await this.ensureInitialized();
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/recommend") {
      const assessment: PatternAssessment = await request.json();
      return Response.json(await this.recommend(assessment));
    }

    if (request.method === "POST" && url.pathname === "/score") {
      const scoring: { prediction_id: string; outcome: PredictionRecord["outcome"] } =
        await request.json();
      return await this.scorePrediction(scoring.prediction_id, scoring.outcome);
    }

    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({
        status: "alive",
        predictions_made: this.predictions.length,
        mappings_tracked: this.mappingAccuracy.size,
      });
    }

    if (request.method === "GET" && url.pathname === "/accuracy") {
      const accuracy: Record<string, { hits: number; misses: number; rate: number }> = {};
      for (const [key, value] of this.mappingAccuracy) {
        const total = value.hits + value.misses;
        accuracy[key] = { ...value, rate: total > 0 ? value.hits / total : 0 };
      }
      return Response.json(accuracy);
    }

    return new Response("Not found", { status: 404 });
  }

  private async recommend(assessment: PatternAssessment): Promise<InjectionRecommendation> {
    const contextFiles: string[] = [];

    // Map somatic language to context files
    for (const term of assessment.somatic_language_detected) {
      const files = CONTEXT_MAPPINGS[term];
      if (files) {
        for (const f of files) {
          if (!contextFiles.includes(f)) contextFiles.push(f);
        }
      }
    }

    // Map trajectory to context files
    const trajectoryFiles = CONTEXT_MAPPINGS[assessment.trajectory_signal];
    if (trajectoryFiles) {
      for (const f of trajectoryFiles) {
        if (!contextFiles.includes(f)) contextFiles.push(f);
      }
    }

    // Map circling concept — future: learned mappings from pattern history
    if (assessment.circling_concept) {
      // v1: no learned mappings yet. Just note what was circled.
    }

    const deliveryMode = determineDeliveryMode(assessment);
    const shouldInject = deliveryMode !== "stand_by" && contextFiles.length > 0 && assessment.confidence > 0.5;

    const recommendation: InjectionRecommendation = {
      should_inject: shouldInject,
      context_files: contextFiles,
      reasoning: this.buildReasoning(assessment, contextFiles, deliveryMode),
      delivery_mode: deliveryMode,
      confidence: assessment.confidence,
      pattern_assessment: assessment,
      ts: Date.now() / 1000,
    };

    // Record prediction for later scoring
    const predictionId = `pred_${Date.now()}`;
    this.predictions.push({
      id: predictionId,
      recommendation,
      outcome: "not_scored",
      scored_at: null,
      ts: Date.now() / 1000,
    });

    // Keep predictions bounded — prune oldest when limit exceeded (F-036)
    if (this.predictions.length > MAX_PREDICTIONS) {
      this.predictions = this.predictions.slice(-MAX_PREDICTIONS);
    }

    await this.persist();
    return recommendation;
  }

  private buildReasoning(
    assessment: PatternAssessment,
    files: string[],
    mode: InjectionRecommendation["delivery_mode"],
  ): string {
    const parts: string[] = [];

    if (assessment.circling_detected) {
      parts.push(`Circling detected: "${assessment.circling_concept}" (${assessment.repetition_count}x)`);
    }
    if (assessment.somatic_language_detected.length > 0) {
      parts.push(`Somatic language: ${assessment.somatic_language_detected.join(", ")}`);
    }
    parts.push(`Regulation: ${assessment.regulation_state}`);
    parts.push(`Trajectory: ${assessment.trajectory_signal}`);
    parts.push(`Delivery: ${mode}`);
    if (files.length > 0) {
      parts.push(`Context: ${files.join(", ")}`);
    }

    return parts.join(" | ");
  }

  private async scorePrediction(predictionId: string, outcome: PredictionRecord["outcome"]): Promise<Response> {
    const prediction = this.predictions.find((p) => p.id === predictionId);
    if (!prediction) {
      return Response.json({ error: "Prediction not found" }, { status: 404 });
    }

    prediction.outcome = outcome;
    prediction.scored_at = Date.now() / 1000;

    // Update mapping accuracy
    for (const file of prediction.recommendation.context_files) {
      const current = this.mappingAccuracy.get(file) || { hits: 0, misses: 0 };
      if (outcome === "used") {
        current.hits++;
      } else if (outcome === "ignored" || outcome === "redirected") {
        current.misses++;
      }
      this.mappingAccuracy.set(file, current);
    }

    await this.persist();
    return Response.json({ scored: true, prediction_id: predictionId, outcome });
  }
}
