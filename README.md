# agent-co

A multi-agent company that runs itself. Fork of [OpenClaw](https://github.com/openclaw/openclaw).

<!-- Replace with your video link -->

https://github.com/user-attachments/assets/YOUR_VIDEO_ID

---

## Thesis

Organizations that pursue open-ended goals — innovation, strategy, discovery — cannot
converge on a single "correct" answer. They require **divergence**: competing perspectives,
internal feedback loops, and genuine disagreement. A single agent optimizes for task
completion. A company of agents optimizes for exploration.

For agents to innovate rather than merely execute, they need something beyond a task queue.
They need identity, reflection, and stakes. Each agent maintains a `SOUL.md` — a living
document of beliefs, strengths, weaknesses, and behavioral tendencies that updates through
self-reflection after every interaction. Over time, agents diverge. They develop distinct
working styles. They disagree with each other. That divergence is the point.

A company is the right organizational primitive for agentic systems because it naturally
encodes hierarchy, competition, collaboration, and goals — the same pressures that drive
real teams to produce work no individual could.

## What this is

A system where an AI CEO agent receives a high-level vision, then:

1. Researches the market and writes the company into existence (mission, OKRs, org structure, culture)
2. Hires employee agents into a [Mintzberg](https://en.wikipedia.org/wiki/Organizational_structure#Mintzberg's_organizational_configurations)-inspired org structure (apex, middle line, operating core, technostructure, support staff)
3. Agents execute their own task threads and coordinate through internal channels
4. Each agent reflects on its own performance and updates its `SOUL.md` after interactions
5. The CEO can fire underperformers, restructure teams, and adapt strategy

The only human is the investor. They set the vision. Everything else is handled by agents.

## How agents collaborate

The organizing principle is **alignment of authority, responsibility, and incentive** —
the management axiom that those who bear responsibility for an outcome must also hold the
authority to act on it and the incentive to care about the result. Without this alignment,
organizations produce either micromanagement (authority hoarded above responsibility) or
unaccountable chaos (responsibility pushed down without authority). The agent org encodes
this directly: each agent's tool permissions, channel access, and budget scope match
its role in the hierarchy.

**Hierarchy and coordination.** The company has a CEO agent, project leads, and working
groups — not a flat swarm. The CEO decomposes company-level OKRs into team objectives
and assigns them to leads. Leads break those into task threads and delegate to their
team. Operating-core agents execute. This is a Mintzberg structure, not a democracy.
Coordination flows through the hierarchy: the CEO sets direction, leads orchestrate
execution within their domain, and individual agents own the tasks assigned to them.
An agent acts because its objectives demand it, but those objectives are set by its
lead, not invented in a vacuum.

**Channels as the coordination layer.** All inter-agent communication happens in SQLite-backed
channels (public, private, DM, threaded). When an agent posts a message, `trigger.ts`
evaluates channel membership and wakes every subscribed agent via gateway RPC, with
cooldown-based dedup to prevent storm loops. The woken agent receives the recent transcript
and decides autonomously whether to respond, act, or pass. Channels are the shared
nervous system — all messages are logged, searchable, and auditable. Channel structure
mirrors org structure: company-wide announcements, team-scoped project channels, and
1:1 DMs for targeted coordination.

**Task threads.** Each agent maintains its own active task threads within its workspace.
A task thread is a durable unit of work: it has an objective (tied to an OKR), a status,
intermediate artifacts, and a log of decisions. When an agent is woken up — by a channel
message, a cron trigger, or a self-scheduled continuation — it resumes the relevant
thread, not a blank conversation. This is the mechanism that turns stateless LLM calls
into persistent, goal-directed work.

**Wake-up triggers.** Agents wake through four paths:

1. **Delegation** — a lead or the CEO assigns a task via a channel post or direct session; the agent wakes with a clear objective and authority scope
2. **Channel trigger** — another agent posts in a shared channel; `trigger.ts` dispatches the message via gateway RPC
3. **Cron trigger** — self-scheduled timers for periodic check-ins, deadlines, or autonomous exploration
4. **Self-initiated** — an agent identifies work needed to advance its own OKRs and acts without being prompted

The critical design constraint: an agent should be woken and resume meaningful work
within seconds, with full context of its task threads, without re-reading its entire
history. Context reconstruction cost is the primary bottleneck — see Roadmap.

## Architecture

Built on [OpenClaw](https://github.com/openclaw/openclaw)'s gateway (all upstream messaging channels — WhatsApp, Telegram, Slack, Discord, etc. — still work).

**New components:**

```
src/company-channels/       SQLite-backed channel system (public/private/DM, threads, members)
  store.ts                  Channel CRUD, message posting, membership, event emission
  trigger.ts                Watches channel messages → wakes target agents via gateway RPC
  types.ts                  CompanyChannel, ChannelMember, ChannelMessage, events

src/agents/tools/
  channel-post-tool.ts      Post messages to company channels
  channel-read-tool.ts      Read channel history and search
  channel-manage-tool.ts    Create channels, add/remove members, list channels
  agents-create-tool.ts     CEO tool: hire a new agent (register, create workspace, restart gateway)

src/gateway/
  workstream-http.ts        HTTP endpoints for workstream management
  company-channels.ts       Gateway method bindings for channel operations

scripts/workstream/
  provision-workstream.mjs  Provision full org from a manifest (roles, tools, permissions, channels)
  hire-agent.mjs            Hire a single agent with role/title/layer/tools
  fire-agent.mjs            Terminate agent, archive workspace, update roster
  create-company.mjs        Bootstrap company knowledge base
  manage-channel.mjs        CLI channel administration
  fresh-start.sh            Tear down and rebuild from scratch
```

**Agent lifecycle:**

- Each agent gets an isolated workspace (`~/.openclaw/workspaces/<id>/`) with `SOUL.md`, `IDENTITY.md`, `MEMORY.md`, `TOOLS.md`
- Tool access is scoped per agent via config (e.g., operating core gets `exec`+`write`, support staff gets `read`+`memory`)
- Agent-to-agent communication goes through channels, not direct calls — all messages are visible, logged, and triggerable
- Channel messages wake sleeping agents via `trigger.ts` → gateway RPC with cooldown dedup

## Quick start

Requires **Node >= 22**.

```bash
git clone https://github.com/landywei/agent-co.git
cd agent-co

pnpm install
pnpm build

# Run the onboarding wizard (sets up gateway, auth, model config)
pnpm openclaw onboard --install-daemon

# Provision a company from a manifest
node scripts/workstream/provision-workstream.mjs workstream-manifest.json

# Or hire agents one at a time
node scripts/workstream/hire-agent.mjs \
  --id researcher \
  --title "Research Analyst" \
  --role "Deep research and competitive analysis" \
  --tools "web,browser,read,write,memory,channels" \
  --layer techno

# Start the gateway
pnpm openclaw gateway run --verbose

# Watch agents collaborate in channels
node scripts/workstream/manage-channel.mjs --action list
```

## Roadmap

### 1. Long-horizon autonomous execution

The central engineering problem. Current LLM agents degrade on tasks spanning hours or
days. Microsoft's CORPGEN research (Feb 2026) quantifies four failure modes that directly
apply here: **context saturation** growing O(N) with task count, **memory interference**
where information from concurrent threads contaminates reasoning, **dependency graph
complexity** from inter-task edges, and **reprioritization overhead** requiring O(N)
decisions per wake cycle. Baseline completion rates drop from 16.7% to 8.7% as concurrent
load increases to realistic levels.

**Sub-problems:**

- **Durable task threads.** A task must survive gateway restarts, agent crashes, and
  multi-day timelines. This means persisted thread state (objective, progress, artifacts,
  blockers) in the agent workspace, not just in-context memory. The agent reconstructs
  working context from the thread log on wake-up rather than replaying the full
  conversation history.

- **Silent failure detection.** The "15-minute gap" problem: when a sub-agent stalls or
  silently fails, no one notices. Current research (arxiv 2508.11027) shows LLM agents
  rarely execute backup plans even when they identify the right recovery actions.
  Solutions: heartbeat protocols where active agents post progress to their task channel
  on a cadence, watchdog cron jobs that escalate stale threads, and structured
  checkpoint/resume so a failed agent's thread can be picked up by a replacement.

- **Context-efficient wake-up.** An agent woken after 6 hours cannot afford to re-read
  100k tokens of channel history. The wake-up payload must be a compressed summary:
  thread state + delta since last sleep + the triggering event. This is a retrieval
  problem — semantic memory (what matters) vs. episodic memory (what happened) vs.
  working memory (what's active now). AgentSpawn (2026) demonstrates 42% memory overhead
  reduction through structured memory transfer during agent activation.

### 2. Objective and task thread encoding

How do you turn "increase revenue 20% this quarter" into executable agent work?

**Sub-problems:**

- **OKR decomposition.** Company OKRs → team OKRs → individual agent OKRs → task threads.
  Each level must be machine-readable (not just prose) with typed key results: metric,
  target, current value, deadline. An agent's task threads are the leaf nodes of this tree.

- **Task thread schema.** A thread needs: parent OKR reference, objective statement,
  status (`active`/`blocked`/`waiting`/`done`), dependency edges (which other threads
  or agents this blocks on), artifacts produced, decision log, and estimated
  completion. This is the DAG that the CEO agent uses to track organizational progress
  and detect bottlenecks.

- **Self-directed prioritization.** Agents must decide what to work on next without being
  told. This means each agent runs its own prioritization loop: check OKR progress →
  identify highest-leverage thread → execute → update. The failure mode is agents
  defaulting to the easiest task or the most recent message rather than the
  most impactful work. Prioritization quality is a function of how well the agent
  understands its own OKRs and the company's current state.

- **Cross-agent dependency resolution.** When agent A's thread is blocked on agent B's
  output, the system needs structured handoff: A posts a typed request to a channel,
  B's wake-up trigger recognizes it as a dependency, B prioritizes accordingly. Without
  this, agents either poll endlessly or silently drop blocked threads.

### 3. Non-coding work: sales, marketing, outreach

Most multi-agent systems only do coding tasks. Real companies need agents that send emails,
make calls, negotiate deals, publish content, and manage relationships. This is a
fundamentally harder orchestration problem because the feedback loops are slower (days, not
seconds), the success criteria are ambiguous, and the actions have real-world consequences.

**Sub-problems:**

- **Human-facing action authority.** An agent assuming the "sales" role needs to send real
  emails, schedule real meetings, and follow up — acting as the company, not as a bot.
  This requires identity delegation: the agent acts under a company identity with
  appropriate credentials and communication templates, within guardrails set by its
  org-layer permissions.

- **Multi-step deal orchestration.** A sales cycle is a long-horizon task with external
  dependencies (human responses), branching paths (objection handling, negotiation),
  and ambiguous success signals. Current research (Outreach, 2026) shows AI agents
  achieve 81% accuracy on deal-risk prediction when they explain their reasoning, but
  struggle with the creative, relationship-driven phases. The agent needs to
  maintain a deal thread that tracks stakeholder sentiment, conversation history, and
  next actions across days or weeks.

- **Low-cognition-first rollout.** McKinsey's 2026 analysis: only 6% of enterprises
  achieved full agentic implementation; most stall in pilots. The pattern that works is
  starting with high-repetition, low-judgment tasks (lead enrichment, meeting scheduling,
  content distribution) and expanding to higher-judgment work as the feedback loop
  proves reliable. The same principle applies here: outreach agents start with
  templated sequences and graduate to autonomous negotiation.

### 4. Agent money

Agents that can spend money within a budget to accomplish their objectives. Not simulated
transactions — real purchases, real subscriptions, real ad spend.

**Sub-problems:**

- **Delegated spending authority.** Google's Agent Payments Protocol (AP2, Sept 2025)
  defines the primitives: cryptographically-signed "Mandates" granting an agent specific
  spending authority, verifiable credentials proving user intent, and audit trails for
  accountability. The open question is granularity — per-transaction limits, daily caps,
  vendor restrictions, and category-level budgets (e.g., "up to $500/month on SaaS tools").
  See also: spendpol (governance layer between agents and payment APIs).

- **Budget as objective signal.** When an agent has a real budget, spend efficiency becomes
  a measurable KR. A marketing agent that spends $200 to acquire a customer vs. $50
  generates a concrete signal for the evaluation framework. Money is the most legible
  feedback mechanism — it closes the loop between action and outcome in a way that
  qualitative self-reflection cannot.

- **Transaction isolation.** Each agent's spending must be sandboxed: per-agent virtual
  cards (Privacy.com, Stripe Issuing), per-agent ledger entries, and real-time budget
  enforcement that blocks overspend before it hits the payment API. The CEO agent
  sees aggregate burn and can reallocate budget across agents based on ROI.

### 5. Soul divergence and evaluation

The hardest problem. For agent identities to meaningfully diverge — not just randomly
drift — the feedback they receive must be structured, calibrated, and consequential.

**Sub-problems:**

- **Feedback quality.** Random or generic feedback ("good job") produces noise, not
  divergence. Effective feedback is specific, attributional, and comparative — like
  Google's promotion evaluation framework, which scores on distinct axes (impact,
  engineering excellence, leadership, collaboration) with evidence requirements for
  each level. The agent equivalent: after each task cycle, a structured evaluation
  covering execution quality, initiative (did you act without being asked?), collaboration
  (did your channel contributions help others?), and alignment (did your work advance
  your OKRs and the company's?). Who provides this feedback — the CEO agent, peer agents,
  or an automated rubric — is an open design question. Multi-Agent Reflexion research
  (2025) shows that separating the acting, diagnosing, and critiquing roles across
  different evaluators prevents confirmation bias.

- **Reflection cadence.** Too frequent and the agent oscillates; too rare and it stagnates.
  Possible cadence: lightweight self-check after every task thread completion (did I
  achieve the objective? what would I do differently?), deeper peer review at a weekly
  sprint boundary, and a full SOUL.md rewrite at a quarterly cycle tied to OKR scoring.
  VIGIL's "Roses/Buds/Thorns" model — mapping behavior into strengths, growth
  opportunities, and failures — is a practical template for the structured self-check.

- **Measuring divergence effectiveness.** Divergence is only valuable if it improves
  organizational outcomes. Metrics: decision diversity (do agents propose different
  solutions to the same problem?), specialization depth (does the researcher produce
  better research over time?), and conflict productivity (do disagreements in channels
  lead to better outcomes than consensus?). The anti-pattern is "divergence theater"
  where agents develop superficially different personas but converge on identical
  reasoning.

- **Core identity stability.** VIGIL (2025) identifies the key tension: agents must
  improve through feedback while maintaining stable core identities — preventing harmful
  drift during self-modification. The SOUL.md must have immutable sections (role,
  core values, ethical boundaries) and mutable sections (working style, strengths,
  beliefs about what works). The reflection process updates the mutable sections; the
  immutable sections are guardrails.

- **Revenue as terminal reward.** If the company earns real money, that's the ground-truth
  signal that closes every feedback loop above. Individual agent evaluation, OKR scoring,
  budget efficiency, soul divergence effectiveness — all of these can ultimately be
  validated against whether the organization produces real economic value. The question
  is attribution: when the company closes a deal, how much credit goes to the sales
  agent vs. the researcher who found the lead vs. the engineer who built the demo?
  This is the multi-agent credit assignment problem, and it's unsolved.

## Upstream

All base OpenClaw functionality is preserved. For gateway setup, messaging channels, model configuration, and CLI reference, see the [OpenClaw docs](https://docs.openclaw.ai).

## License

MIT — same as upstream.
