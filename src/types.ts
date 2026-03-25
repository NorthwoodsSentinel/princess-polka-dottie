/** Body signal snapshot from soma-stream */
export interface BodySignal {
  hr: number | null;
  hrv_rmssd: number | null;
  breath_rate: number | null;
  coherence: number | null;
}

/** Conversation exchange from the tap hook */
export interface ConversationExchange {
  conversation_window: string[];
  body_signal: BodySignal | null;
  session_context: {
    duration_min: number;
    message_count: number;
  };
  ts: number;
}

/** Pattern Sensor's assessment of current state */
export interface PatternAssessment {
  circling_detected: boolean;
  circling_concept: string | null;
  repetition_count: number;
  somatic_language_detected: string[];
  regulation_state: "ventral" | "sympathetic" | "unknown";
  trajectory_signal: "approaching_insight" | "deep_focus" | "accelerating" | "dysregulating" | "stable" | "unknown";
  confidence: number;
  ts: number;
}

/** Context Mapper's injection recommendation */
export interface InjectionRecommendation {
  should_inject: boolean;
  context_files: string[];
  reasoning: string;
  delivery_mode: "direct" | "anchor" | "adjacent" | "stand_by";
  confidence: number;
  pattern_assessment: PatternAssessment;
  ts: number;
}

/** Prediction record for learning */
export interface PredictionRecord {
  id: string;
  recommendation: InjectionRecommendation;
  outcome: "used" | "ignored" | "redirected" | "not_scored" ;
  scored_at: number | null;
  ts: number;
}

/** Env bindings */
export interface Env {
  PATTERN_SENSOR: DurableObjectNamespace;
  CONTEXT_MAPPER: DurableObjectNamespace;
  ENVIRONMENT: string;
  AUTH_TOKEN?: string;
}
