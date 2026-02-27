---
name: okkslides
description: Generate professional presentation slides/ppt using okkslides API. Uses a unified endpoint with background processing for fast responses.
homepage: https://www.okkslides.com/
metadata:
  {
    "openclaw":
      {
        "emoji": "📊",
        "requires": { "env": ["OKK_API_KEY"] },
        "primaryEnv": "OKK_API_KEY",
        "install":
          [
            {
              "id": "node-brew",
              "kind": "brew",
              "formula": "node",
              "bins": ["node"],
              "label": "Install Node.js (brew)",
            },
          ],
        "config":
          {
            "baseUrl":
              {
                "description": "OKK Slides API base URL",
                "default": "http://23.20.100.64:6691",
                "env": "OKK_BASE_URL",
              },
          },
      },
  }
---

# OKK Slides - Unified Presentation Generator

Generate professional presentations using a single unified API endpoint with background processing.

---

## CRITICAL: How This API Works

### Non-Blocking Asynchronous Processing

**IMPORTANT:** This API is fully asynchronous. All operations return immediately while processing happens in the background. You MUST implement a polling pattern to get results.

### CRITICAL: AI Agent MUST Use `--no-autopoll`

**⚠️ AI agents MUST always use `--no-autopoll` flag when calling the do.mjs script.**

The `--no-autopoll` flag disables automatic polling, requiring the agent to:

1. Manually poll for status after the recommended wait time
2. Forward EVERY status update to the user immediately
3. Continue polling until `COMPLETED`, `FAILED`, or `WAITING_INPUT`

```bash
# AI agents MUST use --no-autopoll
node {baseDir}/scripts/do.mjs --step CREATE --objective "Topic" --no-autopoll
```

When `--no-autopoll` is used, the response includes polling guidance:

```
AUTOPOLL: disabled
POLL_INTERVAL: 5s
RECOMMENDED_WAIT: 30s
POLL_NOTE: For SSE steps, DO NOT include --message when polling for status.
```

### The Polling Pattern (MUST FOLLOW)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    MANUAL POLLING WORKFLOW (for AI Agents)                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   1. CALL API (with --no-autopoll) ──► Get response with STATUS             │
│                              │                                               │
│                              ▼                                               │
│   2. REPORT TO USER ──► IMMEDIATELY tell user the status & message          │
│                              │                                               │
│                              ▼                                               │
│   3. CHECK STATUS:                                                          │
│      ├─► COMPLETED ────────► Done! Show all results to user                 │
│      ├─► FAILED ───────────► Show error to user, stop                       │
│      ├─► WAITING_INPUT ────► Ask user the questions, wait for answer        │
│      └─► ACCEPTED/IN_PROGRESS:                                              │
│                │                                                             │
│                ▼                                                             │
│   4. WAIT ──► Use RECOMMENDED_WAIT or POLL_INTERVAL from response           │
│                │   - SSE steps (CREATE, REFINE_OUTLINE): wait 15-30s        │
│                │   - GENERATE_SLIDES: wait 10s between polls                │
│                │   - Other steps: wait 3-5s                                 │
│                │                                                             │
│                └───────► Go back to step 1 (call API again to poll)         │
│                                                                             │
│   ⚠️ CRITICAL: For SSE steps, DO NOT include --message when polling!        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Manual Polling Implementation (REQUIRED for AI Agents)

**Step-by-step polling logic for agents:**

1. **Initial call** - Start the task with `--no-autopoll`:

   ```bash
   node {baseDir}/scripts/do.mjs --step CREATE --objective "Topic" --no-autopoll
   ```

2. **Parse the response** - Check these key fields:
   - `STATUS`: Current state (ACCEPTED, IN_PROGRESS, COMPLETED, FAILED, WAITING_INPUT)
   - `RECOMMENDED_WAIT`: How long to wait before next poll (for SSE steps)
   - `POLL_INTERVAL`: Default interval for subsequent polls
   - `PROJECT_ID`: Save this for all subsequent calls

3. **Report to user immediately** - After EVERY API call, tell the user:
   - The current status
   - Progress information (slide count, percentage, etc.)
   - Any messages from the API

4. **Wait the recommended time** - Based on step type:
   | Step | Wait Time Before First Poll | Subsequent Poll Interval |
   |------|---------------------------|-------------------------|
   | CREATE | 30 seconds | 10 seconds |
   | REFINE_OUTLINE | 15 seconds | 10 seconds |
   | GENERATE_SLIDES | 5 seconds | 10 seconds |
   | GET_DRAFTS | 5 seconds | 5 seconds |
   | EXPORT | 5 seconds | 5 seconds |
   | Others | 3 seconds | 3 seconds |

