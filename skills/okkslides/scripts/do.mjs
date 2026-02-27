#!/usr/bin/env node
/**
 * OKK Slides Unified API CLI
 *
 * Single script for all presentation generation operations.
 * Uses the unified /api/external/v1/auto/do endpoint.
 *
 * Usage:
 *   node do.mjs --step CREATE --objective "Your topic" [--title "Title"]
 *   node do.mjs --step REFINE_OUTLINE --project-id "xxx" --message "Add more slides"
 *   node do.mjs --step CONFIRM_OUTLINE --project-id "xxx"
 *   node do.mjs --step GET_DRAFTS --project-id "xxx"
 *   node do.mjs --step SELECT_DRAFT --project-id "xxx" --draft-id 1
 *   node do.mjs --step GENERATE_SLIDES --project-id "xxx"
 *   node do.mjs --step EXPORT --project-id "xxx" [--export-format ppt]
 *
 * The script automatically polls for completion on long-running tasks.
 * Use --no-autopoll to disable automatic polling (for AI agent integrations).
 */

import { parseArgs } from "node:util";

const DEFAULT_BASE_URL = "http://23.20.100.64:6691";

// Polling intervals in milliseconds
const POLL_INTERVAL_FAST = 3000; // 3 seconds for quick tasks
const POLL_INTERVAL_NORMAL = 5000; // 5 seconds for normal tasks
const POLL_INTERVAL_SLOW = 10000; // 10 seconds for slow tasks

// Steps that use SSE processing (progress is unreliable, prefer waiting)
const SSE_PROCESSING_STEPS = ["CREATE", "REFINE_OUTLINE"];

// Recommended initial wait time before first status check (in seconds)
const SSE_INITIAL_WAIT = {
  CREATE: 30, // Wait 30s before first check
  REFINE_OUTLINE: 15, // Wait 15s before first check
};

function getConfig() {
  const apiKey = process.env.OKK_API_KEY;
  const baseUrl = (process.env.OKK_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
  const acceptLanguage = process.env.OKK_ACCEPT_LANGUAGE || "en-US";

  if (!apiKey) {
    console.error("ERROR: No API key provided.");
    console.error("Please set OKK_API_KEY environment variable.");
    process.exit(1);
  }

  return { apiKey, baseUrl, acceptLanguage };
}

/**
 * Call the unified /do endpoint
 */
async function callDoEndpoint(request) {
  const { apiKey, baseUrl, acceptLanguage } = getConfig();
  const url = `${baseUrl}/api/external/v1/auto/do`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "X-API-Key": apiKey,
        "Content-Type": "application/json",
        "Accept-Language": acceptLanguage,
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({ message: response.statusText }));
      console.error(`ERROR: ${errorBody.msg || errorBody.message || response.status}`);
      process.exit(1);
    }

    const result = await response.json();
    return result.data || result;
  } catch (err) {
    console.error(`ERROR: ${err.message}`);
    process.exit(1);
  }
}

/**
 * Get poll interval based on step
 */
function getPollInterval(step) {
  switch (step) {
    case "CREATE":
    case "GET_DRAFTS":
    case "EXPORT":
      return POLL_INTERVAL_NORMAL;
    case "GENERATE_SLIDES":
      return POLL_INTERVAL_SLOW;
    default:
      return POLL_INTERVAL_FAST;
  }
}

/**
 * Get estimated time message based on step
 */
function getEstimatedTime(step) {
  switch (step) {
    case "CREATE":
      return "30-60 seconds";
    case "REFINE_OUTLINE":
      return "10-30 seconds";
    case "CONFIRM_OUTLINE":
    case "SELECT_DRAFT":
      return "2 seconds";
    case "GET_DRAFTS":
      return "30-60 seconds (first time)";
    case "GENERATE_SLIDES":
      return "30-90 seconds per slide";
    case "EXPORT":
      return "30-60 seconds for PPT";
    default:
      return "unknown";
  }
}

/**
 * Check if a step has trackable progress (actual slide/file count)
 */
function hasTrackableProgress(step) {
  return ["GENERATE_SLIDES", "EXPORT"].includes(step);
}

/**
 * Output response in a format easy for AI agents to parse.
 * Only prints fields relevant to the current step.
 */
