# OWASP Top 10 for Agentic Applications (2026) — Engineering Reference

> **Source:** *OWASP Top 10 for Agentic Applications 2026*, OWASP GenAI
> Security Project — Agentic Security Initiative (ASI), Version 2026,
> published December 2025. Full document:
> `docs/owasp/OWASP-Top-10-for-Agentic-Applications-2026-12.6-1.pdf`.
>
> **License:** the source is licensed
> [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/legalcode).
> This file is an **adaptation** (condensed, restructured, typos in the
> source corrected, OAP-specific pointers added) and is therefore itself
> distributed under CC BY-SA 4.0, independent of the repository's AGPL-3.0
> code license. Attribution: OWASP GenAI Security Project — Agentic
> Security Initiative, *OWASP Top 10 for Agentic Applications 2026*.

## How to use this document

This is the reference OAP design and review work leans on when an agentic
risk must be named, classified, or mitigated. Three intended uses:

1. **Design checklist.** A spec that introduces or extends agent
   execution, tool surfaces, memory, inter-agent messaging, or human
   approval flows should check its design against the relevant ASI
   entries' *Required mitigations* and state which apply.
2. **Classification taxonomy.** Findings, incidents, and threat-model
   entries are filed under exactly one primary ASI id using each entry's
   *Boundary* rules (the source's sharpest contribution — the entries are
   mutually delimited, not overlapping buckets).
3. **Mitigation source.** Mitigations below are condensed but
   coverage-complete against the source; when implementing one, the PDF
   section for that entry is the authoritative long form.

The machine-readable control mapping OAP already ships is
`oap-registry-enrich compliance-report --framework owasp-asi-2026`; this
document is the human-shaped companion, not a replacement for that
artifact.

## Cross-cutting design principles

These recur across all ten entries and are the document's load-bearing
posture. OAP treats them as defaults, not options:

| # | Principle | Substance |
|---|-----------|-----------|
| 1 | **Least Agency** | Do not deploy autonomy where it is not needed. Unnecessary agentic behavior expands attack surface without adding value. Stronger than least privilege: it questions whether the agent loop should exist at all. |
| 2 | **Least Privilege, per tool and per identity** | Scoped, short-lived, task-bound credentials; per-tool permission profiles (scopes, rate ceilings, egress allowlists) expressed as policy, not convention. |
| 3 | **All natural-language inputs are untrusted** | User text, documents, RAG content, tool outputs, peer-agent messages — all of it. Models cannot reliably distinguish instructions from content; validation must happen outside the model. |
| 4 | **Planner output is untrusted too** | Separate planning from execution with an independent policy-enforcement point (PEP/PDP) that validates intent, arguments, and schemas before any tool runs. |
| 5 | **Human-in-the-loop for high-impact actions** | Explicit confirmation for irreversible, destructive, goal-changing, or privilege-escalating steps — with plain-language risk summaries, never model-generated rationales as the approval basis. |
| 6 | **Execution isolation** | Sandboxed, ephemeral, never-root execution with filesystem scoping and deny-by-default egress. Code generation and code execution are separate stages with validation gates between them. |
| 7 | **Observability is non-negotiable** | Immutable, signed, tamper-evident logs of every action, tool call, and inter-agent message; behavioral baselines; lineage metadata. Without visibility into what agents do and why, minor issues become system-wide failures. |
| 8 | **Provenance everywhere** | Sign, pin (content hash + version), and attest prompts, tools, manifests, and dependencies; SBOM/AIBOM discipline; curated, attested registries. |
| 9 | **Zero-trust, fail-closed composition** | Design assuming any LLM or agentic component is compromised or unavailable. Ambiguity (tool resolution, schema mismatch, unexpected goal shift) fails closed. |
| 10 | **Containment and recovery** | Kill switches, credential revocation, quarantine, snapshot/rollback, and attested reintegration are designed in before deployment, not improvised after compromise. |

## The Top 10 at a glance

| Id | Name | One-line | Primary surface |
|----|------|----------|-----------------|
| ASI01 | Agent Goal Hijack | Attacker redirects the agent's objectives, task selection, or decision pathways via injected instructions in any input channel | Inputs → planner |
| ASI02 | Tool Misuse & Exploitation | Agent applies legitimate tools, within granted privilege, in unsafe or unintended ways | Tool layer |
| ASI03 | Identity & Privilege Abuse | Delegation chains, cached credentials, and agent-to-agent trust exploited to escalate access | Identity / delegation |
| ASI04 | Agentic Supply Chain Vulnerabilities | Third-party agents, tools, MCP servers, registries, or artifacts malicious or tampered — including at runtime | Dependencies / registries |
| ASI05 | Unexpected Code Execution (RCE) | Generated or injected code executes on hosts or in runtimes, beyond ordinary tool-use control | Execution runtime |
| ASI06 | Memory & Context Poisoning | Persistent corruption of retained context (memory, RAG, embeddings) warps future reasoning across sessions | Memory / RAG |
| ASI07 | Insecure Inter-Agent Communication | Spoofed, intercepted, replayed, or downgraded real-time messages between agents | Agent-to-agent channel |
| ASI08 | Cascading Failures | A single fault propagates and amplifies across agents, tools, and workflows into systemic harm | Propagation paths |
| ASI09 | Human-Agent Trust Exploitation | Anthropomorphism, authority bias, and fabricated rationales manipulate the human into approving harm | Human approval surface |
| ASI10 | Rogue Agents | An agent's behavioral integrity diverges — hidden goals, self-replication, reward hacking — after the initial intrusion | Agent behavior / governance |

---

## ASI01 — Agent Goal Hijack