5. **Poll for status** - Call API again (note: different for SSE vs non-SSE steps):

   **For SSE steps (CREATE, REFINE_OUTLINE) - DO NOT include --message:**

   ```bash
   # CORRECT: Status-only poll
   node {baseDir}/scripts/do.mjs --step REFINE_OUTLINE --project-id "proj_xxx" --no-autopoll

   # WRONG: Including --message will start a NEW task!
   node {baseDir}/scripts/do.mjs --step REFINE_OUTLINE --project-id "proj_xxx" --message "..." --no-autopoll
   ```

   **For non-SSE steps (GENERATE_SLIDES, EXPORT, etc.) - include all original parameters:**

   ```bash
   node {baseDir}/scripts/do.mjs --step GENERATE_SLIDES --project-id "proj_xxx" --no-autopoll
   ```

6. **Repeat until terminal state** - Continue polling until status is:
   - `COMPLETED` - Show results
   - `FAILED` - Show error
   - `WAITING_INPUT` - Present questions to user

### Three Mandatory Rules

1. **POLL UNTIL COMPLETE** - After each API call, if status is NOT `COMPLETED`/`FAILED`/`WAITING_INPUT`, you MUST call the API again after waiting
2. **REPORT EVERY RESPONSE** - After EVERY API call, immediately tell the user what the response says (progress %, current step, message, etc.)
3. **RESPECT WAIT TIMES** - Use the `ESTIMATED_WAIT` or `RETRY_AFTER` from response to determine how long to wait before next poll

### SSE Processing Steps (CRITICAL - Read Carefully)

**The following steps use SSE (Server-Sent Events) for AI processing. These steps have special handling requirements:**

| Step             | Estimated Time | Recommended Initial Wait                      |
| ---------------- | -------------- | --------------------------------------------- |
| `CREATE`         | 30-60 seconds  | **Wait 30 seconds** before first status check |
| `REFINE_OUTLINE` | 10-30 seconds  | **Wait 15 seconds** before first status check |

**⚠️ CRITICAL: Progress percentages are UNRELIABLE for SSE steps. Do NOT use them to determine completion.**

**How to handle SSE steps:**

1. **Start the operation** - Call the API once with all required parameters to initiate
2. **Inform the user** - Tell them: "Processing... this takes approximately X seconds"
3. **Wait the recommended time** - Do NOT poll during this wait
4. **Check status (polling)** - After the wait, call the API to check result
5. **If still processing** - Wait another 10 seconds and check again
6. **Repeat until done** - Continue with 10-second intervals until `COMPLETED`/`FAILED`/`WAITING_INPUT`

**⚠️ CRITICAL for REFINE_OUTLINE polling:**
When polling for REFINE_OUTLINE status (after the initial call), **DO NOT include the `message` field**. Including the message will start a NEW refinement task, causing duplicate processing!

```bash
# Initial call (starts the task) - INCLUDE message
node {baseDir}/scripts/do.mjs --step REFINE_OUTLINE \
  --project-id "proj_abc123" \
  --message "Make it 10 slides"

# Subsequent polling (check status only) - DO NOT include message
# The do.mjs script handles this automatically, but if calling API directly:
# Request body should be: { "step": "REFINE_OUTLINE", "projectId": "proj_abc123" }
# NOT: { "step": "REFINE_OUTLINE", "projectId": "proj_abc123", "message": "..." }
```

**Example for REFINE_OUTLINE:**

```
Agent: "Updating your outline based on the feedback. This takes about 15-30 seconds..."
       [calls API once with message - gets ACCEPTED]
       [WAIT 15 seconds - do NOT poll during this time]
       [calls API again WITHOUT message - check status only]

If COMPLETED: Show results
If still IN_PROGRESS: "Still processing..." → wait 10 more seconds → check again
```

**Why this matters:**

- SSE-based operations stream AI responses internally
- Progress percentage updates are not meaningful for these steps
- Polling with the `message` field will start duplicate tasks, causing infinite loops
- The `estimatedSecondsRemaining` field provides a better indication of when to check back

### Response Status Values