function outputResponse(response) {
  const step = response.currentStep;

  // Common fields for all steps
  console.log(`STATUS: ${response.status}`);

  if (response.projectId) {
    console.log(`PROJECT_ID: ${response.projectId}`);
  }

  console.log(`MESSAGE: ${response.message}`);

  if (step) {
    console.log(`CURRENT_STEP: ${step}`);
  }

  // Step-specific output
  switch (step) {
    case "CREATE":
    case "GET_OUTLINE":
    case "REFINE_OUTLINE":
    case "CONFIRM_OUTLINE":
      // Outline-related steps
      if (response.estimatedSecondsRemaining != null) {
        console.log(`ESTIMATED_WAIT: ${response.estimatedSecondsRemaining}s`);
      }

      if (response.userInputRequired) {
        console.log(`USER_INPUT_REQUIRED: true`);
        console.log("");
        console.log(
          ">>> ATTENTION: The AI asked questions. Present them to the user and wait for answers.",
        );
        console.log(">>> Use REFINE_OUTLINE step with the user's response to continue.");
        console.log("");
        if (response.aiResponse) {
          console.log("AI_RESPONSE:");
          console.log(response.aiResponse);
          console.log("");
        } else if (response.questions && response.questions.length > 0) {
          console.log("QUESTIONS:");
          response.questions.forEach((q, i) => console.log(`  ${i + 1}. ${q}`));
          console.log("");
        }
      }

      if (response.outline && response.outline.length > 0) {
        console.log("OUTLINE:");
        response.outline.forEach((item) => {
          const indent = "  ".repeat((item.level || 1) - 1);
          console.log(`${indent}- ${item.title}`);
        });
      }

      if (response.setupUrl) {
        console.log(`SETUP_URL: ${response.setupUrl}`);
      }
      break;

    case "GET_DRAFTS":
      // Draft options step
      if (response.estimatedSecondsRemaining != null) {
        console.log(`ESTIMATED_WAIT: ${response.estimatedSecondsRemaining}s`);
      }

      if (response.drafts && response.drafts.length > 0) {
        console.log("");
        console.log("DRAFT_OPTIONS:");
        response.drafts.forEach((draft) => {
          console.log(`  DRAFT_${draft.draftId}:`);
          console.log(`    ID: ${draft.draftId}`);
          if (draft.styleDescription) {
            console.log(`    DESCRIPTION: ${draft.styleDescription}`);
          }
          if (draft.styleTags && draft.styleTags.length > 0) {
            console.log(`    TAGS: ${draft.styleTags.join(", ")}`);
          }
          if (draft.briefNote) {
            console.log(`    NOTE: ${draft.briefNote}`);
          }
        });
        console.log("");
        console.log(
          ">>> Present these 3 style options to the user and ask them to choose (1, 2, or 3).",
        );
      }

      if (response.setupUrl) {
        console.log(`SETUP_URL: ${response.setupUrl}`);
      }
      break;

    case "SELECT_DRAFT":
      // Draft selection step
      if (response.selectedDraftId) {
        console.log(`SELECTED_DRAFT: ${response.selectedDraftId}`);
      }

      if (response.setupUrl) {
        console.log(`SETUP_URL: ${response.setupUrl}`);
      }
      break;

    case "GENERATE_SLIDES":
      // Slide generation step - only show progress and editor URL
      if (response.progress != null) {
        console.log(`PROGRESS: ${response.progress}%`);
      }

      if (response.totalSlides) {
        console.log(`TOTAL_SLIDES: ${response.totalSlides}`);
      }

      if (response.currentSlide && response.totalSlides) {
        console.log(`SLIDE_PROGRESS: ${response.currentSlide}/${response.totalSlides}`);
      }

      if (response.estimatedSecondsRemaining != null) {
        console.log(`ESTIMATED_WAIT: ${response.estimatedSecondsRemaining}s`);
      }

      if (response.editorUrl) {
        console.log(`EDITOR_URL: ${response.editorUrl}`);
      }

      if (response.shareUrl) {
        console.log(`SHARE_URL: ${response.shareUrl}`);
      }
      break;

    case "EXPORT":
      // Export step
      if (response.progress != null) {
        console.log(`PROGRESS: ${response.progress}%`);
      }

      if (response.estimatedSecondsRemaining != null) {
        console.log(`ESTIMATED_WAIT: ${response.estimatedSecondsRemaining}s`);
      }

      if (response.shareUrl) {
        console.log(`SHARE_URL: ${response.shareUrl}`);
      }

      if (response.pptUrl) {
        console.log(`PPT_URL: ${response.pptUrl}`);
      }
      break;

    default:
      // Unknown step - output all available fields
      if (response.progress != null) {
        console.log(`PROGRESS: ${response.progress}%`);
      }
      if (response.estimatedSecondsRemaining != null) {
        console.log(`ESTIMATED_WAIT: ${response.estimatedSecondsRemaining}s`);
      }
      if (response.setupUrl) {
        console.log(`SETUP_URL: ${response.setupUrl}`);
      }
      if (response.editorUrl) {
        console.log(`EDITOR_URL: ${response.editorUrl}`);
      }
      break;
  }
}

