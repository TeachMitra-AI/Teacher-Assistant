# AI Learning Representation System — Architecture Decision Record

**Status:** Frozen for review · not yet implemented · **Owner:** Teacher Assistant engineering

> This document is the source of truth for this system. It is implementation-independent by design —
> it explains WHY this architecture exists, not HOW it will be coded. Any future contributor should be
> able to read this before touching the implementation and understand the shape of the system and the
> reasoning behind it. Companion reading once implementation begins: existing architecture docs in this
> folder (e.g. `multimodal-attachments-architecture.md`) for how this project documents shipped systems.

---

## 1. Vision

Teacher Assistant currently returns text-only AI responses. The starting idea was "let the AI generate
images alongside answers." That framing was deliberately abandoned, in stages, over the course of
product discussion — each stage removed a false assumption the previous one was quietly making.

**Why we moved away from "AI Image Generation."** Framing this as image generation anchors the design
on a rendering technology (diffusion/pixel models) rather than on the actual goal. It biases every
downstream decision toward "make a picture" even when a picture is the wrong tool — a comparison is
better served by a table, a chronology by a timeline, quantitative data by a graph. It also imports
diffusion generation's specific failure modes (mislabeled text, hallucinated anatomical/technical
detail) as if they were unavoidable, when for most educational content they aren't.

**Why "Visualization" was still too narrow.** Replacing "image" with "visualization" fixed the
technology-bias problem but kept a different one: it still assumed the only alternative to plain prose
is *something visual*. Some learning goals are better served by a worked example, an analogy, or an
interactive/manipulable model than by any static picture. "Visualization" has no natural home for those
— they'd always be bolted on as special cases.

**Why "Learning Representation" is the correct long-term abstraction.** A Learning Representation is
any format used to encode and communicate a concept in a way suited to how it's learned — verbal
explanation, structured diagram, comparison table, timeline, worked example, interactive simulation,
and so on. Visual representations are a subset of this space, not the whole of it. This framing also
isn't novel for its own sake — it matches how instructional design and multimedia-learning research
already think about the problem (verbal/visual/enactive channels, matching a representation to the
underlying knowledge structure), rather than treating "add a picture" as a design goal in itself.

**The problem this system solves.** Teachers ask questions whose content has structure — a sequence, a
comparison, a hierarchy, a chronology, a composition of parts — that plain prose can convey but often
doesn't convey *well*. The system's job is to recognize when a response would be genuinely better
served by a non-prose representation, choose the representation that matches the underlying structure
of the content (not just "add a visual because visuals seem helpful"), and render it in a way a teacher
can trust and use in a classroom. For students, the payoff is comprehension that matches how the
material is actually structured, instead of every concept looking like the same wall of text.

---

## 2. Product Principles

These are the load-bearing decisions from the product discussion. Everything else in this document is
a consequence of these.

1. **AI should optimize for learning, not for visuals.** A representation is chosen because it serves
   the underlying cognitive operation (sequencing, comparing, decomposing, mapping magnitude), not
   because "a picture" is generically assumed to help. "No additional representation" is a first-class,
   frequently-correct outcome, not a fallback.

2. **Educational Intent determines Learning Representation.** The question the system answers first is
   "what is the student trying to understand" (a process, a comparison, a hierarchy...), not "what
   should this look like." Representation choice is a downstream consequence of intent, not an
   independent guess.

3. **Representation determines rendering.** Once a representation type is chosen (e.g. Comparison
   Table), how it's rendered follows deterministically from that type. Rendering is not a second
   creative decision — it's execution of the representation contract.

4. **Context modifies rendering, not representation or intent.** Grade level, language, lesson stage,
   and delivery setting change *how* a representation is presented (depth, density, formatting) — they
   do not change *which* representation or intent was chosen. A process is a process whether it's being
   taught for the first time or revised before an exam; only the scaffolding changes. This principle is
   the resolution of an explicit design fork: an earlier proposal to add a sequential "Teaching
   Strategy" stage between Intent and Representation was rejected specifically because, in every
   example examined, it only ever changed rendering density/format — never the representation type
   itself. See §7.

5. **Prefer deterministic decisions over probabilistic ones wherever the mapping allows it.** Every
   layer of this architecture exists to convert an ambiguous judgment call into a narrower, more
   separable, more inspectable one. Where a decision *can* be made a lookup rather than a guess, it
   should be — consistency and debuggability are worth more than marginal flexibility.

6. **Architecture should be extensible without increasing V1 scope.** The system is designed so new
   representation types, new context signals, and new renderers are additive to existing seams (new
   rows in a mapping table, new entries in a context schema) rather than requiring a redesign. V1 stays
   deliberately small; the architecture does not.

