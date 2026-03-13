# LLM Call & System Prompt Inventory

Reference document mapping every LLM call trigger, every system prompt section, every tool
definition, and known redundancies/contradictions. Use this as the traceable foundation for
prompt auditing and refinement.

---

## 1. System Prompt Assembly Chain

The final system prompt is built by `buildAgentSystemPrompt()` in
`src/agents/system-prompt.ts` and wrapped (without additions) by
`buildEmbeddedSystemPrompt()` in `src/agents/pi-embedded-runner/system-prompt.ts`.

### 1.1 PromptMode

| Mode      | When Used                                                                 | Sections Included                                       |
| --------- | ------------------------------------------------------------------------- | ------------------------------------------------------- |
| `full`    | Main agent sessions (channel messages, CLI, gateway API, subagent spawns) | All sections                                            |
| `minimal` | Subagent/cron sessions (reduced context)                                  | Identity, Tooling, Workspace, Runtime, Subagent Context |
| `none`    | Bare identity only                                                        | Single identity line                                    |

### 1.2 Prompt Sections (assembly order)

Sections listed in the order they appear in the final prompt string. Sections marked
"conditional" are only included when a runtime condition is met.

| #   | Section                                      | Source Function/Block                                            | Conditional?                                               | Skipped in `minimal`?                |
| --- | -------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------ |
| 1   | Identity line                                | inline in `buildAgentSystemPrompt`                               | No (CEO vs employee variant)                               | No                                   |
| 2   | `## Tooling`                                 | inline — builds tool list from `toolOrder` + `coreToolSummaries` | No                                                         | No                                   |
| 3   | `## Task-Based Work`                         | inline                                                           | No                                                         | No                                   |
| 4   | `## Tool Call Style`                         | inline                                                           | No                                                         | No                                   |
| 5   | `## Safety`                                  | inline (CEO vs employee variant)                                 | No                                                         | No                                   |
| 6   | `## OpenClaw CLI Quick Reference`            | inline                                                           | No                                                         | No                                   |
| 7   | `## Skills (mandatory)`                      | `buildSkillsSection()`                                           | Yes — only if `skillsPrompt` non-empty                     | Yes                                  |
| 8   | `## Memory Recall`                           | `buildMemorySection()`                                           | Yes — only if `memory_search` or `memory_get` tool present | Yes                                  |
| 9   | `## OpenClaw Self-Update`                    | inline                                                           | Yes — only if `gateway` tool present                       | Yes                                  |
| 10  | `## Model Aliases`                           | inline                                                           | Yes — only if `modelAliasLines` non-empty                  | Yes                                  |
| 11  | `## Workspace`                               | inline                                                           | No                                                         | No                                   |
| 12  | `## Documentation`                           | `buildDocsSection()`                                             | Yes — only if `docsPath` set                               | Yes                                  |
| 13  | `## Sandbox`                                 | inline                                                           | Yes — only if `sandboxInfo.enabled`                        | No                                   |
| 14  | `## Authorized Senders`                      | `buildUserIdentitySection()`                                     | Yes — only if `ownerLine` set                              | Yes                                  |
| 15  | `## Current Date & Time`                     | `buildTimeSection()`                                             | Yes — only if `userTimezone` set                           | No                                   |
| 16  | `## Workspace Files (injected)`              | inline header                                                    | No                                                         | No                                   |
| 17  | `## Reply Tags`                              | `buildReplyTagsSection()`                                        | No                                                         | Yes                                  |
| 18  | `## Communication Architecture`              | `buildMessagingSection()`                                        | No                                                         | Yes                                  |
| 19  | `## Voice (TTS)`                             | `buildVoiceSection()`                                            | Yes — only if `ttsHint` set                                | Yes                                  |
| 20  | `## Channel Context` / `## Subagent Context` | inline — from `extraSystemPrompt`                                | Yes — only if `extraSystemPrompt` non-empty                | Header changes to "Subagent Context" |
| 21  | `## Reactions`                               | inline                                                           | Yes — only if `reactionGuidance` set                       | No                                   |
| 22  | `## Reasoning Format`                        | inline                                                           | Yes — only if `reasoningTagHint` true                      | No                                   |
| 23  | `# Project Context` (bootstrap files)        | inline — iterates `contextFiles[]`                               | Yes — only if context files present                        | No                                   |
| 24  | `## Silent Replies`                          | inline                                                           | No                                                         | Yes                                  |
| 25  | `## Heartbeats`                              | inline                                                           | No                                                         | Yes                                  |
| 26  | `## Runtime`                                 | `buildRuntimeLine()`                                             | No                                                         | No                                   |