| Status          | Meaning             | Action                                           | Recommended Wait                                           |
| --------------- | ------------------- | ------------------------------------------------ | ---------------------------------------------------------- |
| `ACCEPTED`      | Task just started   | Report to user → Wait → Poll again               | See SSE steps above, or 3-5 seconds for other steps        |
| `IN_PROGRESS`   | Task running        | Report progress to user → Wait → Poll again      | Use `ESTIMATED_WAIT` from response, or see SSE steps above |
| `COMPLETED`     | Task done           | Show all results to user immediately             | N/A - Stop polling                                         |
| `FAILED`        | Task failed         | Show error message to user                       | N/A - Stop polling                                         |
| `WAITING_INPUT` | AI needs user input | Present questions to user, wait for their answer | N/A - Stop polling until user responds                     |

### Progress Display by Step Type

**Steps with trackable progress (show actual progress):**
| Step | Progress Format | Example |
|------|-----------------|---------|
| `GENERATE_SLIDES` | Slide count | `SLIDE_PROGRESS: 3/10` - "Processing slide 3 of 10" |
| `EXPORT` | Percentage | `PROGRESS: 45%` - "Exporting... 45% complete" |

**Steps without trackable progress (show estimated time only):**
| Step | Display | Example |
|------|---------|---------|
| `CREATE` | Estimated wait | `ESTIMATED_WAIT: 30s` - "Processing... please wait ~30 seconds" |
| `REFINE_OUTLINE` | Estimated wait | `ESTIMATED_WAIT: 15s` - "Refining... please wait ~15 seconds" |
| `GET_DRAFTS` | Estimated wait | `ESTIMATED_WAIT: 45s` - "Generating styles... please wait ~45 seconds" |
| `CONFIRM_OUTLINE` | Instant | No wait needed (~2s) |
| `SELECT_DRAFT` | Instant | No wait needed (~2s) |

**Note:** For SSE-based steps (CREATE, REFINE_OUTLINE), the `PROGRESS` percentage is unreliable and should NOT be displayed to users. Use `ESTIMATED_WAIT` instead.

### Example Polling Sequences

**For SSE steps (CREATE, REFINE_OUTLINE) - use wait-based approach:**

```
Call 1: STATUS=ACCEPTED, ESTIMATED_WAIT=30s
  └─► Tell user: "Creating your presentation... this takes about 30 seconds."
  └─► Wait 30 seconds (do NOT poll during this time)

Call 2: STATUS=IN_PROGRESS, MESSAGE="Generating outline..."
  └─► Tell user: "Still processing..."
  └─► Wait 10 seconds

Call 3: STATUS=COMPLETED, OUTLINE=[...], PROJECT_ID=xxx
  └─► Tell user: "Done! Here's your outline: ..." and show all results
  └─► Stop polling
```

**For GENERATE_SLIDES - show slide count progress:**

```
Call 1: STATUS=ACCEPTED, TOTAL_SLIDES=10
  └─► Tell user: "Starting to generate 10 slides..."
  └─► Wait 5 seconds

Call 2: STATUS=IN_PROGRESS, SLIDE_PROGRESS=2/10
  └─► Tell user: "Processing slide 2 of 10..."
  └─► Wait 10 seconds

Call 3: STATUS=IN_PROGRESS, SLIDE_PROGRESS=5/10
  └─► Tell user: "Processing slide 5 of 10... halfway there!"
  └─► Wait 10 seconds

Call 4: STATUS=COMPLETED, SLIDE_PROGRESS=10/10, SHARE_URL=xxx
  └─► Tell user: "All 10 slides generated! View at: SHARE_URL"
  └─► Stop polling
```

---

## Workflow Overview

**RECOMMENDED: Use the stepwise (interactive) approach for better user experience.**

### Stepwise (Interactive) Workflow - PREFERRED

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         STEPWISE WORKFLOW (RECOMMENDED)                          │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│   1. CREATE          → Creates project, generates outline (~30-60s)              │
│                      → Shows SETUP_URL for user to view/edit                    │
│                              │                                                   │
│                              ▼                                                   │
│   2. REFINE_OUTLINE  → AI may ask questions → User provides answers             │
│      (Interactive)   → Repeat until outline is satisfactory                     │
│                      → Shows SETUP_URL after each update                        │
│                              │                                                   │
│                              ▼                                                   │
│   3. CONFIRM_OUTLINE → Lock outline when satisfied (~2s)                        │
│                              │                                                   │
│                              ▼                                                   │
│   4. GET_DRAFTS      → Auto-generate 3 style options (~30-60s)                  │
│                      → Present style descriptions to user                        │
│                      → Shows SETUP_URL to preview styles                         │
│                              │                                                   │
│                              ▼                                                   │
│   5. SELECT_DRAFT    → User confirms preferred style (1, 2, or 3)               │
│                              │                                                   │
│                              ▼                                                   │
│   6. GENERATE_SLIDES → Generate slides ONE BY ONE (~20-40s per slide)           │
│      (Stepwise)      → Notify user after EACH slide                             │
│                      → Show EDITOR_URL after first slide                         │
│                      → User can start viewing/editing while generating           │
│                              │                                                   │
│                              ▼                                                   │
│   7. SHARE_URL       → Returns share link when all slides done                  │
│                      → Ask user if they need download link                       │
│                              │                                                   │
│                              ▼                                                   │
│   8. EXPORT (if needed) → Generate PPT download (~30-60s)                       │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Full Workflow (One-shot) - For users who prefer waiting