---

## 3. Educational Intent Taxonomy (V1)

The taxonomy is intentionally small. Earlier, longer candidate lists (nine-plus categories) were
rejected because several categories overlapped in practice (e.g. "explain structure," "identify parts
of an object," and "show spatial relationships" are frequently the same question asked three ways).
Overlapping categories produce unstable classification — the same or similar prompts land in different
categories on different runs, which reads as inconsistency to a teacher. The V1 list below was reduced
until each category is behaviorally distinct from every other.

| Intent | Selected when... | Example prompts |
|---|---|---|
| **Explain a Process** | The content is a sequence of steps or a cause→effect chain. | "Explain the TCP handshake." "How does digestion work?" |
| **Compare Concepts** | The content contrasts two or more things along shared dimensions. | "Compare mitosis and meiosis." "Capitalism vs. socialism." |
| **Show Chronology** | The content is a sequence of events situated in time. | "Timeline of the Mughal Empire." "Key events of WWII." |
| **Show Hierarchy** | The content is a classification, taxonomy, or parent/child structure. | "Classify the animal kingdom." "Org structure of a Roman legion." |
| **Explain Structure** | The content is a composition of parts, spatial arrangement, and/or how those parts relate — whether the goal is naming parts or understanding how they work together. | "Label the human heart." "Parts of a plant cell." "How does a car engine work?" |
| **Show Quantitative Data** | The content is numeric and its meaning depends on magnitude, trend, or distribution. | "Show population growth of India." "Graph y = x²." |
| **No Visualization** | The content is definitional, opinion-based, a single fact, or otherwise has no structure a non-prose representation would clarify. | "What year was X born?" "Is this a good essay topic?" |

**Deliberate merge:** "Explain Structure" absorbs what earlier discussion treated as three separate
candidates (structure / spatial relationships / identify parts). They rendered to the same
representation and were not reliably separable from each other, so keeping them distinct bought no
downstream value at the cost of classification stability.

---

## 4. Learning Representation Taxonomy (V1)

| Representation | Purpose | Best for | Why it's in V1 |
|---|---|---|---|
| **Verbal Explanation** | The default. Prose conveys the answer directly. | Anything without structural complexity — definitions, opinions, single facts. | It's what the product already does; every other representation is additive to this, never a replacement of it. |
| **Process Diagram** | Shows ordered steps and the flow between them. | Sequences, cause-effect chains, protocols. | Directly serves *Explain a Process*, the most common structured-content intent. |
| **Comparison Table** | Lays shared dimensions side by side across two or more items. | Contrasts, trade-off analysis. | Directly serves *Compare Concepts*; a table beats a diagram for parallel structure. |
| **Timeline** | Places events along a time axis. | Historical sequences, project/era chronology. | Directly serves *Show Chronology*; a generic diagram loses the sequencing that's the entire point. |
| **Hierarchy Diagram** | Shows parent/child or classification structure. | Taxonomies, org structures, category trees. | Directly serves *Show Hierarchy*. |
| **Labeled Diagram** | Shows the composition of an object with named parts. | Anatomy, mechanical parts, cross-sections. | Directly serves *Explain Structure*. |
| **Graph / Chart** | Plots quantitative data. | Trends, distributions, functions. | Directly serves *Show Quantitative Data*; the only representation where numeric accuracy is the point. |

Every V1 representation is a **structured** representation: it is generated as a defined, labelable,
checkable structure rather than as free-form pixel content. This is a deliberate, load-bearing
constraint — see §6.

---

## 5. Intent → Representation Mapping

| Educational Intent | Learning Representation |
|---|---|
| Explain a Process | Process Diagram |
| Compare Concepts | Comparison Table |
| Show Chronology | Timeline |
| Show Hierarchy | Hierarchy Diagram |
| Explain Structure | Labeled Diagram |
| Show Quantitative Data | Graph / Chart |
| No Visualization | Verbal Explanation (no additional representation) |

The mapping is **1:1 and deterministic in V1** — each intent has exactly one representation. This is a
direct consequence of Product Principle 5 and of how the taxonomies in §3 and §4 were built: they were
shaped specifically so that once intent is known, representation is not a second judgment call, it is a
lookup.

**Why deterministic beats probabilistic here.** A second free classification step (independently
guessing representation type after intent is known) would compound error — two chances to be wrong
instead of one — and would produce instability: the same intent could render differently on different
occasions for no visible reason, which is exactly the inconsistency teachers would (rightly) stop
trusting. Making the second step a lookup means the only thing that can be wrong is the intent
classification itself, which is a single, inspectable, evaluable decision (see §12) rather than two
compounding ones. Every reduction of the taxonomies in §3–§4 to non-overlapping categories exists
specifically to keep this mapping a clean 1:1 table instead of a many-to-many judgment call.

---

## 6. Rendering Principles

All V1 representations are rendered as **structured output** — a defined, labeled, checkable structure
(diagram description, table data, timeline data, chart data) — rather than as a free-form generated
image. This applies uniformly across the five structured representation types in §4:

- **Process Diagram / Hierarchy Diagram / Labeled Diagram** — nodes and labeled relationships, drawn
  from a structured description rather than painted as pixels.
- **Timeline** — events plotted along a defined time axis with structured date/label data.
- **Comparison Table** — literally tabular data; no rendering ambiguity at all.
- **Graph / Chart** — plotted from actual numeric data, not an approximation of what a chart "looks
  like."

**Why structured rendering is preferred over diffusion-generated images for V1.** This was the single
most consequential technical decision in the product discussion, so it's worth restating why plainly:
diffusion/pixel image generation is unreliable at producing correct, legible labels and accurate
technical/scientific detail — exactly the properties an educational diagram cannot compromise on. A
wrong label in a generated image is a visible, specific factual error a teacher may not catch before
projecting it to a class. Structured rendering doesn't have this failure mode by construction: labels
come from the same structured data that was validated against the answer, not from a model
independently guessing what text should appear inside a picture. Structured rendering is also cheaper,
faster, more stylistically consistent across generations, and inherently editable — all properties
diffusion generation lacks.

**Where AI-generated illustration fits in the future roadmap.** Not all educational needs are
structural — "what did a Roman marketplace look like," genuinely evocative/scene-setting content — has
no honest structured representation. That's a real future representation type (see §9), but it carries
a fundamentally different trust profile from everything in V1 (generative pixel content vs. deterministic
structured content) and should never be presented to a teacher as visually/trust-equivalent to a
Labeled Diagram or Graph. It is explicitly excluded from V1 (§8) so that this trust distinction can be
designed deliberately rather than retrofitted.

---

## 7. Context

**Definition.** Context is everything about the situation surrounding a prompt that isn't the prompt's
content itself: grade level, language, teacher preferences, classroom/delivery setting (presentation vs.
homework vs. printed handout), lesson history, curriculum position, and — in the future — live
classroom state (e.g. an upcoming exam, current unit).

**Why Context modifies rendering instead of determining Educational Intent.** This is the resolution of
the most consequential fork in the product discussion. A "Teaching Strategy" layer (first-time teaching
vs. revision vs. exam prep vs. classroom presentation vs. homework) was proposed as a sequential stage
between Intent and Representation. It was rejected as a *gating* stage for two reasons that both matter:

1. **It doesn't change representation type, only its presentation.** Across every example examined, a
   process explained for revision vs. for first-time teaching vs. for exam prep was *still* a Process
   Diagram — only its density, scaffolding, and formatting changed. That is the definition of a
   rendering modifier, not a decision that determines which representation gets chosen.
2. **The signal usually isn't present in the prompt.** Unlike Intent, which is grounded in the words of
   the prompt itself, "is this revision or first exposure" is rarely stated and is mostly *guessed* from
   a single freeform sentence — a weak, unreliable signal for something with real pedagogical
   consequence if guessed wrong (wrong depth/scaffolding is a bigger miss than a wrong diagram type).

Context is also where the "delivery format" half of that original Teaching Strategy proposal belongs —
classroom presentation vs. homework vs. print is an output/rendering setting, not a pedagogical
classification, and shouldn't be inferred by AI at all; it's better handled as an explicit setting than
a guess.

**Practical shape for V1:** Context is intentionally treated as **lightweight and mostly explicit**
rather than as an inferred classification — grade and language are already known account/session
settings; a "keep it simple" or "quick revision" cue only applies when a teacher's own words say so.
Building a dedicated inference layer for pedagogical stage is explicitly deferred (§8) until there is
reliable grounding for it (§9).

---

## 8. Out of Scope (V1)

| Excluded | Why |
|---|---|
| **AI Illustrations (diffusion-generated images)** | Different trust profile than structured rendering (§6); needs its own deliberate disclaimer/trust treatment before it can coexist with structured representations without misleading teachers. |
| **Worked Examples** | A real future representation type, but not needed to validate the core Intent → Representation → Renderer loop; adding it now widens V1 without proving the core loop first. |
| **Analogies as a distinct representation** | Currently achievable within Verbal Explanation; doesn't need new architecture to exist today. |
| **Flashcards** | A distinct output shape (spaced-repetition-oriented) or study aid, not a response representation; belongs to a different product surface. |
| **Simulations / Interactive representations** | Meaningfully more powerful for some content, but a materially larger scope than static structured rendering; the architecture reserves a seat for it (§9) without requiring it now. |
| **Animations** | Same reasoning as simulations — real future value, not required to validate the core system. |
| **Student Mode** | This entire discussion has been teacher-facing; adapting representation choice/depth for a student audience is a distinct product surface with its own trust and pedagogy questions. |
| **Adaptive Teaching (per-student personalization)** | Requires durable student-level state the product doesn't have yet; premature without it. |
| **Explicit "Teaching Strategy" classification layer** | Rejected as a gating stage per §7; may return later as a context modifier, but only once grounded in real classroom state rather than inferred per-prompt. |
| **Multi-intent / composite representations** (e.g. photosynthesis as both Process and Structure) | Real content class, but the 1:1 mapping in §5 is deliberately simple for V1; composite handling is a natural, additive extension (§9), not a launch requirement. |
| **Infographic as a representation type** | Functions more as a composition of other representations than a primitive; deferred until usage data shows it's needed as its own type. |

Everything in this list was excluded for the same reason: it's real future value that does not need to
exist for the core architecture (Intent → Representation → Renderer, modified by Context) to be proven
correct. None of it requires the V1 architecture to be redesigned to add later — see §9.

---

## 9. Future Roadmap

The architecture accommodates all of the following as **additive** changes — new rows in the
Intent→Representation mapping, new representation types with their own renderers, or new fields in the
Context schema — precisely because §2's principles kept Intent, Representation, Rendering, and Context
as separate, independently-extensible concerns from the start.

| Future capability | How it fits without a redesign |
|---|---|
| **Worked Example** | A new Learning Representation type, mapped from intents like "Solve a Problem" (a new intent, added the same way existing ones were defined) — additive to §3–§5, no change to the pipeline shape. |
| **Analogy** | Could graduate from a Verbal Explanation technique to its own representation type if it needs distinct rendering treatment (e.g. paired visual) — same additive pattern. |
| **Flashcards** | A new representation type consumed by a different product surface (study/review), reusing the same Intent classification. |
| **Interactive Simulation** | A new representation type with its own renderer; the Renderer layer already exists as a decoupled stage specifically so new renderers don't touch Intent or Representation logic. |
| **Animation** | Same as Simulation — a new renderer behind the existing Representation abstraction. |
| **Assessment / Practice** | A new representation type ("check understanding"), naturally reachable once representation is understood as "any output format that serves learning," not just explanatory content. |
| **Student Mode** | Consumes the same Intent → Representation pipeline with a different Context profile (audience = student) — validates that Context was the right extension point for audience-level adaptation rather than a new pipeline stage. |
| **AI Illustration** | Added as a representation type once a deliberate lower-trust presentation treatment exists (visible disclaimer, distinct visual treatment) — the taxonomy in §4 already anticipates this as an explicit future entry rather than an afterthought. |
| **Teaching Strategy as a Context modifier** | Revisited once durable classroom state exists (curriculum position, exam calendar, lesson history) to ground it reliably, exactly as scoped out in §7 — it re-enters as a Context field, not a new pipeline stage. |
| **Multi-intent / composite representations** | Extends §5 from a strict 1:1 table to a primary+secondary mapping for content that genuinely spans two intents (e.g. photosynthesis) — additive to the mapping table, not a new pipeline shape. |

The common thread: nothing on this list requires moving Intent, Representation, or Rendering relative
to each other, or reintroducing a stage that was deliberately rejected (§7). New capability arrives by
adding rows and fields to existing tables/schemas.

---

## 10. Decision Tree

```
                         Teacher Prompt
                               │
                               ▼
                    ┌─────────────────────┐
                    │  Educational Intent   │   ← classified from the prompt's content
                    │  (Explain a Process,   │      (§3)
                    │   Compare, Chronology, │
                    │   Hierarchy, Structure,│
                    │   Quantitative, None)  │
                    └─────────────────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │ Learning Representation│  ← deterministic lookup, not a
                    │ (Process Diagram,       │     second guess (§5)
                    │  Comparison Table,      │
                    │  Timeline, Hierarchy    │
                    │  Diagram, Labeled       │
                    │  Diagram, Graph, or     │
                    │  Verbal Explanation)    │
                    └─────────────────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │       Renderer         │  ← structured rendering per type (§6)
                    └─────────────────────┘
                               │
                               ▼
                          Response
                     (text ± structured
                        representation)

   Context (grade, language, teacher preferences, classroom
   setting, lesson history, curriculum, future classroom state)
   ────────────────────────────────────────────────────────────►
      participates as a modifier into Rendering ONLY (§7) —
      it does not feed into, or gate, Intent or Representation
      selection.
```

---

## 11. Risks

| Risk | Mitigation |
|---|---|
| **Over-engineering** | V1 taxonomies (§3–§4) were deliberately reduced to the smallest non-overlapping sets; the mapping (§5) is intentionally 1:1 rather than flexible/configurable, trading theoretical flexibility for a system that's simple to reason about and evaluate. |
| **Scope creep** | §8 exists specifically to make exclusions explicit and force any addition to be a deliberate roadmap decision (§9), not something added quietly mid-implementation. |
| **Incorrect intent classification** | This is the single decision the whole system's correctness rests on (§5). Mitigate via a held-out evaluation set (§12), and because the failure is isolated to one inspectable step rather than compounding across a multi-stage guess, misclassifications are easier to diagnose and fix than in a probabilistic multi-stage design. |
| **Wrong representation for the content** | Structurally bounded by design — since representation is a deterministic consequence of intent (§5), a wrong representation is always traceable to either a wrong intent classification or a genuine taxonomy gap (a real content shape not yet in §3), both of which are visible and fixable, not silent. |
| **Hallucinations (wrong facts/labels in a representation)** | Addressed primarily by §6's core decision — structured rendering instead of diffusion image generation removes the dominant source of this risk (independently-guessed pixel text) by construction. Residual risk (wrong structured data itself) is addressed by grounding representation content in the same answer already produced for the prompt, not a fresh independent generation. |
| **Latency** | Structured rendering (§6) is inherently faster than diffusion image generation. The core pipeline (Intent → Representation → Renderer) also only runs when a representation is actually warranted or requested — see out-of-scope framing in earlier product discussion around on-demand generation. |
| **Cost** | Deterministic mapping (§5) means no wasted generation calls guessing representation type; structured rendering (§6) is far cheaper than image-generation APIs; and common-topic caching/curation is an explicit future lever (§9/§13) once usage data exists to justify it. |

---

## 12. Success Metrics

| Metric | What it measures | V1 target framing |
|---|---|---|
| **Intent classification accuracy** | Against a held-out labeled set of teacher prompts across all 7 categories in §3. | The single most important quality metric — everything downstream depends on it (§11). |
| **Representation appropriateness** | Teacher-rated: "did this representation actually help?" per response. | Direct measure of whether §5's deterministic mapping choices are pedagogically correct, not just consistent. |
| **Latency (added, vs. text-only response)** | Time from representation request to rendered output. | Should stay low enough that on-demand generation (button/explicit request) doesn't feel like a separate slow feature. |
| **Cost per representation generated** | API/compute cost per rendered representation. | Should be materially lower than an equivalent diffusion-image call, validating §6. |
| **Adoption** | % of eligible responses (non-"No Visualization" intent) where the teacher actually requests/uses the representation. | Signals whether the suggestion is discoverable and worth having, independent of quality. |
| **Consistency** | Whether the same/similar prompt reliably produces the same intent/representation across repeated asks. | Directly validates the determinism argument in §5 — this should be near-100% by construction, and any drift is a bug, not noise. |

---

## 13. Implementation Phases

Architectural phases only — no implementation detail, no code shape decisions.

- **Phase A — Intent Classification Only.** Classify prompts into the §3 taxonomy. No representation
  selection, no rendering, no UI change. Validates classification quality (§12) in isolation before
  anything is built on top of it.
- **Phase B — Representation Selection.** Wire the deterministic §5 mapping on top of validated intent
  classification. Still no rendering — representation choice can be logged/reviewed before investing in
  renderers.
- **Phase C — Rendering Engine.** Build structured renderers for the §4 representation types, per the
  rendering principles in §6.
- **Phase D — UI Integration.** Surface the representation to teachers (discovery/request mechanism,
  presentation alongside the text answer).
- **Phase E — Caching / Curation.** Introduce caching for common/high-frequency topics, as scoped in
  §11's cost mitigation.
- **Phase F — Evaluation.** Instrument the §12 metrics against real usage and close the loop on intent
  taxonomy and mapping quality.

Each phase is independently valuable and independently stoppable — the system is useful (as a
diagnostic/logging tool) after Phase A alone, and each subsequent phase adds a layer without requiring
the previous ones to be redone.