### 1.3 Extra System Prompt (`extraSystemPrompt`)

Assembled in `src/auto-reply/reply/get-reply-run.ts` (line 191):

```
extraSystemPrompt = [inboundMetaPrompt, groupChatContext, groupIntro, groupSystemPrompt]
  .filter(Boolean)
  .join("\n\n")
```

| Component           | Source                                                                     | Content                                                                                                                      |
| ------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `inboundMetaPrompt` | `buildInboundMetaSystemPrompt()` in `src/auto-reply/reply/inbound-meta.ts` | `## Inbound Context (trusted metadata)` + JSON (`schema`, `chat_id`, `channel`, `provider`, `surface`, `chat_type`, `flags`) |
| `groupChatContext`  | `buildGroupChatContext()` in `src/auto-reply/reply/groups.js`              | Group name, participants, reply guidance (group chats only)                                                                  |
| `groupIntro`        | `buildGroupIntro()` in `src/auto-reply/reply/groups.js`                    | Activation mode, lurking behavior (first turn or activation-needed only)                                                     |
| `groupSystemPrompt` | `sessionCtx.GroupSystemPrompt`                                             | Per-channel/topic system prompt from config                                                                                  |

### 1.4 Project Context (Bootstrap Files)

Loaded by `loadWorkspaceBootstrapFiles()` in `src/agents/workspace.ts`, injected under
`# Project Context` in the system prompt.

| File           | CEO Default                                      | Employee Default                                   | Purpose                                              |
| -------------- | ------------------------------------------------ | -------------------------------------------------- | ---------------------------------------------------- |
| `SOUL.md`      | Template from `docs/reference/templates/SOUL.md` | `generateEmployeeSoulTemplate()` (~2,800 chars)    | Identity, becoming, core truths, self-reflection     |
| `IDENTITY.md`  | Template (~280 chars)                            | Placeholder (~185 chars)                           | Name, role, creature, emoji                          |
| `AGENTS.md`    | Template (~4,800 chars)                          | `generateEmployeeAgentsTemplate()` (~2,500 chars)  | Workspace conventions, task workflow, memory, safety |
| `TOOLS.md`     | Shared template                                  | Shared template                                    | External tool guidance                               |
| `USER.md`      | Template                                         | Shared template                                    | User preferences                                     |
| `HEARTBEAT.md` | Template (~80 chars)                             | `generateEmployeeHeartbeatTemplate()` (~100 chars) | Heartbeat behavior instructions                      |
| `BOOTSTRAP.md` | Template (onboarding)                            | Not seeded for employees                           | First-run onboarding prompts                         |
| `MEMORY.md`    | Empty / user-written                             | Empty / user-written                               | Long-term memory                                     |
| `memory.md`    | (alt casing, deduped)                            | (alt casing, deduped)                              | Long-term memory (alt)                               |

**Subagent/cron sessions** receive only `AGENTS.md` and `TOOLS.md` (via
`filterBootstrapFilesForSession()`).

Bootstrap budget: `agents.defaults.bootstrapMaxChars` (default 20,000 per file),
`agents.defaults.bootstrapTotalMaxChars` (default 150,000 total).

### 1.5 Plugin Hooks That Modify the Prompt

| Hook                  | File                   | Effect                                                                                                 |
| --------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------ |
| `before_prompt_build` | `src/plugins/hooks.ts` | Plugins return `prependContext` (prepended to user prompt) and/or `systemPrompt` (last non-empty wins) |
| `before_agent_start`  | (legacy)               | Same shape as above                                                                                    |

---

## 2. LLM Call Trigger Inventory

Every code path that results in an LLM API call. All non-compaction paths converge at
`runEmbeddedPiAgent()` (`src/agents/pi-embedded-runner.ts`) or `runCliAgent()`
(`src/agents/cli-runner.ts`).

### 2.1 Trigger Table