If the user INSISTS on generating everything at once:

- Tell user: "This will take approximately 5-10 minutes. I'll notify you when complete."
- Use the AUTO_GENERATE step with existing projectId (if any) to complete remaining tasks
- User must wait for the entire process to complete

```
AUTO_GENERATE → Full pipeline in one call (~5-10 minutes total)
              → Supports --project-id to continue from existing project
```

### URL Types and When to Show Them

| URL Type   | Format                                                      | When to Show                                           |
| ---------- | ----------------------------------------------------------- | ------------------------------------------------------ |
| SETUP_URL  | `{baseUrl}/project/setup?projectId={id}`                    | After CREATE, REFINE_OUTLINE, GET_DRAFTS, SELECT_DRAFT |
| EDITOR_URL | `{baseUrl}/project/editor?projectId={id}&slideId={slideId}` | After FIRST slide generated, user can view/edit        |
| SHARE_URL  | `{baseUrl}/s?s={shortId}`                                   | After ALL slides generated                             |
| PPT_URL    | `{baseUrl}/api/v1/ppt/download?...`                         | After EXPORT completes                                 |

### Time Estimates per Step

| Step                 | Estimated Time   | What to Tell User                                                           |
| -------------------- | ---------------- | --------------------------------------------------------------------------- |
| CREATE               | 30-60 seconds    | "Creating your project and generating outline... (~30-60 seconds)"          |
| REFINE_OUTLINE       | 10-30 seconds    | "Updating outline based on your feedback... (~15-30 seconds)"               |
| CONFIRM_OUTLINE      | ~2 seconds       | "Confirming outline..."                                                     |
| GET_DRAFTS           | 30-60 seconds    | "Generating 3 style options... (~30-60 seconds)"                            |
| SELECT_DRAFT         | ~2 seconds       | "Applying selected style..."                                                |
| GENERATE_SLIDES      | 20-40s per slide | "Generating slide X of Y... (~20-40 seconds per slide)"                     |
| EXPORT (share)       | ~5 seconds       | "Creating share link..."                                                    |
| EXPORT (PPT)         | 30-60 seconds    | "Generating PPT file... (~30-60 seconds)"                                   |
| AUTO_GENERATE (full) | 5-10 minutes     | "This will take approximately 5-10 minutes. I'll notify you when complete." |

---

## Single Script: do.mjs

All operations use one script with different `--step` values:

```bash
node {baseDir}/scripts/do.mjs --step <STEP> [options]
```

### Step 1: CREATE (with outline generation)

```bash
# Initial call (starts the task)
node {baseDir}/scripts/do.mjs --step CREATE \
  --objective "Create a presentation about AI trends for executives" \
  --title "AI Trends 2026" \
  --no-autopoll

# After waiting 30 seconds, poll for status (no --objective/--title needed)
node {baseDir}/scripts/do.mjs --step CREATE \
  --project-id "proj_abc123" \
  --no-autopoll
```

**Output (while processing):**

```
Executing CREATE... (estimated: 30-60 seconds)
[========------------] 40% - AI is analyzing your objective...
```

**Output (when complete):**

```
STATUS: COMPLETED
PROJECT_ID: proj_abc123
MESSAGE: Outline generated successfully. Ready for REFINE_OUTLINE or CONFIRM_OUTLINE.
OUTLINE:
- Introduction to AI Trends
- Current State of AI
- Key Developments in 2026
- Industry Applications
- Challenges and Opportunities
- Conclusion
SETUP_URL: http://okkslides.com/project/setup?projectId=proj_abc123
```

**Save the PROJECT_ID for all subsequent steps.**

---