/**
 * Check if a step uses SSE processing (unreliable progress)
 */
function isSSEProcessingStep(step) {
  return SSE_PROCESSING_STEPS.includes(step);
}

/**
 * Execute step with automatic polling for completion
 * For SSE-based steps, uses wait-then-check pattern instead of frequent polling
 *
 * IMPORTANT: For SSE steps like REFINE_OUTLINE, after the initial call that starts
 * the task, subsequent polls use status-only requests (without the message) to avoid
 * accidentally starting duplicate tasks.
 *
 * @param {Object} request - The API request object
 * @param {Object} options - Options for polling behavior
 * @param {number} options.maxPolls - Maximum number of polls (default: 120)
 * @param {boolean} options.autopoll - Whether to automatically poll (default: true)
 *   When false, returns immediately after the initial call without polling.
 *   This is useful for AI agents that need to handle polling manually.
 */
async function executeWithPolling(request, options = {}) {
  const maxPolls = options.maxPolls || 120; // Max 10 minutes with 5s interval
  const autopoll = options.autopoll !== false; // Default true
  const step = request.step;
  const isSSE = isSSEProcessingStep(step);
  const pollInterval = isSSE ? 10000 : getPollInterval(step); // Longer interval for SSE steps
  const estimatedTime = getEstimatedTime(step);

  console.error(`Executing ${step}... (estimated: ${estimatedTime})`);

  // Initial call - this starts the task
  let response = await callDoEndpoint(request);
  let pollCount = 0;

  // Store projectId for subsequent polling
  let projectId = response.projectId || request.projectId;

  // If autopoll is disabled, return immediately after initial call
  // The caller (e.g., AI agent) is responsible for polling manually
  if (!autopoll) {
    console.log("");
    outputResponse(response);

    // Output polling guidance for agents
    if (response.status === "ACCEPTED" || response.status === "IN_PROGRESS") {
      console.log("");
      console.log("AUTOPOLL: disabled");
      console.log(`POLL_INTERVAL: ${pollInterval / 1000}s`);
      if (isSSE) {
        const initialWait = SSE_INITIAL_WAIT[step] || 15;
        console.log(`RECOMMENDED_WAIT: ${initialWait}s`);
        console.log("POLL_NOTE: For SSE steps, DO NOT include --message when polling for status.");
      }
    }
    return response;
  }

  // For SSE steps, wait the recommended time before first status check
  if (isSSE && (response.status === "ACCEPTED" || response.status === "IN_PROGRESS")) {
    const initialWait = SSE_INITIAL_WAIT[step] || 15;
    console.error(`Processing... please wait approximately ${initialWait} seconds.`);
    console.error(`ESTIMATED_WAIT: ${initialWait}`);

    // Wait the initial recommended time
    await new Promise((r) => setTimeout(r, initialWait * 1000));

    // For SSE steps, poll using status-only request (no message)
    // This prevents accidentally starting a new task
    const statusRequest = {
      step,
      projectId,
      // DO NOT include 'message' field for polling - it would start a new task!
    };
    response = await callDoEndpoint(statusRequest);
    pollCount++;
  }

  // Poll until completion or max polls reached
  while (
    (response.status === "ACCEPTED" || response.status === "IN_PROGRESS") &&
    pollCount < maxPolls
  ) {
    pollCount++;

    // Show appropriate progress based on step type
    if (isSSE) {
      // SSE steps: simple status without progress bar (progress is unreliable)
      console.error(`Still processing... (check ${pollCount})`);
    } else if (step === "GENERATE_SLIDES" && response.currentSlide && response.totalSlides) {
      // GENERATE_SLIDES: show slide progress (e.g., "Processing slide 3/10")
      const progressBar =
        "=".repeat(Math.floor((response.currentSlide * 20) / response.totalSlides)) +
        "-".repeat(20 - Math.floor((response.currentSlide * 20) / response.totalSlides));
      console.error(
        `[${progressBar}] Processing slide ${response.currentSlide}/${response.totalSlides}`,
      );
    } else if (step === "EXPORT" && response.progress != null) {
      // EXPORT: show percentage progress
      const progressBar =
        "=".repeat(Math.floor(response.progress / 5)) +
        "-".repeat(20 - Math.floor(response.progress / 5));
      console.error(
        `[${progressBar}] ${response.progress}% - ${response.message || "Exporting..."}`,
      );
    } else {
      // Other steps: simple message without progress bar
      console.error(`Processing... (${response.message || "please wait"})`);
    }

    // Wait before polling again
    await new Promise((r) => setTimeout(r, pollInterval));

    // Update projectId if we got one
    if (response.projectId) {
      projectId = response.projectId;
    }

    // For SSE steps (CREATE, REFINE_OUTLINE), use status-only polling
    // For other steps, include all original request fields
    let pollRequest;
    if (isSSE) {
      // Status-only request - DO NOT include message to avoid starting new tasks
      pollRequest = {
        step,
        projectId,
      };
    } else {
      // For non-SSE steps, include all original fields
      pollRequest = {
        ...request,
        projectId,
      };
    }
    response = await callDoEndpoint(pollRequest);
  }

  // Output final response
  console.log("");
  outputResponse(response);

  return response;
}