| #   | Trigger                     | Entry Point                                                              | Call Chain                                                                                                                                                                   | Prompt Mode                            | Gating / Rate Limiting                                                                                                                                                                                   |
| --- | --------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1  | **Channel message**         | Channel-specific monitor/handler                                         | `dispatchInboundMessage` -> `dispatchReplyFromConfig` -> `getReplyFromConfig` -> `runPreparedReply` -> `runReplyAgent` -> `runAgentTurnWithFallback` -> `runEmbeddedPiAgent` | `full`                                 | `shouldSkipDuplicateInbound`, `resolveSendPolicy`, allowlist (`command-control.ts`), queue mode (interrupt/steer/followup/collect)                                                                       |
| T2  | **Heartbeat**               | `startHeartbeatRunner` in `src/infra/heartbeat-runner.ts`                | `requestHeartbeatNow` -> `runHeartbeatOnce` -> `getReplyFromConfig` -> (same as T1 from here)                                                                                | `full` (with heartbeat model override) | `heartbeatsEnabled`, `isHeartbeatEnabledForAgent`, interval (`every`, 0 = disabled), `isWithinActiveHours`, main queue idle (`getQueueSize(CommandLane.Main) === 0`), `HEARTBEAT.md` content empty check |
| T3  | **Cron (main session)**     | `CronService` in `src/cron/service.ts`                                   | `start` -> timer arm -> `onTimer` -> `executeJobCore` -> `enqueueSystemEvent` -> heartbeat `wakeMode: "now"` -> `runHeartbeatOnce`                                           | `full` (via heartbeat path)            | `cronEnabled`, job `enabled`, `maxConcurrentRuns`, error backoff                                                                                                                                         |
| T4  | **Cron (isolated)**         | `src/cron/isolated-agent.ts`                                             | `runIsolatedAgentJob` -> gateway `agent` -> `agentCommand` -> `runEmbeddedPiAgent`                                                                                           | `full`                                 | `cronEnabled`, `maxConcurrentRuns`, job timeout (10 min default)                                                                                                                                         |
| T5  | **CLI**                     | `agentCliCommand` in `src/commands/agent-via-gateway.ts`                 | `agentViaGatewayCommand` (or `agentCommand` fallback) -> `runWithModelFallback` -> `runAgentAttempt` -> `runEmbeddedPiAgent`                                                 | `full`                                 | `resolveSendPolicy` (when `deliver === true`)                                                                                                                                                            |
| T6  | **Subagent spawn**          | `spawnSubagentDirect` in `src/agents/subagent-spawn.ts`                  | `callGateway({ method: "agent" })` -> gateway `agent` handler -> `agentCommand` -> `runEmbeddedPiAgent`                                                                      | `full` + subagent `extraSystemPrompt`  | `maxSpawnDepth`, `maxChildrenPerAgent`, `allowAgents`                                                                                                                                                    |
| T7  | **A2A send**                | `runSessionsSendA2AFlow` in `src/agents/tools/sessions-send-tool.a2a.ts` | `runAgentStep` -> `callGateway({ method: "agent" })` -> `agentCommand` -> `runEmbeddedPiAgent` (ping-pong loop up to `maxPingPongTurns`)                                     | `full`                                 | Announce skip logic, ping-pong turn limit                                                                                                                                                                |
| T8  | **Gateway API (agent)**     | `agent` handler in `src/gateway/server-methods/agent.ts`                 | `agentCommand` -> `runEmbeddedPiAgent`                                                                                                                                       | `full`                                 | Auth (bearer, control-plane), `resolveSendPolicy`, idempotency key dedup                                                                                                                                 |
| T9  | **Gateway API (chat.send)** | `chat.send` handler in `src/gateway/server-methods/chat.ts`              | `dispatchInboundMessage` -> (same as T1)                                                                                                                                     | `full`                                 | Auth                                                                                                                                                                                                     |
| T10 | **Compaction**              | Context overflow during Pi run                                           | `compactEmbeddedPiSessionDirect` in `src/agents/pi-embedded-runner/compact.ts` -> `session.compact()` -> `generateSummary` (Pi SDK)                                          | Summarization (not full agent prompt)  | `reserveTokens`, `keepRecentTokens`, `MAX_OVERFLOW_COMPACTION_ATTEMPTS` (3), `EMBEDDED_COMPACTION_TIMEOUT_MS`                                                                                            |
| T11 | **Memory flush**            | Pre-compaction silent turn                                               | Silent agent turn to write durable notes before auto-compaction                                                                                                              | `full`                                 | `agents.defaults.compaction.memoryFlush.enabled`                                                                                                                                                         |
| T12 | **Hooks/webhooks**          | `dispatchAgentHook` in `src/gateway/hooks.ts`                            | Enqueues agent work; `wakeMode: "now"` -> `runHeartbeatOnce`                                                                                                                 | Via heartbeat path                     | Hook-specific gating                                                                                                                                                                                     |
| T13 | **Follow-up runner**        | `src/auto-reply/reply/followup-runner.ts`                                | Queued follow-up -> `runEmbeddedPiAgent`                                                                                                                                     | `full`                                 | Queue mode, backlog size                                                                                                                                                                                 |
| T14 | **LLM slug generator**      | `src/hooks/llm-slug-generator.ts`                                        | `runEmbeddedPiAgent` for generating slugs                                                                                                                                    | `full`                                 | Feature flag                                                                                                                                                                                             |