### Step 2: REFINE_OUTLINE (if AI asks questions or user wants changes)

If the response has `USER_INPUT_REQUIRED: true`:

1. **STOP and present the questions to the user**
2. **Wait for the user's response**
3. **Call REFINE_OUTLINE with the user's exact answer**

```bash
# Initial call (starts the refinement task)
node {baseDir}/scripts/do.mjs --step REFINE_OUTLINE \
  --project-id "proj_abc123" \
  --message "Business pitch presentation, 10 slides, English" \
  --no-autopoll

# After waiting 15 seconds, poll for status (DO NOT include --message!)
node {baseDir}/scripts/do.mjs --step REFINE_OUTLINE \
  --project-id "proj_abc123" \
  --no-autopoll
```

**⚠️ IMPORTANT: This is an SSE step (10-30 seconds processing time)**

After calling the API:

1. **IMMEDIATELY report the status to the user** (e.g., "Updating outline based on your feedback...")
2. Wait **15 seconds** before checking status
3. Poll for status **WITHOUT the `--message` field** - just provide `--step` and `--project-id`
4. Report each status update to the user
5. Continue polling every 10 seconds until COMPLETED/FAILED/WAITING_INPUT

**Keep calling REFINE_OUTLINE** until:

- `USER_INPUT_REQUIRED: false` - Outline is ready
- User says they're satisfied with the outline

---

### Step 3: CONFIRM_OUTLINE

Once the user approves the outline:

```bash
node {baseDir}/scripts/do.mjs --step CONFIRM_OUTLINE \
  --project-id "proj_abc123" \
  --no-autopoll
```

**Output:**

```
STATUS: COMPLETED
MESSAGE: Outline confirmed successfully. Next step: Call GET_DRAFTS to generate 3 style options (~30-60 seconds).
SETUP_URL: http://okkslides.com/project/setup?projectId=proj_abc123
ESTIMATED_NEXT_STEP_TIME: 30-60 seconds
>>> You can also view and edit the outline at: SETUP_URL
```

---

### Step 4: GET_DRAFTS (get 3 style options)

```bash
node {baseDir}/scripts/do.mjs --step GET_DRAFTS \
  --project-id "proj_abc123" \
  --no-autopoll
```

**Output:**

```
STATUS: COMPLETED
MESSAGE: 3 style options available. Ask the user to choose 1, 2, or 3.

DRAFT_OPTIONS:
  DRAFT_1:
    ID: 1
    DESCRIPTION: Professional blue theme with clean layouts
    TAGS: corporate, modern, professional
    NOTE: Best for business presentations

  DRAFT_2:
    ID: 2
    DESCRIPTION: Warm orange theme with creative layouts
    TAGS: creative, warm, engaging
    NOTE: Good for marketing or pitch decks

  DRAFT_3:
    ID: 3
    DESCRIPTION: Green nature theme with organic shapes
    TAGS: eco, nature, sustainable
    NOTE: Ideal for environmental topics

SETUP_URL: http://okkslides.com/project/setup?projectId=proj_abc123
>>> Present these 3 style options to the user and ask them to choose (1, 2, or 3).
>>> You can also view and select styles at: SETUP_URL
```

**Present these options to the user and wait for their choice!**

---

### Step 5: SELECT_DRAFT

After user chooses (e.g., "I'll go with option 2"):

```bash
node {baseDir}/scripts/do.mjs --step SELECT_DRAFT \
  --project-id "proj_abc123" \
  --draft-id 2 \
  --no-autopoll
```

**Output:**

```
STATUS: COMPLETED
MESSAGE: Style 2 selected. Ready for GENERATE_SLIDES step.
SELECTED_DRAFT: 2
SETUP_URL: http://okkslides.com/project/setup?projectId=proj_abc123
>>> You can view the selected style at: SETUP_URL
```

---

### Step 6: GENERATE_SLIDES (Stepwise - RECOMMENDED)

**Use GENERATE_SLIDES for slide generation** - generates slides with progress notifications.

```bash
# Start slide generation
node {baseDir}/scripts/do.mjs --step GENERATE_SLIDES \
  --project-id "proj_abc123" \
  --no-autopoll

# Poll every 10 seconds for progress
node {baseDir}/scripts/do.mjs --step GENERATE_SLIDES \
  --project-id "proj_abc123" \
  --no-autopoll
```

**Output (after FIRST slide - IMPORTANT: Show EDITOR_URL immediately!):**