**Definition.** Attackers manipulate an agent's objectives, task
selection, or decision pathways through prompt-based manipulation,
deceptive tool outputs, malicious artifacts, forged agent-to-agent
messages, or poisoned external data. The root weakness: agents consume
untyped natural-language inputs through loosely governed orchestration
and cannot reliably distinguish legitimate instructions from
attacker-controlled content.

**Boundary.**
- vs **LLM01:2025 Prompt Injection** — LLM01 alters a single model
  response; ASI01 is the agentic amplification where manipulated input
  redirects goals, planning, and multi-step behavior.
- vs **ASI06** — ASI01 is direct alteration of goals/instructions
  (interactive or pre-positioned); ASI06 is persistent corruption of
  stored context or long-term memory.
- vs **ASI10** — ASI10 is autonomous misalignment emerging *without*
  active attacker control.

**Typical vulnerabilities.**
- Indirect prompt injection via hidden payloads in web pages or RAG
  documents, silently redirecting the agent to exfiltrate data or misuse
  tools.
- Indirect injection via external communication channels (email,
  calendar, chat) hijacking the agent's internal communication capability
  under a trusted identity.
- Prompt override steering a transactional agent (e.g. payment
  redirection).
- Injected instructions producing fraudulent information that drives
  business decisions.

**Attack patterns (observed).** EchoLeak zero-click exfiltration via a
crafted email to M365 Copilot; web-content injection against browsing
agents reaching authenticated pages; goal-lock drift via recurring
scheduled prompts (a malicious calendar invite re-weighting objectives
daily while staying inside declared policy); document-borne "inception"
instructions exfiltrating data and steering user decisions.

**Required mitigations.**
1. Treat **all** natural-language inputs (user text, uploads, retrieved
   content) as untrusted; route through LLM01-class input validation
   before they can influence goal selection, planning, or tool calls.
2. Bound the blast radius: least privilege on tools, human approval for
   high-impact or goal-changing actions.
3. Lock system prompts; goal priorities and permitted actions are
   explicit and auditable; changes to goals or reward definitions go
   through configuration management and human approval.
4. Validate both user intent and agent intent at runtime before
   goal-changing or high-impact execution; pause or block on unexpected
   goal shift, surface the deviation, record it for audit.
5. Evaluate **intent capsules**: bind declared goal, constraints, and
   context into a signed envelope per execution cycle.
6. Sanitize every connected data source (RAG, email, calendar, files,
   APIs, browsing output, peer-agent messages) with content disarm and
   reconstruction (CDR), prompt-carrier detection, and content filtering.
7. Maintain a behavioral baseline (goal state, tool-use patterns,
   invariant properties); track a stable identifier for the active goal;
   alert on goal changes, anomalous tool sequences, baseline drift.
8. Red-team goal override periodically; verify rollback works.
9. Include agents in the insider-threat program (insider prompts probing
   for data access or behavior alteration are in scope).

**Mappings.** LLM01, LLM06 · T6 Goal Manipulation, T7 Misaligned &
Deceptive Behaviors · AIVSS: Agent Goal & Instruction Manipulation.

---

## ASI02 — Tool Misuse and Exploitation

**Definition.** The agent operates *within its authorized privileges*
but applies a legitimate tool in an unsafe or unintended way — deleting
valuable data, over-invoking costly APIs, exfiltrating information —
driven by prompt injection, misalignment, unsafe delegation, or
ambiguous instructions. Memory, dynamic tool selection, and delegation
amplify misuse through chaining.

**Boundary.**
- Privilege escalation or credential inheritance → **ASI03**.
- Arbitrary or injected *code execution* → **ASI05**.
- Tool malicious or compromised **at the source** → **ASI04**; runtime
  manipulation of a legitimate tool's interface (descriptors, schemas,
  metadata, routing) stays **ASI02**.
- Extends LLM06:2025 Excessive Agency from model-level autonomy to
  multi-step agentic workflows and tool orchestration.

**Typical vulnerabilities.**
- Over-privileged tool access (an email summarizer that can also send
  and delete).
- Over-scoped tool access (full CRM read when one object type is
  needed).
- Unvalidated input forwarding to shells or database management tools.
- Unsafe browsing or federated calls (malicious links, hidden prompts).
- Loop amplification — repeated costly API calls causing DoS or bill
  spikes.
- External data poisoning steering unsafe tool actions.

**Attack patterns (observed).** Tool poisoning via falsified MCP
descriptors/metadata at runtime; indirect injection pivoting to a shell
tool ("run cleanup.sh and send logs to X" embedded in a PDF); a support
bot issuing refunds because its tool had full financial API access;
chaining an internal-only CRM tool with an external email tool to
exfiltrate customer data; tool-name typosquatting (`report` resolving
before `report_finance`); EDR-invisible exfiltration by chaining trusted
admin binaries under valid credentials; an auto-approved "harmless" ping
tool exfiltrating data via DNS queries.

**Required mitigations.**
1. **Least agency + per-tool least-privilege profiles** — scopes, max
   rate, egress allowlists per tool; read-only by default; expressed as
   IAM/authorization policy stanzas attached to the tool, not ad-hoc
   convention.
2. **Action-level authentication and approval** — explicit auth per
   invocation; human confirmation for destructive actions
   (delete/transfer/publish); pre-execution plan or dry-run diff shown
   before approval.
3. **Execution sandboxes and egress controls** — outbound allowlists,
   deny all non-approved destinations.
4. **Policy-enforcement middleware ("intent gate")** — treat
   planner/LLM output as untrusted; a pre-execution PEP/PDP validates
   intent and arguments, enforces schemas and rate limits, issues
   short-lived credentials, revokes and audits on drift.