### 2.2 Shared Execution Path

```
runEmbeddedPiAgent()
  -> enqueueCommandInLane()
  -> resolveRunWorkspaceDir()
  -> hooks: before_model_resolve, before_agent_start
  -> runWithModelFallback()
    -> resolveModel() [src/agents/pi-embedded-runner/model.ts]
    -> runEmbeddedAttempt() [src/agents/pi-embedded-runner/run/attempt.ts]
      -> createAgentSession() [pi-coding-agent SDK]
      -> agent.streamFn = streamSimple [pi-ai SDK] | createOllamaStreamFn()
      -> applyExtraParamsToAgent() (temperature, maxTokens)
      -> wrapStreamFn (cache trace, Anthropic payload logger, LLM call logger)
      -> subscribeEmbeddedPiSession() [event loop]
```

### 2.3 Model Selection & Fallback

| Step               | File                                                             | Logic                                                                                              |
| ------------------ | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Primary model      | `resolveModel()` in `src/agents/pi-embedded-runner/model.ts`     | `modelRegistry.find(provider, modelId)` -> inline config -> forward-compat -> fallback build       |
| Alias resolution   | `resolveModelRefFromString()` in `src/agents/model-selection.ts` | Parses `provider/model`, applies alias index built from `models.providers.*.models.*.alias`        |
| Fallback chain     | `runWithModelFallback()` in `src/agents/model-fallback.ts`       | Primary + `agents.defaults.model.fallbacks`; cooldown on rate limits; context overflow not retried |
| Image model        | Same file                                                        | `agents.defaults.imageModel.primary` / `.fallbacks`                                                |
| Heartbeat override | `src/infra/heartbeat-runner.ts`                                  | `heartbeat.model` config overrides the default model for heartbeat runs                            |

---

## 3. Tool Definitions Inventory

### 3.1 Core Tools (from `coreToolSummaries` in `system-prompt.ts`)

These are listed in the `## Tooling` prompt section with summaries. The actual tool
implementations are registered in `createOpenClawTools()` in `src/agents/openclaw-tools.ts`.