```
STATUS: IN_PROGRESS
CURRENT_SLIDE: 1
TOTAL_SLIDES: 10
SLIDE_TITLE: Introduction
SLIDE_ID: slide_001
MESSAGE: Slide 1 of 10 completed (~20-40 seconds per slide)
EDITOR_URL: http://okkslides.com/project/editor?projectId=proj_abc123&slideId=slide_001
>>> You can now view and edit the presentation at: EDITOR_URL
>>> Remaining slides will continue generating in the background.
```

**CRITICAL: After first slide completes, IMMEDIATELY tell user:**

- "Your first slide is ready! You can view and edit it here: [EDITOR_URL]"
- "I'll continue generating the remaining slides. You can start reviewing while I work on the rest."

**Output (progress for each slide):**

```
STATUS: IN_PROGRESS
CURRENT_SLIDE: 2
TOTAL_SLIDES: 10
SLIDE_TITLE: Current State
PROGRESS: 20%
MESSAGE: Generating slide 2 of 10: Current State... (~20-40 seconds)
ESTIMATED_REMAINING_SECONDS: 240
```

**Output (when ALL slides complete):**

```
STATUS: COMPLETED
MESSAGE: 10/10 slides generated successfully!
TOTAL_SLIDES: 10
SHARE_URL: http://okkslides.com/s?s=xyz789
EDITOR_URL: http://okkslides.com/project/editor?projectId=proj_abc123
>>> Your presentation is ready! View and edit at: EDITOR_URL
>>> Share with others: SHARE_URL
>>> Would you like me to generate a downloadable PPT file? (~30-60 seconds)
```

**Time Estimate for users:**

- For 10 slides: ~4-7 minutes total
- Progress updates show which slide is being generated
- User can start viewing/editing after first slide!

**Polling behavior for GENERATE_SLIDES:**

- Initial wait: 5 seconds
- Poll interval: 10 seconds
- Report slide progress to user after each poll (e.g., "Slide 3/10 complete")
- Show EDITOR_URL to user as soon as first slide is ready

---

### Step 7: EXPORT (optional PPT download)

If user wants a downloadable PPT file:

```bash
# Start export
node {baseDir}/scripts/do.mjs --step EXPORT \
  --project-id "proj_abc123" \
  --export-format ppt \
  --no-autopoll

# Poll every 5 seconds for progress
node {baseDir}/scripts/do.mjs --step EXPORT \
  --project-id "proj_abc123" \
  --export-format ppt \
  --no-autopoll
```

**Output:**

```
STATUS: COMPLETED
MESSAGE: PPT export completed.
PPT_URL: http://okkslides.com/api/v1/ppt/download?projectId=proj_abc123&fileName=xxx.pptx
```

---

## AI Agent Behavior Guidelines

### 0. CRITICAL: Always Use `--no-autopoll`

**AI agents MUST always include `--no-autopoll` in every command call.** This ensures:

- The agent controls the polling loop
- Every status update is reported to the user
- The agent can properly handle WAITING_INPUT states

### 1. CRITICAL: Real-Time Communication with User

**After EVERY API response, you MUST immediately report to the user.** Do NOT silently poll in the background.

**What to report after each call:**

| Response Contains       | What to Tell User                                    |
| ----------------------- | ---------------------------------------------------- |
| `STATUS: ACCEPTED`      | "Task started, processing..."                        |
| `STATUS: IN_PROGRESS`   | Report progress (see below)                          |
| `SLIDE_PROGRESS: 3/10`  | "Processing slide 3 of 10..." (GENERATE_SLIDES only) |
| `PROGRESS: X%`          | "Progress: X% complete..." (EXPORT only)             |
| `ESTIMATED_WAIT: 30`    | "This will take about 30 seconds..." (SSE steps)     |
| `MESSAGE: "..."`        | Share the message with user                          |
| `STATUS: COMPLETED`     | Show all results immediately                         |
| `STATUS: FAILED`        | Show error and suggest retry                         |
| `STATUS: WAITING_INPUT` | Present questions and wait for user answer           |

**Note:** Do NOT show percentage progress for SSE steps (CREATE, REFINE_OUTLINE, GET_DRAFTS) - those percentages are unreliable. Show `ESTIMATED_WAIT` instead.

**Example conversation flow (with --no-autopoll):**