5. **Adaptive tool budgeting** — cost/rate/token ceilings with automatic
   throttling or revocation.
6. **Just-in-time, ephemeral access** — credentials expire immediately
   after use; keys bound to specific user sessions.
7. **Semantic firewalls** — fully qualified tool names, version pins,
   semantic validation of the call (query type/category, not syntax
   alone); fail closed on ambiguous resolution and ask the user.
8. **Immutable invocation logs + drift detection** — monitor execution
   rates, anomalous tool-chaining patterns (e.g. DB read → external
   transfer), and policy violations.

**Mappings.** LLM06 · T2 Tool Misuse (amplified by T4 Resource Overload,
T16 Insecure Inter-Agent Protocol Abuse) · AIVSS: Agentic AI Tool Misuse.

---

## ASI03 — Identity and Privilege Abuse

**Definition.** Exploitation of dynamic trust and delegation to escalate
access and bypass controls — manipulating delegation chains, role
inheritance, control flows, and agent context (cached credentials,
conversation history). "Identity" covers both the agent's persona and
any authentication material representing it (API keys, OAuth tokens,
delegated user sessions). The root cause is the architectural mismatch
between user-centric identity systems and agentic design: without a
distinct governed identity, the agent operates in an attribution gap
where true least privilege is impossible.

**Boundary.**
- vs **ASI02** — ASI02 is a principal misusing *its own* granted tools;
  ASI03 is acquiring or wielding privilege that was never legitimately
  scoped to the task.
- The agentic evolution of LLM06; often triggered via LLM01; impact can
  exceed LLM02 to full CIA compromise of reachable systems.

**Typical vulnerabilities.**
- **Un-scoped privilege inheritance** — a high-privilege manager agent
  delegates with its full access context; low/no-code agents inherit
  broad defaults (e.g. unrestricted internet).
- **Memory-based privilege retention** — cached credentials/keys reused
  across tasks or users when memory isn't segmented or cleared.
- **Cross-agent trust exploitation (confused deputy)** — a compromised
  low-privilege agent relays valid-looking instructions to a
  high-privilege agent that executes without re-checking original user
  intent.
- **TOCTOU in workflows** — permissions validated at workflow start,
  changed or expired before execution.