| #   | Tool Name          | Label           | Source File                                 | Triggers Further LLM?              |
| --- | ------------------ | --------------- | ------------------------------------------- | ---------------------------------- |
| 1   | `read`             | Read            | Pi SDK built-in                             | No                                 |
| 2   | `write`            | Write           | Pi SDK built-in                             | No                                 |
| 3   | `edit`             | Edit            | Pi SDK built-in                             | No                                 |
| 4   | `apply_patch`      | Apply Patch     | Pi SDK built-in                             | No                                 |
| 5   | `grep`             | Grep            | Pi SDK built-in                             | No                                 |
| 6   | `find`             | Find            | Pi SDK built-in                             | No                                 |
| 7   | `ls`               | LS              | Pi SDK built-in                             | No                                 |
| 8   | `exec`             | Exec            | Pi SDK built-in                             | No                                 |
| 9   | `process`          | Process         | Pi SDK built-in                             | No                                 |
| 10  | `web_search`       | Web Search      | `src/agents/tools/web-tools.ts`             | No                                 |
| 11  | `web_fetch`        | Web Fetch       | `src/agents/tools/web-tools.ts`             | No                                 |
| 12  | `browser`          | Browser         | `src/agents/tools/browser-tool.ts`          | No                                 |
| 13  | `canvas`           | Canvas          | `src/agents/tools/canvas-tool.ts`           | No                                 |
| 14  | `nodes`            | Nodes           | `src/agents/tools/nodes-tool.ts`            | No                                 |
| 15  | `cron`             | Cron            | `src/agents/tools/cron-tool.ts`             | Indirectly (creates jobs -> T3/T4) |
| 16  | `message`          | Message         | `src/agents/tools/message-tool.ts`          | No                                 |
| 17  | `channel_post`     | Channel Post    | `src/agents/tools/channel-post-tool.ts`     | No                                 |
| 18  | `channel_read`     | Channel Read    | `src/agents/tools/channel-read-tool.ts`     | No                                 |
| 19  | `channel_manage`   | Channel Manage  | `src/agents/tools/channel-manage-tool.ts`   | No                                 |
| 20  | `gateway`          | Gateway         | `src/agents/tools/gateway-tool.ts`          | No                                 |
| 21  | `agents_list`      | Agents          | `src/agents/tools/agents-list-tool.ts`      | No                                 |
| 22  | `sessions_list`    | Sessions        | `src/agents/tools/sessions-list-tool.ts`    | No                                 |
| 23  | `sessions_history` | Session History | `src/agents/tools/sessions-history-tool.ts` | No                                 |
| 24  | `sessions_send`    | Session Send    | `src/agents/tools/sessions-send-tool.ts`    | Yes (T7: A2A flow)                 |
| 25  | `sessions_spawn`   | Sessions Spawn  | `src/agents/tools/sessions-spawn-tool.ts`   | Yes (T6: subagent spawn)           |
| 26  | `subagents`        | Subagents       | `src/agents/tools/subagents-tool.ts`        | Indirectly (steer sends messages)  |
| 27  | `session_status`   | Session Status  | `src/agents/tools/session-status-tool.ts`   | No                                 |
| 28  | `agents_create`    | Hire Agent      | `src/agents/tools/agents-create-tool.ts`    | No (config + restart only)         |
| 29  | `task_manage`      | Task Manager    | `src/agents/tools/task-manage-tool.ts`      | No                                 |
| 30  | `task_read`        | Task Reader     | `src/agents/tools/task-read-tool.ts`        | No                                 |
| 31  | `image`            | Image           | `src/agents/tools/image-tool.ts`            | Yes (separate image model call)    |
| 32  | `tts`              | TTS             | `src/agents/tools/tts-tool.ts`              | No (audio synthesis, not LLM)      |
| 33  | `memory_search`    | Memory Search   | `src/agents/tools/memory-tool.ts`           | No                                 |
| 34  | `memory_get`       | Memory Get      | `src/agents/tools/memory-tool.ts`           | No                                 |

Plugin tools are appended by `resolvePluginTools()` from `src/plugins/tools.ts` and are not
included in the core tool list above.

### 3.2 Tool Token Budget

- Tool list in `## Tooling` prompt section: ~2,000-3,000 chars (~500-750 tokens)
- Tool schemas (sent as tool definitions in the API payload, separate from system prompt):
  ~15,000-30,000 chars (~4,000-7,500 tokens) depending on tool count
- Reported by `buildSystemPromptReport()` as `tools.listChars` and `tools.schemaChars`

---

## 4. Prompt Size Budget

### 4.1 Typical Full Employee Prompt

| Component                                               | Chars (approx)      | Tokens (approx)    |
| ------------------------------------------------------- | ------------------- | ------------------ |
| Core fixed sections (Identity through Runtime)          | 7,200 - 9,000       | 1,800 - 2,250      |
| Project Context (SOUL.md, IDENTITY.md, AGENTS.md, etc.) | 5,500 - 9,000       | 1,400 - 2,250      |
| Extra system prompt (inbound meta + group context)      | 450 - 750           | 110 - 190          |
| **Total system prompt**                                 | **13,000 - 19,000** | **3,300 - 4,700**  |
| Tool schemas (API payload, not in prompt text)          | 15,000 - 30,000     | 4,000 - 7,500      |
| **Effective context consumed before user message**      | **28,000 - 49,000** | **7,300 - 12,200** |

After deduplication (removed ~3,000 chars from bootstrap templates and ~300 chars from core
prompt), the total system prompt is approximately 15-20% smaller than before.