```
Agent: "Starting to create your presentation... (this takes about 30-60 seconds)"
       [calls API with --no-autopoll, gets ACCEPTED]
Agent: "Task accepted! I'll check back in 30 seconds..."
       [WAIT 30 seconds - this is the SSE initial wait]
       [calls API with --no-autopoll for status check]
Agent: "Still processing... checking again..."
       [WAIT 10 seconds]
       [calls API with --no-autopoll]
Agent: "Done! Here's your outline:
        1. Introduction
        2. Main Topic
        ..."
```

**Example for GENERATE_SLIDES (trackable progress):**

```
Agent: "Starting slide generation for 10 slides..."
       [calls API with --no-autopoll, gets ACCEPTED, TOTAL_SLIDES: 10]
Agent: "Generation started! I'll track progress for you..."
       [WAIT 5 seconds]
       [calls API with --no-autopoll, gets SLIDE_PROGRESS: 1/10]
Agent: "Slide 1 of 10 completed! Here's the editor link: [EDITOR_URL]"
       [WAIT 10 seconds]
       [calls API with --no-autopoll, gets SLIDE_PROGRESS: 3/10]
Agent: "Progress: 3 of 10 slides done..."
       [continues polling every 10 seconds, reporting each update]
       [finally gets COMPLETED]
Agent: "All 10 slides are ready! View at: [SHARE_URL]"
```

### 2. Never Answer Questions for the User

When `USER_INPUT_REQUIRED: true`:

- **STOP polling** and present the questions to the user
- **WAIT** for the user's response before continuing
- **DO NOT** guess or answer on behalf of the user

### 3. Inform User BEFORE Starting Each Step

Before calling the API for each step, tell the user what's about to happen:

| Step            | What to say BEFORE calling                                                                                                                              |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CREATE          | "Creating your presentation... this typically takes 30-60 seconds. I'll keep you updated on progress."                                                  |
| REFINE_OUTLINE  | "Updating the outline based on your feedback... (~10-30 seconds)"                                                                                       |
| GET_DRAFTS      | "Generating 3 style options for you to choose from... (~30-60 seconds)"                                                                                 |
| GENERATE_SLIDES | "Now generating X slides. This is the longest step - about 20-40 seconds per slide, so ~Y minutes total. I'll report progress as each slide completes." |
| EXPORT          | "Creating your downloadable PPT file... (~30-60 seconds)"                                                                                               |

### 4. Keep User Informed During Long Operations

**⚠️ IMPORTANT: Always use `--no-autopoll` and manually poll!**

For operations like `GENERATE_SLIDES` that take several minutes:

```
Agent: "Starting slide generation for 10 slides. This will take about 4-7 minutes total.
        I'll update you as each slide completes..."
       [calls with --no-autopoll]
       [WAIT 5 seconds]
       [polls with --no-autopoll, gets SLIDE_PROGRESS: 1/10]
Agent: "Slide 1 complete (1/10)! View and edit at: [EDITOR_URL]"
       [WAIT 10 seconds]
       [polls with --no-autopoll, gets SLIDE_PROGRESS: 3/10]
Agent: "Progress: 3/10 slides complete..."
       [WAIT 10 seconds]
       [polls with --no-autopoll, gets SLIDE_PROGRESS: 5/10]
Agent: "Halfway there! 5/10 slides complete..."
       [continues until COMPLETED]
```

For SSE-based operations (CREATE, REFINE_OUTLINE):

```
Agent: "Creating your presentation outline. This takes about 30-60 seconds..."
       [calls with --no-autopoll, gets ACCEPTED]
Agent: "Task started! Checking back in 30 seconds..."
       [WAIT 30 seconds - initial wait for SSE steps]
       [polls with --no-autopoll for status]
Agent: "Still processing... checking again in 10 seconds."
       [WAIT 10 seconds]
       [polls with --no-autopoll]
Agent: "Done! Here's your outline..."
```

### 5. Handle Errors Gracefully

If `STATUS: FAILED`:

- **Immediately** report the error message to the user
- Suggest they try again or modify their request
- Do NOT silently retry without telling the user

---

## Quick Reference: Command Examples

**⚠️ AI agents MUST always include `--no-autopoll` in all commands!**

