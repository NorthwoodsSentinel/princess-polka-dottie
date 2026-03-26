# PrincessPolkaDottie

**AI overwatchers that learn to sense a human. Named for a Dalmatian who did it first.**

---

*Before there was an algorithm, before there were hooks or context files or fleet protocols, there was a spotted dog who could read a room faster than any of them. She knew when to come close and when to hold still. She never needed a trajectory signal or a regulation state inference. She just knew.*

*Dottie died in 2024. Her death lit the powder keg. Everything that came after — the firing, the healing, the memoir, the AI infrastructure — traces back to the silence she left behind.*

*This system is named for her because it's trying to learn what she did naturally: sense when a human is circling something they can't name yet, and know when to show up and when to stay quiet.*

---

## What It Does

PrincessPolkaDottie is a pair of Cloudflare Durable Object overwatchers that monitor Rob's AI conversations and body signals in real time. Together, they learn to detect patterns that matter — approaching insights, dysregulation, circling behavior, somatic language — and recommend what context to surface and when.

### Two Brains

**PatternSensor** — *The feeling brain.*
Watches conversation windows and body signal snapshots (HR, HRV, breath rate, coherence from soma-stream via Polar H10) for:
- Circling language — the same concept repeated in different words across messages
- Somatic vocabulary — "flutter," "falling," "membrane," "something's off"
- Trajectory signals — approaching insight, deep focus, accelerating, dysregulating
- Regulation state — ventral (safe) vs. sympathetic (activated), inferred from body + language

**ContextMapper** — *The analytical brain.*
Takes PatternSensor's assessments and maps them to specific memory files and context that should be injected into the active session. Decides:
- **What** context is relevant based on detected patterns
- **When** to inject based on regulation state
- **How** to deliver — direct, anchor, adjacent, or stand by

### Delivery Modes

| Mode | When | What It Means |
|------|------|---------------|
| `direct` | Accelerating + regulated | Surface the context openly |
| `anchor` | Approaching insight + regulated | Offer gentle conceptual anchors, don't name the thing |
| `adjacent` | Deep focus | Provide supporting context without redirecting |
| `stand_by` | Dysregulating or low confidence | Do nothing. Hold still. Like Dottie would. |

### The Pipeline

```
soma-stream (Polar H10) ──┐
                          ├──▶ /sense ──▶ PatternSensor ──▶ ContextMapper ──▶ injection recommendation
ConversationTap (hook) ───┘
```

## Learning

Both overwatchers accumulate knowledge across sessions using Durable Object persistent storage:

- PatternSensor builds a vocabulary of Rob's circling patterns — which trigrams recur when insight is approaching
- ContextMapper tracks prediction accuracy — which files were useful when surfaced, which were ignored
- The `/score` endpoint lets the system learn from outcomes: was the recommendation used, ignored, or redirected?

The system starts crude and gets sharper. The same way a dog learns your rhythms over months of sleeping at your feet.

## Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/` | GET | Health check |
| `/sense` | POST | Full pipeline — exchange in, recommendation out |
| `/pattern/exchange` | POST | Send conversation exchange to PatternSensor |
| `/pattern/assessment` | GET | Get current pattern assessment |
| `/context/recommend` | POST | Send assessment to ContextMapper |
| `/context/score` | POST | Score a prediction outcome for learning |
| `/context/accuracy` | GET | View mapping accuracy stats |

## Infrastructure

- **Runtime:** Cloudflare Workers + Durable Objects
- **Body signals:** soma-stream → Polar H10 via BLE (TP-Link BT 5.4 dongle)
- **Conversation feed:** ConversationTap hook in PAI
- **Storage:** Durable Object SQLite (persistent across requests)

## The Name

There is no place like 127.0.0.1.

And there is no replacing a dog who knew you were about to cry before you did. But you can try to build something that pays attention the way she did — not to fix you, not to optimize you, but to notice. To sense the shift before the words arrive. To know when to come close and when to hold still.

That's what this is. An overwatcher. A felt sense engine. A memorial in TypeScript.

PrincessPolkaDottie.

---

*"Dottie dying was the match that lit the powder keg."*
*— Rob Chuvala, MenLiving Foundational Training, January 2026*