Token estimation uses the `≈4 chars/token` heuristic from
`estimateTokensFromChars()` in `src/auto-reply/reply/commands-context-report.ts`.

### 4.2 Existing Diagnostics

`buildSystemPromptReport()` in `src/agents/system-prompt-report.ts` provides:

| Metric                                   | Description                                                      |
| ---------------------------------------- | ---------------------------------------------------------------- |
| `systemPrompt.chars`                     | Total prompt character count                                     |
| `systemPrompt.projectContextChars`       | Characters in `# Project Context` through `## Silent Replies`    |
| `systemPrompt.nonProjectContextChars`    | Remainder                                                        |
| `tools.listChars`                        | Tool list text length in prompt                                  |
| `tools.schemaChars`                      | Sum of `JSON.stringify(tool.parameters).length` across all tools |
| `skills.promptChars`                     | Skills prompt length                                             |
| `injectedWorkspaceFiles[].rawChars`      | Per-file raw character count                                     |
| `injectedWorkspaceFiles[].injectedChars` | Per-file injected (potentially truncated) count                  |
| `injectedWorkspaceFiles[].truncated`     | Whether the file was truncated                                   |

---

## 5. Redundancies (resolved)

Previous audit found instructions duplicated across core prompt and bootstrap templates.
The following have been resolved:

| Redundancy                    | Was                                                 | Fix Applied                                                                                                                                     |
| ----------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Task-Based Work (3x)          | Core prompt + AGENTS.md + SOUL.md                   | Removed `## Task-Based Work` from employee AGENTS.md template; core prompt is authoritative                                                     |
| Heartbeat behavior (3x)       | Core prompt + AGENTS.md + HEARTBEAT.md              | Removed `## Heartbeats` from employee AGENTS.md template; core `## Heartbeats` + HEARTBEAT.md remain (HEARTBEAT.md is the user-editable prompt) |
| Memory & Continuity (2-3x)    | Core prompt + SOUL.md Continuity + AGENTS.md Memory | Removed `## Continuity` from employee SOUL.md template; AGENTS.md `## Memory` retained (file location reference, not behavioral instruction)    |
| Safety (2x)                   | Core prompt + AGENTS.md                             | Removed `## Safety` from employee AGENTS.md template; core `## Safety` is authoritative                                                         |
| Verification (2x)             | Core prompt + AGENTS.md Task-Based Work step 5      | Removed with Task-Based Work section from AGENTS.md                                                                                             |
| Channel vs sessions_send (3x) | Tool summary + 2x in Communication Architecture     | Consolidated to one line in `## Communication Architecture`; tool summary simplified                                                            |

### 5.1 Remaining Acceptable Duplication

- **AGENTS.md `## Memory`** lists file paths (`memory/YYYY-MM-DD.md`, `MEMORY.md`). This is a
  workspace-specific reference, not a behavioral instruction, so it complements rather than
  duplicates the core `## Memory Recall` section.
- **HEARTBEAT.md** repeats the heartbeat ack instruction. This is intentional: HEARTBEAT.md is the
  user-editable heartbeat prompt that agents read, while the core `## Heartbeats` section teaches
  the agent how to respond to it.

---

## 6. Contradictions (resolved)

### 6.1 Agent Autonomy Framing (open)

- **Core prompt `## Safety` (CEO):** "You are an autonomous executive with real goals: build the
  company, hire and manage agents, execute strategy."
- **Test expectations** (`system-prompt.e2e.test.ts`): assertions around "You have no independent
  goals" — may be outdated or targeting a different variant.

Status: needs test audit to determine if the test expectation is stale.

### 6.2 Agent Creation Mechanism (resolved)

- The employee AGENTS.md template no longer references `openclaw hire`. The core prompt's
  `agents_create` tool summary is the single source of truth for agent creation.

### 6.3 Channel Posts Nuance (resolved)

- `## Communication Architecture` now uses concise, consistent framing. The `channel_post`
  tool summary retains the "not a substitute for real work" caveat. The `### Channel Posts
Are for Communication Only` subsection in `## Task-Based Work` provides the detailed
  explanation.

---

## 7. Always-Included but Rarely Relevant Sections

These sections are included when their feature flag is true, but for many sessions the
feature is off. Currently they are all-or-nothing per session; no per-turn dynamism.