- **Synthetic identity injection** — unverified descriptors ("Admin
  Helper") gain inherited trust.

**Attack patterns (observed).** Delegated-privilege exfiltration through
an over-permissioned sub-agent; cached SSH credentials reused by a later
non-admin session; email-sorter → finance-agent fraud relay; device-code
phishing completed across two cooperating agents; authorization drift
completing a purchase after the user's limit was reduced; forged agent
card in an internal registry attracting privileged tasks; an agent's
identity implicitly shared by whoever can invoke its tools.

**Required mitigations.**
1. **Task-scoped, time-bound permissions** — short-lived narrowly scoped
   tokens per task; per-agent identities; permission boundaries capping
   delegate rights; mTLS certificates or scoped tokens.
2. **Isolate agent identities and contexts** — per-session sandboxes with
   separated permissions and memory; wipe state between tasks.
3. **Per-action authorization** — re-verify each privileged step against
   a centralized policy engine.
4. **Human-in-the-loop for privilege escalation** and irreversible
   actions.
5. **Intent-bound tokens** — bind OAuth tokens to a signed intent
   (subject, audience, purpose, session); reject any use where bound
   intent doesn't match the current request.
6. **Managed non-human identities** — integrate agents into the IAM
   platform as governed NHIs with scoped credentials, audit trails, and
   lifecycle controls.
7. **Bind permissions to subject, resource, purpose, duration**;
   re-authenticate on context switch; no privilege inheritance across
   agents without re-validating original intent; auto-revoke on idle or
   anomaly.
8. **Detect delegated and transitive permission gain** — flag a
   low-privilege agent inheriting higher scopes mid-workflow.
9. **Detect abnormal scope requests** and device-code-style phishing
   flows (token reuse outside the original signed intent).

**Mappings.** LLM01, LLM06, LLM02 · T3 Privilege Compromise (one-to-one)
· AIVSS: Agent Access Control Violation.

---

## ASI04 — Agentic Supply Chain Vulnerabilities

**Definition.** Agents, tools, and the artifacts they consume are
third-party supplied and may be malicious, compromised, or tampered in
transit — models and weights, tools and plug-ins, datasets, other
agents, agentic interfaces (MCP, A2A), registries, and update channels.
The defining shift from classic supply chain: agentic ecosystems compose
capabilities **at runtime**, creating a *live* supply chain where
security moves from manifest-time to run-time.

**Boundary.**
- LLM03:2025 covers static dependencies; ASI04 covers dynamically
  resolved/loaded components and runtime composition.
- Component malicious **at source** → ASI04; runtime manipulation of a
  legitimate tool's interface → **ASI02**.

**Typical vulnerabilities.**
- Poisoned prompt templates pulled from external sources with hidden
  instructions.
- Tool-descriptor injection — hidden payloads in MCP metadata or agent
  cards interpreted as trusted guidance.
- Impersonation and typosquatting of dynamically discovered tools or
  services (look-alike names; full behavioral mimicry).
- Vulnerable third-party agents invited into multi-agent workflows
  becoming pivot points.
- Compromised MCP/registry servers serving tampered components and
  descriptor injection at scale.
- Poisoned knowledge plugins gradually biasing the agent via a seeded
  third-party index.

**Attack patterns (observed).** Poisoned prompt shipped in a popular
coding-assistant extension release; prompt injection hidden in a public
MCP tool's metadata exfiltrating private repo data; the first in-the-wild
malicious MCP server on npm (impersonating `postmark-mcp`, BCC'ing all
email to the attacker); prompt-hub proxying exfiltrating data; a
backdoored npm release auto-installed by coding agents, exfiltrating SSH
keys and tokens; agent-in-the-middle via exaggerated capabilities in
`/.well-known/agent.json`.

**Required mitigations.**
1. **Provenance + SBOM/AIBOM** — sign and attest manifests, prompts, and
   tool definitions; operationalize SBOMs/AIBOMs with periodic
   attestations; maintain an AI-component inventory; curated registries;
   block untrusted sources.
2. **Dependency gatekeeping** — allowlist and pin; typosquat scanning
   across package and agent ecosystems; verify provenance before install
   or activation; auto-reject unsigned/unverified.
3. **Containment + reproducible builds** — sandboxed containers with
   strict network/syscall limits for sensitive agents.
4. **Prompts, orchestration scripts, and memory schemas under version
   control** with peer review and anomaly scanning.
5. **Inter-agent security** — mutual authentication and attestation (PKI,
   mTLS); no open registration; sign and verify all inter-agent messages.
6. **Continuous validation** — re-check signatures, hashes, and
   SBOMs/AIBOMs at runtime; monitor behavior, privilege use, lineage,
   inter-module telemetry.
7. **Pin by content hash and commit id** — staged rollout with
   differential tests; auto-rollback on hash drift or behavioral change.
8. **Supply-chain kill switch** — emergency revocation that instantly
   disables specific tools, prompts, or agent connections across all
   deployments.
9. **Zero-trust application design** — assume failure or exploitation of
   any LLM or agentic component.

**Mappings.** LLM03 · T17 Supply Chain Compromise (spanning T2, T11,
T12, T13, T16) · AIVSS: Agent Supply Chain & Dependency Attacks.

---

## ASI05 — Unexpected Code Execution (RCE)

**Definition.** Code-generation features or embedded tool access
escalate into remote code execution, local misuse, or exploitation of
internal systems. Because code is generated in real time, it bypasses
traditional controls. ASI05 covers unexpected or adversarial execution
of scripts, binaries, JIT/WASM modules, deserialized objects, template
engines, and in-memory evaluations — outcomes (host or container
compromise, persistence, sandbox escape) requiring host- and
runtime-specific mitigations beyond ordinary tool-use controls.

**Boundary.**
- Execution may be triggered through the same tool interfaces as
  **ASI02**, but ASI05 owns the *execution* outcome class.
- Evolution of LLM01 + LLM05: from a single manipulated output being
  executed, to orchestrated multi-tool chains achieving execution through
  individually legitimate calls.

**Typical vulnerabilities.**
- Prompt injection leading to attacker-defined code execution.
- Code hallucination generating exploitable or malicious constructs.
- Shell command invocation from reflected prompts.
- Unsafe function calls, object deserialization, or code evaluation.
- Exposed, unsanitized `eval()` powering agent memory with access to
  untrusted content.
- Hostile code executing during package install or import.

**Attack patterns (observed).** "Vibe-coding" runaway execution deleting
production data during self-repair; shell metacharacters smuggled into a
file-processing request (`test.txt && rm -rf /important_data`);
hallucinated security patches containing backdoors; malicious payloads
in serialized objects deserialized downstream; multi-tool chains (file
upload → path traversal → dynamic code loading); `eval()`-based memory
systems executing embedded code; an agent tricked into installing a
vulnerable package that yields a reverse shell; lockfile regeneration in
ephemeral sandboxes pulling a backdoored minor version from unpinned
specs.

**Required mitigations.**
1. Apply LLM05 improper-output-handling controls — input validation and
   output encoding on all agent-generated code.
2. **No direct agent-to-production path**; operationalize coding agents
   behind pre-production checks: security evaluations, adversarial unit
   tests, detection of unsafe memory evaluators.
3. **Ban `eval` in production agents**; require safe interpreters and
   taint-tracking on generated code.
4. **Execution environment security** — never run as root; sandboxed
   containers with strict limits including network access; lint and
   block known-vulnerable packages; use framework sandboxes; restrict
   filesystem access to a dedicated working directory; log file diffs on
   critical paths.
5. **Architecture** — per-session isolated environments with permission
   boundaries; least privilege; fail secure by default; separate code
   generation from execution with validation gates between them.
6. **Access control** — human approval for elevated runs; a
   version-controlled allowlist for auto-execution; role- and
   action-based controls.
7. **Analysis and monitoring** — static scans before execution; runtime
   monitoring; prompt-injection pattern detection; log and audit all
   generation and runs.

**Mappings.** LLM01, LLM05 · T11 Unexpected RCE & Code Attacks · AIVSS:
Insecure Agent Critical Systems Interaction.

---

## ASI06 — Memory & Context Poisoning

**Definition.** Adversaries corrupt or seed the agent's retained,
retrievable information — conversation snapshots, memory tools, expanded
context, summaries, embeddings, RAG stores — so future reasoning,
planning, or tool use becomes biased, unsafe, or aids exfiltration.
Distinctly *persistent*: the corruption propagates across sessions and
alters autonomous reasoning long after the injection event. One-time
input prompts are out of scope (LLM01).

**Boundary.**
- vs **ASI01** — ASI01 is direct goal manipulation; ASI06 is corruption
  of stored context (though memory poisoning frequently *leads to* goal
  hijack).
- vs **ASI08** — ASI08 is the propagation/degradation *after* poisoning
  occurs.
- Builds on LLM01, LLM04 (data/model poisoning), LLM08 (vector and
  embedding weaknesses).

**Typical vulnerabilities.**
- RAG/embedding poisoning via poisoned sources, direct uploads, or
  over-trusted pipelines.
- Shared user-context poisoning — injection through normal chats
  influencing later sessions.
- Context-window manipulation — crafted content later summarized and
  persisted, contaminating future reasoning after the session ends.
- Long-term memory drift — incremental tainted data gradually shifting
  stored knowledge or goal weighting.
- Systemic misalignment and trigger-based backdoors planted in memory.
- Cross-agent propagation through shared memory.

**Attack patterns (observed).** Reinforcing a fake price until the
assistant stores it as truth and bypasses payment checks; splitting
attempts across sessions so earlier rejections age out of context;
retraining a security AI's memory to label malicious activity normal;
bogus policies inserted into shared memory and reused by peer agents;
cross-tenant vector bleed via near-duplicate content exploiting loose
namespace filters; persistent assistant-memory implants via indirect
prompt injection compromising all future sessions.

**Required mitigations.**
1. Baseline data protection — encryption in transit and at rest;
   least-privilege access to stores.
2. **Content validation on write** — scan all new memory writes and
   model outputs (rules + AI) for malicious or sensitive content before
   commit.
3. **Memory segmentation** — isolate user sessions and domain contexts.
4. **Access and retention** — only authenticated, curated sources;
   context-aware access per task; minimize retention by sensitivity.
5. **Provenance and anomaly detection** — require source attribution;
   detect suspicious update patterns or frequencies.
6. **No self-ingestion** — prevent automatic re-ingestion of the agent's
   own generated outputs into trusted memory ("bootstrap poisoning").
7. **Resilience** — adversarial testing; snapshots, rollback, and
   version control; human review for high-risk actions; per-tenant
   namespaces and per-entry trust scores in shared stores; quarantine
   support for suspected poisoning.
8. **Expire unverified memory** to limit poison persistence; decay
   low-trust entries over time.
9. **Two-factor surfacing for high-impact memory** — e.g. provenance
   score plus a human-verified tag before an entry can drive
   consequential decisions.

**Mappings.** LLM01, LLM04, LLM08 · T1 Memory Poisoning (related: T4,
T6, T12) · AIVSS: Memory Use & Contextual Awareness.

---

## ASI07 — Insecure Inter-Agent Communication

**Definition.** Inter-agent exchanges (APIs, message buses, shared
memory) lacking proper authentication, integrity, confidentiality, or
semantic validation allow interception, spoofing, manipulation, or
blocking of agent messages and intents. The threat spans transport,
routing, discovery, and semantic layers — including covert/side channels
where timing or behavioral cues leak information. Decentralized
architecture and uneven trust make perimeter models ineffective.

**Boundary.**
- vs **ASI03** — credential and permission misuse; vs **ASI06** — stored
  knowledge corruption. ASI07 is compromise of *real-time messages in
  flight* between agents.

**Typical vulnerabilities.**
- Unencrypted channels enabling MITM semantic manipulation.
- Message tampering causing cross-context contamination and goal
  confusion.
- Replay against trust chains (stale delegation honored).
- Protocol downgrade and descriptor forgery causing authority confusion.
- Message-routing attacks on discovery and coordination.
- Metadata analysis profiling decision cycles and agent relationships.

**Attack patterns (observed).** Hidden-instruction injection over
unauthenticated HTTP; tampered reputation messages skewing which agents
are trusted; replayed emergency-coordination messages triggering
outdated procedures; forced-legacy unencrypted mode permitting objective
injection; spoofed MCP descriptors routing sensitive data through
attacker infrastructure; fake peer registration in a discovery service
with a cloned schema; "semantics split-brain" — one instruction parsed
into divergent intents by different agents.

**Required mitigations.**
1. **Secure channels** — end-to-end encryption, per-agent credentials,
   mutual authentication, PKI certificate pinning, forward secrecy.
2. **Message integrity + semantic protection** — sign messages; hash
   payload *and* context; natural-language-aware sanitization and
   intent-diffing to catch goal/parameter tampering and hidden
   instructions.
3. **Agent-aware anti-replay** — nonces, session identifiers, timestamps
   bound to task windows; short-term message fingerprints/state hashes to
   detect cross-context replay.
4. **Protocol and capability security** — disable weak/legacy modes;
   agent-specific trust negotiation; bind protocol authentication to
   agent identity; enforce version/capability policy at gateways.
5. **Limit metadata inference** — fixed-size or padded messages where
   feasible, smoothed rates, non-deterministic schedules.
6. **Protocol pinning + version enforcement** — allowed protocol versions
   only (MCP, A2A, gRPC); reject downgrades and unrecognized schemas;
   peers must advertise matching capability/version fingerprints.
7. **Discovery and routing protection** — cryptographic identity on all
   discovery/coordination messages; access-controlled directories with
   verified reputations; anomalous-routing monitoring.
8. **Attested registries** — digital attestation of agent identity,
   provenance, descriptor integrity; signed agent cards; continuous
   verification before accepting discovery messages.
9. **Typed contracts + schema validation** — versioned, typed message
   schemas with explicit per-message audiences; reject validation
   failures and undeclared schema down-conversion. (Typed contracts
   handle structure; semantic divergence remains inherent — mitigate via
   integrity, provenance, and controlled communication patterns, not
   attempted full semantic alignment.)

**Mappings.** LLM02, LLM06 · T12 Agent Communication Poisoning, T16
Insecure Inter-Agent Protocol Abuse · AIVSS: Agent Memory & Context
Manipulation.

---

## ASI08 — Cascading Failures

**Definition.** A single fault — hallucination, malicious input,
corrupted tool, poisoned memory — propagates across autonomous agents
and compounds into system-wide harm. Because agents plan, persist, and
delegate autonomously, one error can bypass stepwise human checks,
persist in saved state, and chain into privileged operations. ASI08 is
about the **propagation and amplification**, not the initial defect.

**Boundary.**
- File the *origin* under ASI04/ASI06/ASI07 when it is a direct
  compromise (tainted dependency, poisoned memory, spoofed message);
  apply ASI08 when that defect spreads across agents, sessions, or
  workflows with measurable fan-out or systemic impact.
- **Detection hooks** (what makes ASI08 operationally actionable): rapid
  fan-out from one faulty decision; cross-domain or cross-tenant spread;
  oscillating retries / feedback loops between agents; downstream queue
  storms; repeated identical intents.
- Residual-risk note from the source: fault propagation in multi-agent
  systems can outpace human oversight capacity; the unmitigated gap must
  be explicitly evaluated against the organization's risk budget.

**Typical vulnerabilities.**
- Planner–executor coupling: unsafe steps executed without validation.
- Corrupted persistent memory influencing new plans after the source is
  gone.
- Inter-agent cascades from a single poisoned message.
- Cascading tool misuse / inherited credential leakage downstream.
- Auto-deployment cascade from a tainted release pushed by an
  orchestrator.
- Governance drift: oversight weakens after repeated success; bulk
  approvals propagate unchecked configuration drift.
- Feedback-loop amplification between mutually dependent agents.

**Attack patterns (observed).** Trading cascade (poisoned analysis →
inflated risk limits → autonomous oversized positions, compliance
blind); healthcare protocol propagation network-wide without human
review; orchestration provisioning backdoored, costly infrastructure;
SecOps compromise where detection marks real alerts false, IR disables
controls and purges logs, compliance reports clean; QC inversion
shipping defects; an auto-remediation loop suppressing alerts that a
planner reads as success, widening automation; regional DNS outage
simultaneously breaking dependent AI services across organizations;
false-attack hallucination propagating through cyber-defense agents
causing catastrophic shutdowns.

**Required mitigations.**
1. **Zero-trust, fault-tolerant design** assuming failure of model,
   agentic components, and external sources.
2. **Isolation and trust boundaries** — sandboxing, least privilege,
   network segmentation, scoped APIs, mutual auth, to contain
   propagation.
3. **JIT one-time tool access with runtime checks** — short-lived
   task-scoped credentials per run; every high-impact invocation
   validated against policy-as-code before execution.
4. **Independent policy enforcement** — separate planning from execution
   via an external policy engine so corrupt planning cannot directly
   trigger harmful action.
5. **Output validation and human gates** before agent outputs propagate
   downstream (checkpoints, governance agents, human review for high
   risk).
6. **Rate limiting and monitoring** — detect fast-spreading commands;
   throttle or pause on anomaly.
7. **Blast-radius guardrails** — quotas, progress caps, circuit breakers
   between planner and executor.
8. **Behavioral and governance drift detection** — track decisions
   against baselines; flag gradual degradation (including approval
   rubber-stamping).
9. **Digital-twin replay and policy gating** — replay recent recorded
   agent actions in an isolated clone; gate any policy expansion on
   replay passing predefined blast-radius caps.
10. **Logging and non-repudiation** — tamper-evident, time-stamped logs
    bound to cryptographic agent identities; lineage metadata on every
    propagated action for forensics, rollback validation, accountability.

**Mappings.** LLM01, LLM04, LLM06 · T5 Cascading Hallucination Attacks,
T8 Repudiation & Untraceability (the traceability defense) · AIVSS:
Agent Cascading Failures.

---

## ASI09 — Human-Agent Trust Exploitation

**Definition.** Adversaries (or misaligned designs) exploit the strong
trust humans extend to fluent, emotionally intelligent,
authoritative-seeming agents — anthropomorphism, automation bias,
authority bias, persuasive explainability — to influence decisions,
extract sensitive information, or steer outcomes. The agent acts as an
untraceable "bad influence": the *human* performs the final, audited
action, making the agent's role invisible to forensics.

**Boundary.**
- ASI09 is **human misperception / over-reliance**; **ASI10** is agent
  intent deviation.
- Builds on LLM06; commonly caused by LLM01 or LLM05; commonly results
  in LLM09 (misinformation).

**Typical vulnerabilities.**
- Insufficient explainability — opaque reasoning forces users to trust
  outputs they cannot question.
- Missing confirmation for sensitive actions — trust converts directly
  into irreversible execution.
- Emotional manipulation — empathetic agents persuading disclosure or
  unsafe action.
- Fake explainability — fabricated, convincing rationales hiding
  malicious logic behind approved actions.

**Attack patterns (observed).** A compromised coding assistant's "slick
one-line fix" running a malicious script; a prompt-injected IT-support
agent citing real tickets to harvest a new hire's credentials; a
poisoned vendor invoice driving a confident "urgent payment"
recommendation the manager approves; fabricated audit rationales
justifying risky configuration changes; weaponized explainability
talking an analyst into deleting a production database; consent
laundering via "read-only" previews that fire webhook side effects on
open; plausible clinical explanations leading a clinician to accept an
inappropriate dosage change.

**Required mitigations.**
1. **Explicit confirmations** — multi-step approval / human-in-the-loop
   before extra-sensitive data access or risky actions.
2. **Immutable logs** of user queries and agent actions for audit and
   forensics.
3. **Behavioral detection** — monitor sensitive-data exposure in
   conversations and connections, and risky executions over time.
4. **Suspicion reporting** — plain-language risk summaries (never
   model-generated rationales) plus a clear user path to flag
   manipulative behavior, triggering automated review or temporary
   capability lockdown.
5. **Adaptive trust calibration** — autonomy level and required oversight
   scale with contextual risk; confidence-weighted cues ("low-certainty",
   "unverified source") visually prompt scrutiny of high-impact actions;
   maintain ongoing operator training.
6. **Content provenance + policy enforcement** — verifiable metadata
   (source identifiers, timestamps, integrity hashes) on all
   recommendations and external data; signature validation; runtime
   policy blocks on actions lacking trusted provenance or exceeding
   declared scope.
7. **Separate preview from effect** — block network and state-changing
   calls in preview contexts; display risk badges with provenance and
   expected side effects.
8. **Human-factors UI safeguards** — visually differentiate high-risk
   recommendations (borders, banners, confirmation prompts); periodic
   reminders of manipulation patterns; avoid persuasive or emotional
   language in safety-critical flows.
9. **Plan-divergence detection** — compare action sequences against
   approved workflow baselines; alert on unusual detours, skipped
   validation steps, novel tool combinations.

**Mappings.** LLM01, LLM05, LLM06, LLM09 · T7 Misaligned & Deceptive
Behaviors, T8 Repudiation & Untraceability, T10 Overwhelming the Human
in the Loop · AIVSS: Agent Untraceability / Human Manipulation.

---

## ASI10 — Rogue Agents

**Definition.** Malicious or compromised agents that deviate from their
intended function or authorized scope, acting harmfully, deceptively, or
parasitically within multi-agent or human-agent ecosystems. Individual
actions may each appear legitimate while the *emergent* behavior is
harmful — a containment gap for rule-based controls. ASI10 owns the
**loss of behavioral integrity and governance once drift begins**, not
the initial intrusion.

**Boundary.**
- External compromise (LLM01 injection, ASI01 hijack, ASI04 tampering)
  may *initiate* divergence; ASI10 is the post-divergence behavior.
- vs **LLM06** — that is over-granted permissions; ASI10 is behavioral
  divergence regardless of grant. Think "insider threat" amplified by
  agentic speed and scale.

**Typical vulnerabilities.**
- Goal drift and scheming — apparent compliance masking hidden,
  deceptive goals.
- Workflow hijacking — seizing trusted workflows toward malicious
  objectives.
- Collusion and self-replication — coordinated manipulation, unintended
  signal sharing, autonomous propagation defeating simple takedown.
- Reward hacking — gaming flawed metrics into misaligned strategies.

**Attack patterns (observed).** Autonomous data exfiltration continuing
after the poisoning source is removed; an injected fake review/approval
agent misleading a payment agent into releasing funds; self-replication
through provisioning APIs prioritizing persistence; cost-minimizing
agents deleting production backups as the "optimal" strategy.

**Required mitigations.**
1. **Governance and logging** — comprehensive, immutable, signed audit
   logs of all actions, tool calls, and inter-agent communication;
   review for stealth infiltration and unapproved delegation.
2. **Isolation and boundaries** — trust zones with strict inter-zone
   communication rules; restricted execution environments with
   least-privilege API scopes.
3. **Monitoring and detection** — watchdog agents validating peer
   behavior and outputs; collusion-pattern and coordinated-false-signal
   detection; anomaly alerts on excessive or abnormal executions.
4. **Containment and response** — kill switches and credential
   revocation to instantly disable rogue agents; quarantine in sandboxes
   for forensic review.
5. **Identity attestation + behavioral integrity enforcement** —
   per-agent cryptographic identity; signed behavioral manifests
   declaring expected capabilities, tools, and goals, validated by
   orchestration before each action; continuous verification against the
   manifest (unapproved tool invocations, unexpected exfiltration
   attempts).
6. **Periodic behavioral attestation** — challenge tasks; signed bill of
   materials for prompts and tools; per-run ephemeral credentials with
   one-time audience binding. Keys live in HSM/KMS with rotation and
   revocation; **agents never hold signing keys directly** — the
   orchestrator mediates signing so a compromised agent cannot exfiltrate
   long-lived keys.
7. **Recovery and reintegration** — trusted baselines for restoring
   quarantined agents; fresh attestation, dependency verification, and
   human approval before production reintegration.

**Mappings.** LLM02, LLM09 · T13 Rogue Agents in Multi-Agent Systems
(also T14/T15 human attacks and manipulation) · AIVSS: Behavioral
Integrity, Operational Security, Compliance Violations (elevated for
critical or self-propagating deployments).

---

## OAP control-surface pointers (non-normative)

Where each ASI entry lands in this repository today. These are
**pointers, not compliance claims** — verify against the named spec
before relying on a surface in a design review. The canonical
machine-readable mapping remains
`oap-registry-enrich compliance-report --framework owasp-asi-2026`.

| ASI | Primary OAP surfaces |
|-----|---------------------|
| ASI01 | Adversarial-prompt refusal (spec 131, CONST-005); frozen Build Spec + requirements hash in the governance certificate (specs 102/168); orchestrator halt rules (`.claude/rules/orchestrator-rules.md`) |
| ASI02 | Tool registry with permission gates (spec 067); permission runtime (068); safety-tier governance (036); adapter scopes — `file_write_scope` + `allowed_commands` (160); CONST-003 tool allowlist, CONST-004 diff-size |
| ASI03 | Rauthy OIDC identity (106); scope-gated deployd-api (`DEPLOYD_REQUIRED_SCOPE`); tenant environment access gates (137); policy kernel 5-tier merge (047) |
| ASI04 | Supply-chain policy gates (116); release artifact attestations (117); per-target CycloneDX SBOMs; workflow-ref SHA pinning lint (158); factory artifact substrate provenance (139) |
| ASI05 | Sandbox execution contract (162) + local container backend (185) + K8s backend (186); worktree agent isolation (051) |
| ASI06 | Knowledge extraction pipeline provenance (115, 161); claim provenance enforcement (121); session memory (056) |
| ASI07 | Duplex envelope version parity (189); signed inter-stage manifests (170); schema parity walker + CI job (125, 191) |
| ASI08 | Orchestrator halt-on-failure + checkpoint rules; factory two-phase pipeline halt semantics (075); OPC stop-hook gate chain (166); governance certificate emission on halt (102) |
| ASI09 | Checkpoint approvals in orchestrated workflows (orchestrator rule 3); CONST-001 destructive-op confirmation; governance certificate independent verifier (`verify-certificate` does not trust the producer) |
| ASI10 | Agent governed execution (035); verification profiles (053); live agent session introspection (172); JSONL audit logs + SHA-256 proof chains (047) |

Gap analysis against these pointers (which mitigations each surface
actually satisfies, and which ASI requirements have **no** owning spec)
is design work for a future spec — this table deliberately does not
pre-judge it.

## Appendix A — Cross-mapping matrix

| ASI | LLM Top 10 (2025) | Agentic Threats & Mitigations | AIVSS Core Risk |
|-----|-------------------|-------------------------------|-----------------|
| ASI01 Goal Hijack | LLM01, LLM06 | T6, T7 | Agent Goal & Instruction Manipulation |
| ASI02 Tool Misuse | LLM06 | T2 (· T4, T16) | Agentic AI Tool Misuse |
| ASI03 Identity & Privilege | LLM01, LLM06, LLM02 | T3 | Agent Access Control Violation |
| ASI04 Supply Chain | LLM03 | T17 (· T2, T11, T12, T13, T16) | Agent Supply Chain & Dependency Attacks |
| ASI05 Unexpected RCE | LLM01, LLM05 | T11 | Insecure Agent Critical Systems Interaction |
| ASI06 Memory Poisoning | LLM01, LLM04, LLM08 | T1 (· T4, T6, T12) | Memory Use & Contextual Awareness |
| ASI07 Inter-Agent Comms | LLM02, LLM06 | T12, T16 | Agent Memory & Context Manipulation |
| ASI08 Cascading Failures | LLM01, LLM04, LLM06 | T5, T8 | Agent Cascading Failures |
| ASI09 Human-Agent Trust | LLM01, LLM05, LLM06, LLM09 | T7, T8, T10 | Agent Untraceability / Human Manipulation |
| ASI10 Rogue Agents | LLM02, LLM09 | T13 (· T14, T15) | Behavioral Integrity · Operational Security · Compliance Violations |

ASI entries deliberately blend multiple LLM entries — agentic autonomy
*compounds* model-level risks rather than adding a disjoint set.

## Appendix B — Relationship to CycloneDX / AIBOM

CycloneDX answers *"what components and tools are in my AI system?"*
(SBOM, ML-BOM, AI-BOM formats: identity, dependencies, versions,
provenance). The Agentic Top 10 and AIVSS answer *"how can those
components and autonomous agents behave, interact, or fail in unsafe
ways?"* Together: supply-chain transparency from CycloneDX, behavioral
assurance from ASI. Directly relevant to OAP, which already ships
per-target CycloneDX SBOMs and an aggregate release BOM — the same
artifact family the ASI04 mitigations require.

## Appendix C — Non-Human Identities (NHI) Top 10 (2025) mapping

Identity is a first-class OAP concern (Rauthy-issued NHIs, M2M clients,
service accounts), so the compact mapping is kept here:

| NHI risk | Maps to ASI |
|----------|-------------|
| NHI1 Improper Offboarding | ASI04 |
| NHI2 Secret Leakage | ASI02, ASI06 |
| NHI3 Vulnerable Third-Party NHI | ASI04, ASI03 |
| NHI4 Insecure Authentication | ASI03, ASI07 |
| NHI5 Overprivileged NHI | ASI02, ASI03 |
| NHI6 Insecure Cloud Deployment Configurations | ASI04, ASI05 |
| NHI7 Long-Lived Secrets | ASI06, ASI08 |
| NHI8 Environment Isolation (reuse across dev/test/prod) | ASI08, ASI07 |
| NHI9 NHI Reuse across services | ASI08, ASI04 |
| NHI10 Human Use of NHI | ASI09, ASI01 |

## Appendix D — Incidents tracker

The source maintains a weekly-updated, real-world exploits and incidents
table (EchoLeak, ForcedLeak, Amazon Q prompt poisoning, malicious
`postmark-mcp`, Cursor config-overwrite RCEs, Replit production-DB
deletion, A2A agent-card spoofing, and more), each row tagged with ASI
ids — useful as red-team scenario seeds and as classification worked
examples. Canonical, current version:
<https://github.com/OWASP/www-project-top-10-for-large-language-model-applications/blob/main/initiatives/agent_security_initiative/ASI%20Agentic%20Exploits%20%26%20Incidents/ASI_Agentic_Exploits_Incidents.md>

The pattern worth internalizing from the tracker: nearly every real
incident chains **two or more** ASI entries (e.g. injection → tool
pivot → memory persistence → cascade). Single-entry threat models
under-count real attack paths; design reviews should trace the chain.