/**
 * Main function
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    printHelp();
    process.exit(0);
  }

  const { values } = parseArgs({
    args,
    options: {
      step: { type: "string", short: "s" },
      "project-id": { type: "string", short: "p" },
      objective: { type: "string", short: "o" },
      title: { type: "string", short: "t" },
      message: { type: "string", short: "m" },
      "draft-id": { type: "string", short: "d" },
      "export-format": { type: "string", short: "f" },
      mode: { type: "string", default: "ppt" },
      "no-poll": { type: "boolean", default: false },
      "no-autopoll": { type: "boolean", default: false },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  if (values.help) {
    printHelp();
    process.exit(0);
  }

  const step = values.step?.toUpperCase();
  if (!step) {
    console.error("ERROR: --step is required");
    console.error(
      "Valid steps: CREATE, REFINE_OUTLINE, CONFIRM_OUTLINE, GET_DRAFTS, SELECT_DRAFT, GENERATE_SLIDES, EXPORT",
    );
    process.exit(1);
  }

  // Build request
  const request = {
    step,
    projectId: values["project-id"] || undefined,
    objective: values.objective || undefined,
    title: values.title || undefined,
    message: values.message || undefined,
    draftId: values["draft-id"] ? parseInt(values["draft-id"], 10) : undefined,
    exportFormat: values["export-format"] || undefined,
    mode: values.mode || "ppt",
  };

  // Validate required fields based on step
  // Note: When using --no-autopoll for polling status, some fields become optional
  const isPollingOnly = values["no-autopoll"] && request.projectId;

  switch (step) {
    case "CREATE":
      // For CREATE, --objective is required for initial call, but optional for status polling
      if (!request.objective && !request.projectId) {
        console.error(
          "ERROR: --objective is required for CREATE step (or --project-id for status polling)",
        );
        process.exit(1);
      }
      break;
    case "REFINE_OUTLINE":
      // For REFINE_OUTLINE, --message is required for initial call, but NOT for status polling
      // When polling status, only --project-id is needed (DO NOT include --message!)
      if (!request.projectId) {
        console.error("ERROR: --project-id is required for REFINE_OUTLINE step");
        process.exit(1);
      }
      if (!request.message && !isPollingOnly) {
        console.error("ERROR: --message is required for REFINE_OUTLINE initial call");
        console.error("       (Use --no-autopoll with only --project-id to poll for status)");
        process.exit(1);
      }
      break;
    case "SELECT_DRAFT":
      if (!request.projectId || !request.draftId) {
        console.error("ERROR: --project-id and --draft-id are required for SELECT_DRAFT step");
        process.exit(1);
      }
      break;
    default:
      if (!request.projectId && step !== "CREATE") {
        console.error(`ERROR: --project-id is required for ${step} step`);
        process.exit(1);
      }
  }

  // Execute with or without polling
  if (values["no-poll"]) {
    const response = await callDoEndpoint(request);
    outputResponse(response);
  } else {
    // autopoll: true by default, false when --no-autopoll is specified
    const autopoll = !values["no-autopoll"];
    await executeWithPolling(request, { autopoll });
  }
}

function printHelp() {
  console.log(`OKK Slides Unified API CLI

Usage:
  node do.mjs --step <STEP> [options]

Steps:
  CREATE           Create project and generate outline
  REFINE_OUTLINE   Refine outline with user feedback
  CONFIRM_OUTLINE  Confirm the outline
  GET_DRAFTS       Get 3 style options
  SELECT_DRAFT     Select a draft style (1, 2, or 3)
  GENERATE_SLIDES  Generate all slides
  EXPORT           Export to share URL and/or PPT

Required Options by Step:
  CREATE:          --objective "Your topic" [--title "Title"]
  REFINE_OUTLINE:  --project-id <id> --message "User feedback"
  CONFIRM_OUTLINE: --project-id <id>
  GET_DRAFTS:      --project-id <id>
  SELECT_DRAFT:    --project-id <id> --draft-id <1|2|3>
  GENERATE_SLIDES: --project-id <id>
  EXPORT:          --project-id <id> [--export-format <share_url|ppt|both>]

Options:
  --step, -s          Step to execute (required)
  --project-id, -p    Project ID
  --objective, -o     Presentation topic (for CREATE)
  --title, -t         Optional title (for CREATE)
  --message, -m       User message (for REFINE_OUTLINE)
  --draft-id, -d      Draft ID 1, 2, or 3 (for SELECT_DRAFT)
  --export-format, -f Export format: share_url, ppt, both (for EXPORT)
  --mode              Output mode: web or ppt (default: ppt)
  --no-poll           Return immediately without waiting for completion
  --no-autopoll       Disable automatic polling (for AI agent integrations)
                      Returns after initial call with polling guidance
  --help, -h          Show this help

Estimated Times:
  CREATE:           30-60 seconds
  REFINE_OUTLINE:   10-30 seconds
  CONFIRM_OUTLINE:  ~2 seconds
  GET_DRAFTS:       30-60 seconds (first time)
  SELECT_DRAFT:     ~2 seconds
  GENERATE_SLIDES:  20-40 seconds per slide
  EXPORT (PPT):     30-60 seconds

Examples:
  # Create a new presentation
  node do.mjs --step CREATE --objective "AI Trends 2026 for executives"

  # Refine the outline
  node do.mjs --step REFINE_OUTLINE -p proj_xxx -m "Make it 10 slides, business style"

  # Complete workflow
  node do.mjs -s CREATE -o "Quarterly Report"
  node do.mjs -s CONFIRM_OUTLINE -p proj_xxx
  node do.mjs -s GET_DRAFTS -p proj_xxx
  node do.mjs -s SELECT_DRAFT -p proj_xxx -d 2
  node do.mjs -s GENERATE_SLIDES -p proj_xxx
  node do.mjs -s EXPORT -p proj_xxx -f ppt

Environment:
  OKK_API_KEY            API key (required)
  OKK_BASE_URL           API base URL (default: ${DEFAULT_BASE_URL})
  OKK_ACCEPT_LANGUAGE    Language-region code (default: en-US, format: {lang}-{region})
`);
}

main().catch((err) => {
  console.error(`ERROR: ${err.message}`);
  process.exit(1);
});