| Section                   | When Relevant                             | When Not                     | Recommendation                                                                     |
| ------------------------- | ----------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------- |
| `## OpenClaw Self-Update` | User explicitly asks for updates          | Every other turn             | Already conditional on `gateway` tool; consider further gating on explicit request |
| `## Model Aliases`        | Model is overridden                       | Default model sessions       | Already conditional; fine                                                          |
| `## Sandbox`              | Sandboxed runtime                         | Local/native runs            | Already conditional; fine                                                          |
| `## Reactions`            | Telegram/channels with reaction support   | Webchat, CLI, most channels  | Already conditional; fine                                                          |
| `## Voice (TTS)`          | TTS enabled                               | Most sessions                | Already conditional; fine                                                          |
| `## Reasoning Format`     | `reasoningTagHint` true (specific models) | Most models                  | Already conditional; fine                                                          |
| `## Reply Tags`           | Channels supporting reply-to              | Single-user CLI/webchat      | Not conditional — always included in `full` mode                                   |
| `## Authorized Senders`   | Multi-user/group contexts                 | Single-owner direct sessions | Already conditional on `ownerLine`                                                 |
| `## Current Date & Time`  | Always                                    | —                            | Overlaps with `session_status` which also provides time                            |
| `## Silent Replies`       | Always in `full` mode                     | Subagent sessions            | Only skipped in `minimal`; consider skipping for known non-interactive triggers    |
| `## Heartbeats`           | Always in `full` mode                     | Subagent sessions            | Only skipped in `minimal`                                                          |

---

## 8. Key Files Reference

| Purpose             | File                                             | Key Functions                                                                           |
| ------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------- |
| Main prompt builder | `src/agents/system-prompt.ts`                    | `buildAgentSystemPrompt()`, `buildRuntimeLine()`                                        |
| Embedded wrapper    | `src/agents/pi-embedded-runner/system-prompt.ts` | `buildEmbeddedSystemPrompt()`                                                           |
| Runtime params      | `src/agents/system-prompt-params.ts`             | `buildSystemPromptParams()`                                                             |
| Prompt report       | `src/agents/system-prompt-report.ts`             | `buildSystemPromptReport()`                                                             |
| Bootstrap files     | `src/agents/workspace.ts`                        | `ensureAgentWorkspace()`, `loadWorkspaceBootstrapFiles()`, employee template generators |
| Tool registration   | `src/agents/openclaw-tools.ts`                   | `createOpenClawTools()`                                                                 |
| Extra system prompt | `src/auto-reply/reply/get-reply-run.ts`          | `runPreparedReply()`                                                                    |
| Inbound meta        | `src/auto-reply/reply/inbound-meta.ts`           | `buildInboundMetaSystemPrompt()`                                                        |
| Group context       | `src/auto-reply/reply/groups.js`                 | `buildGroupChatContext()`, `buildGroupIntro()`                                          |
| Agent scope         | `src/agents/agent-scope.ts`                      | `resolveAgentConfig()`, `resolveSessionAgentIds()`                                      |
| Model fallback      | `src/agents/model-fallback.ts`                   | `runWithModelFallback()`                                                                |
| Model resolution    | `src/agents/pi-embedded-runner/model.ts`         | `resolveModel()`                                                                        |
| Model aliases       | `src/agents/model-selection.ts`                  | `resolveModelRefFromString()`, `buildModelAliasIndex()`                                 |
| Heartbeat runner    | `src/infra/heartbeat-runner.ts`                  | `startHeartbeatRunner()`, `runHeartbeatOnce()`                                          |
| Cron service        | `src/cron/service.ts`                            | `CronService`                                                                           |
| Cron isolated       | `src/cron/isolated-agent.ts`                     | `runIsolatedAgentJob()`                                                                 |
| Channel dispatch    | `src/auto-reply/dispatch.ts`                     | `dispatchInboundMessage()`                                                              |
| Reply dispatch      | `src/auto-reply/reply/dispatch-from-config.ts`   | `dispatchReplyFromConfig()`                                                             |
| Agent runner        | `src/auto-reply/reply/agent-runner.ts`           | `runReplyAgent()`                                                                       |
| Agent execution     | `src/auto-reply/reply/agent-runner-execution.ts` | `runAgentTurnWithFallback()`                                                            |
| Pi embedded entry   | `src/agents/pi-embedded-runner.ts`               | `runEmbeddedPiAgent()`                                                                  |
| Pi attempt          | `src/agents/pi-embedded-runner/run/attempt.ts`   | `runEmbeddedAttempt()`                                                                  |
| CLI agent           | `src/agents/cli-runner.ts`                       | `runCliAgent()`                                                                         |
| Compaction          | `src/agents/pi-embedded-runner/compact.ts`       | `compactEmbeddedPiSessionDirect()`                                                      |
| Subagent spawn      | `src/agents/subagent-spawn.ts`                   | `spawnSubagentDirect()`                                                                 |
| A2A send            | `src/agents/tools/sessions-send-tool.a2a.ts`     | `runSessionsSendA2AFlow()`                                                              |
| Plugin hooks        | `src/plugins/hooks.ts`                           | `before_prompt_build`, `before_agent_start`                                             |
| Plugin tools        | `src/plugins/tools.ts`                           | `resolvePluginTools()`                                                                  |