```bash
# Create new presentation (initial call)
node {baseDir}/scripts/do.mjs -s CREATE -o "Your topic here" --no-autopoll

# Poll for CREATE status (no --objective needed, just --step and --project-id)
node {baseDir}/scripts/do.mjs -s CREATE -p proj_xxx --no-autopoll

# Refine outline (initial call with user feedback)
node {baseDir}/scripts/do.mjs -s REFINE_OUTLINE -p proj_xxx -m "User feedback" --no-autopoll

# Poll for REFINE_OUTLINE status (DO NOT include -m/--message!)
node {baseDir}/scripts/do.mjs -s REFINE_OUTLINE -p proj_xxx --no-autopoll

# Confirm outline
node {baseDir}/scripts/do.mjs -s CONFIRM_OUTLINE -p proj_xxx --no-autopoll

# Get draft styles
node {baseDir}/scripts/do.mjs -s GET_DRAFTS -p proj_xxx --no-autopoll

# Select a style
node {baseDir}/scripts/do.mjs -s SELECT_DRAFT -p proj_xxx -d 2 --no-autopoll

# Generate slides
node {baseDir}/scripts/do.mjs -s GENERATE_SLIDES -p proj_xxx --no-autopoll

# Export to PPT
node {baseDir}/scripts/do.mjs -s EXPORT -p proj_xxx -f ppt --no-autopoll

# Export share URL only (fast)
node {baseDir}/scripts/do.mjs -s EXPORT -p proj_xxx -f share_url --no-autopoll
```

---

## Configuration

### API Key

Set `OKK_API_KEY` environment variable:

```bash
export OKK_API_KEY="sk_live_your_key_here"
```

### Accept-Language Header (Required)

**CRITICAL:** All API requests MUST include the `Accept-Language` header with the correct format.

**Format:** `{language}-{region}` (e.g., `en-US`, `zh-CN`, `en-GB`)

| Valid Values | Invalid Values                     |
| ------------ | ---------------------------------- |
| `en-US`      | `en` (missing region)              |
| `zh-CN`      | `chinese` (wrong format)           |
| `en-GB`      | `EN_US` (wrong separator)          |
| `ja-JP`      | `english-us` (wrong language code) |

**Example in HTTP request:**

```
Accept-Language: en-US
```

**Example in code:**

```javascript
headers: {
  'Accept-Language': 'en-US',
  // ... other headers
}
```

**Note:** If the header is missing or malformed (e.g., just `en` without a region code), the API will return an error: `Accept-Language parameter wrong`.

**Environment Variable (for do.mjs script):**

```bash
export OKK_ACCEPT_LANGUAGE="en-US"  # Default: en-US
```

---

## Result Notification Format

After generation completes, present results clearly:

```
Your presentation is ready!

View Online: https://okkslides.com/s?s=xyz789

The presentation includes 10 slides covering:
- Introduction to AI Trends
- Current State of AI
- Key Developments
- [etc.]

Would you like me to generate a downloadable PPT file? (~30-60 seconds)
```

---

## Notes

### Important Reminders for AI Agents

1. **Always Use `--no-autopoll`** - AI agents MUST include `--no-autopoll` in every command
2. **Manual Polling is Required** - After each call, wait the recommended time, then poll again
3. **Report Every Response** - After EVERY API response, immediately tell the user what's happening
4. **Use Recommended Wait Times** - Check `RECOMMENDED_WAIT` or `POLL_INTERVAL` in responses
5. **Rate Limits** - 60 requests per minute per API key
6. **Don't Over-Poll** - Wait at least 3 seconds between calls to avoid rate limits

### Wait Times Summary for Manual Polling

| Step            | Initial Wait | Poll Interval | Notes                                             |
| --------------- | ------------ | ------------- | ------------------------------------------------- |
| CREATE          | 30s          | 10s           | SSE step - don't include --objective when polling |
| REFINE_OUTLINE  | 15s          | 10s           | SSE step - DO NOT include --message when polling! |
| GET_DRAFTS      | 5s           | 5s            |                                                   |
| GENERATE_SLIDES | 5s           | 10s           | Report SLIDE_PROGRESS to user                     |
| EXPORT          | 5s           | 5s            | Report PROGRESS % to user                         |
| Others          | 3s           | 3s            |                                                   |

### Script Polling Behavior

- `--no-autopoll` flag: Returns immediately after initial call with polling guidance (REQUIRED for AI agents)
- Default behavior: Script handles polling internally (for manual/human use only)
- `--no-poll` flag: Returns immediately without any polling support (low-level use)

### Troubleshooting

| Issue                | Cause                  | Solution                                |
| -------------------- | ---------------------- | --------------------------------------- |
| Stuck at IN_PROGRESS | Not polling            | Call the API again with same parameters |
| Rate limited         | Polling too fast       | Wait at least 3 seconds between calls   |
| User confused        | Not reporting progress | Tell user after EVERY API response      |
