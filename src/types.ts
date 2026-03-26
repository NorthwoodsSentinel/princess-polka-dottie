/** Body signal snapshot from soma-stream (Polar H10) */
export interface BodySignal {
  hr: number | null;
  hrv_rmssd: number | null;
  breath_rate: number | null;
  coherence: number | null;
}

/** Brain signal snapshot from muse-stream (Muse headband) */
export interface BrainSignal {
  alpha: number | null;   // 8-13 Hz — relaxation
  beta: number | null;    // 13-30 Hz — focus/engagement
  theta: number | null;   // 4-8 Hz — drowsiness/meditation
  delta: number | null;   // 1-4 Hz — deep sleep
  gamma: number | null;   // 30-50 Hz — peak cognition
  calm: number | null;    // Muse-computed calm score
  focus: number | null;   // Muse-computed focus score
  hsi: number[];          // Sensor quality [TP9, AF7, AF8, TP10]
}

/** Conversation exchange from the tap hook */
export interface ConversationExchange {
  conversation_window: string[];
  body_signal: BodySignal | null;
  brain_signal: BrainSignal | null;
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