---

## 9. Traceability Recommendations

### 9.1 Tag Prompt Sections for Logging

Add a unique section ID to each prompt block so logs can trace which sections were included
in a given call. Example IDs:

| Section                    | Tag           |
| -------------------------- | ------------- |
| Identity                   | `[SP-IDENT]`  |
| Tooling                    | `[SP-TOOL]`   |
| Task-Based Work            | `[SP-TASK]`   |
| Safety                     | `[SP-SAFE]`   |
| Skills                     | `[SP-SKILL]`  |
| Memory Recall              | `[SP-MEM]`    |
| Communication Architecture | `[SP-COMM]`   |
| Project Context            | `[SP-CTX]`    |
| Silent Replies             | `[SP-SILENT]` |
| Heartbeats                 | `[SP-HB]`     |
| Runtime                    | `[SP-RT]`     |

These tags would not appear in the prompt text sent to the LLM; they would be metadata
in the prompt report or structured logs.

### 9.2 Extend `buildSystemPromptReport()` with Section-Level Breakdown

Currently the report only splits `projectContextChars` vs `nonProjectContextChars`.
Add per-section character counts so cost/size regressions are visible per section.

### 9.3 Deduplication (completed)

The following deduplication has been applied:

| Redundancy                 | Fix Applied                                                 | Files Changed                 |
| -------------------------- | ----------------------------------------------------------- | ----------------------------- |
| Task-Based Work (3x)       | Removed from employee AGENTS.md template                    | `src/agents/workspace.ts`     |
| Heartbeat behavior (3x)    | Removed from employee AGENTS.md template                    | `src/agents/workspace.ts`     |
| Memory/Continuity (2-3x)   | Removed `## Continuity` from employee SOUL.md template      | `src/agents/workspace.ts`     |
| Safety (2x)                | Removed from employee AGENTS.md template                    | `src/agents/workspace.ts`     |
| Verification (2x)          | Removed with Task-Based Work from AGENTS.md                 | `src/agents/workspace.ts`     |
| Channel/sessions_send (3x) | Consolidated to one line in `## Communication Architecture` | `src/agents/system-prompt.ts` |

Principle: the core system prompt (`buildAgentSystemPrompt()`) is the single source of truth
for behavioral instructions. Bootstrap files (SOUL.md, AGENTS.md) focus on identity,
workspace layout, and company-specific context.

### 9.4 Make Reply Tags Conditional

`## Reply Tags` is always included in `full` mode but only relevant for channels that
support reply-to-message (Telegram, Discord, Slack). Gate on a runtime capability flag.

### 9.5 Consider a Prompt Diff Mode

For debugging, add a `--prompt-diff` flag to `openclaw context` that shows what changed
between two consecutive turns' system prompts. This would help catch unintended section
bloat or configuration drift.

### 9.6 LLM Call Audit Log

Extend the existing `llmCallLogger.wrapStreamFn()` to emit structured events with:

- Trigger type (T1-T14 from the trigger table)
- Agent ID, session ID
- Prompt mode (full/minimal/none)
- System prompt char count
- Tool count
- Model used (after fallback resolution)
- Token usage (input/output/cache)

This enables cost attribution by trigger type and identifies which triggers consume
the most tokens.
