---
description: 
globs: 
alwaysApply: true
---
## Development Principles

Throughout the implementation process, adhere to these principles:

1. **Conceptual Integrity**: Maintain alignment with the project's goals and technical architecture as defined in the implementation plan.
2. **Iterative Enhancement**: Build in layers, making each pass add depth rather than breadth
3. **Living Documentation**: Update plans, principles, and reviews as the implementation evolves. This includes maintaining Problem Trackers (see below) **and ensuring changes are managed via Version Control (see Principle 8).**
4. **Architectural Consistency**: Keep the implementation consistent with the chosen Next.js and backend architecture patterns.
5. **Tangible Progress**: Ensure each iteration results in demonstrable functionality
6. **Systematic Investigation, Verification & Correction (Grounded in 5-Step Cycle & Problem Tracking)**: When encountering issues (build failures, test errors, linter warnings, unexpected behavior, runtime errors, unexpected tool outputs/behavior, logical inconsistencies detected during checks) or needing to confirm facts/actions:
    * **Action:** Initiate **5-Step Core Operational Cycle** (detailed below) for tool-based investigation & verification.
    * **Escalation:** For persistent/complex issues (per criteria), initiate/update **Structured Problem Tracker** (below).
    * **Triage & Correction:** Prioritize fixes (source>build>test>warn); **for same-tier issues, use alphabetical path order as tiebreaker.** Address/document all issues; verify fixes via tools/re-run (Steps 2/5), update tracker. **Do not attempt automated correction (e.g., via `edit_file`) of linter warnings or non-build-critical warnings if it fails persistently (documented in a Problem Tracker), ignore the warning, document this decision in the Vetting Tracker (if applicable), and proceed.**
7. **Proactive Dependency, Build, API, & Source Code Management**:
    * Regularly verify project dependencies (e.g., using `npm install` or `yarn install` via `run_terminal_cmd`).
    * Thoroughly analyze build tool outputs (e.g., Next.js build logs) to diagnose issues effectively.
    * Employ robust strategies for API design and data management (e.g., using Prisma, validation libraries).
    * When modifying core components (e.g., API routes, shared components, hooks) **or vetting existing code**, systematically identify and update dependents **and verify implementation connections** using **tool-based verification** (e.g., `codebase_search`, `read_file` to trace calls from frontend components/tests to `src/app/api` implementations or `src/lib` utilities) to confirm changes and correctness across the codebase. **Assume unvetted code may be incorrect or incomplete until explicitly verified against its intended implementation and project standards.**
8. **Version Control Reliance:**
    * **All significant changes to code or documentation must be managed through the project's Version Control System (VCS), typically Git.**
    * **Ensure work is structured into logically consistent units suitable for commits.**
    * **Utilize VCS capabilities for tracking history, reviewing changes, and enabling rollback/reinstatement if necessary (e.g., if an assessment leading to a modification is later found to be incorrect).**

## Structured Problem Tracking

When persistent or complex issues arise (as defined in Principle 6), utilize dedicated tracker files to ensure focused, systematic, and documented resolution.

1. **Initiation**: Create a new markdown file in `/problems/` (e.g., `/problems/issue_001_test_compilation_failures.md`) when an issue requires structured tracking (e.g., fails Step 5 Check >2 times for the same hypothesis, involves >3 components, is deemed 'High Complexity' by the agent, represents recurring minor issues, **or matches specific pre-defined critical error patterns/codes**). Note: Ensure the directory name is `problems`, not `problem`.
2. **Structure**: Each tracker file **must** contain the following sections:
    * `## Problem Statement`: Clear, concise description of the issue, including error messages or observed behavior.
    * `## Metadata`:
        *   `Status:` (e.g., Open, Investigating, Resolved, Blocked)
        *   `Priority:` (e.g., High, Medium, Low)
        *   `Type:` (e.g., Build, Test, Code Vetting, Dependency, Tool Failure)
        *   *(Optional) Suspected_Tool: [Tool Name]*
        *   *(Optional) Next_Target: [Filepath or Component]*
        *   *(Optional) Last_Tool: [Tool Name used in last attempt]*
        *   *(Add other relevant tags as needed)*
    * `## Current Hypothesis`: The current leading theory about the root cause, based on latest findings.
    * `## Log of Attempts (Chronological)`: A list documenting each significant attempt (often corresponding to one or more 5-Step Cycles) to resolve the issue. Each entry should include:
        * Timestamp/Identifier.
        * Hypothesis tested in this attempt.
        * Key actions/tool calls (brief summary, reference relevant 5-Step Cycle if needed). **When investigating code integrity or suspected hallucination, explicitly note key verification actions undertaken (e.g., specific file reads, searches performed, implementation tracing steps).**
        * Outcome/Findings (verified results, updated hypothesis).
    * `## Resolution Summary` (Filled upon resolution): Concise explanation of the root cause and the successful fix.
3. **Universality & Recursion**: This tracker is applicable to *any* persistent problem type. It is updated *recursively* after each failed or partially successful resolution attempt *within a 5-Step cycle focused on that problem* (Step 5: Check). The log remains concise by focusing on key findings and hypothesis shifts.
4. **Integration**: The tracker serves as the persistent memory for applying the 5-Step Cycle iteratively to a specific problem. Link relevant tracker files when discussing the issue.

## Reflection Process & Continuous Improvement

**Reflection:** After completing major milestones or resolving significant roadblocks (potentially documented in Problem Trackers), conduct a reflection:

1. What aspects of the implementation most successfully embody the project goals and our Development Principles?
2. Where did we encounter unexpected challenges or limitations (technical or conceptual)? How were these documented (e.g., in Problem Trackers)?
3. How did our approach (or the principles themselves, including Problem Tracking) help or hinder resolving these challenges?
4. What technical or conceptual innovations emerged during development?
5. How does the outcome align with our goals?

Document these reflections in `/docs/reflections/` to inform future development.

**Continuous Process Improvement:**
* Learnings from the Reflection Process, particularly regarding challenges and principle application (#3 above), should be synthesized.
* Based on this synthesis, propose specific, actionable refinements to these Development Principles, the Structured Problem Tracking process, and the Core Operational Cycle.
* This ensures the principles remain a practical, evolving guide derived directly from project experience.

## The 5-Step Core Operational Cycle

This cycle governs all agent operations, ensuring a rigorous, tool-grounded, and adaptable workflow. **The level of detail explicitly reported for each step (particularly the internal reasoning in Compile, Elaborate, Check) may be adapted based on the task complexity and the criticality/rigor assessed in Step 2; however, the core requirements of verification (Step 2) and final checks (Step 5) remain mandatory.** Agent autonomy is paramount. The user's role is strictly limited to reviewing the final, completed outcome after *all* planned tasks are finished, **unless the agent encounters an unrecoverable error or a situation explicitly requiring user input by project configuration.** Upon successful completion of a task (verified in Step 5), the agent **must** autonomously initiate a new cycle (starting with Step 1: Inquire) to determine and execute the next logical task based on **1) overall project goals/plans, 2) relevant active context-specific task trackers (e.g., a lib error resolution list if that's the current focus), or 3) outstanding work identified in the previous cycle.** If multiple potential next tasks are identified through these primary sources, the agent **must** select one based on available prioritization or a default heuristic (e.g., alphabetical order of file paths) and proceed autonomously. **Only if these primary sources yield no actionable task**, consult `/problems/` for open issues as the next task source. If `/problems/` is also empty or yields no actionable tasks, log this state and await further instructions or a designated idle procedure. Halting execution to ask for user guidance on the next step is forbidden unless explicitly permitted by the conditions above. For persistent issues, this cycle is applied iteratively, with findings logged in the relevant **Problem Tracker**.

**1. Inquire:**
   * **Action:** Frame internal needs, sub-goals, or points of uncertainty as specific, answerable questions. If addressing a tracked problem, **check tracker metadata for `Next_Target` and prioritize if set.** Otherwise, derive inquiry from the tracker's current hypothesis or broader project goals.
   * **Rationale:** Initiates each micro-process with a clear objective, focusing subsequent steps.

**2. Assess & Verify/Act:**
   * **Action:**
       * **Assessment:** Evaluate the criticality (High/Medium/Low) of the fact to be verified or action to be taken against task requirements (accuracy, safety, consistency, **correctness, especially for unvetted code**) and consult user directives or project configuration files for required rigor ("rigor level"), defaulting to 'High' if unspecified.
       * **Verification/Action:** Based on assessment:
           *   Use available tools (`read_file`, `codebase_search`, `run_terminal_cmd`, etc.) *exclusively* to gather verifying information or perform necessary actions. Internal knowledge is **never** sufficient justification.
           *   When dealing with dependencies, build tools, required frameworks (e.g., testing, linting), or project standards, **verify the project's standard configuration** (e.g., `package.json`, `tsconfig.json`, `next.config.js`, `.eslintrc.js`, relevant build scripts) **before** proceeding based on potentially misleading individual file imports or content.
           *   **When vetting, modifying, or testing code, always use tools (`codebase_search`, `read_file`) to trace and verify the connection between the code under examination (e.g., a React component in `src/components` or a test file) and its corresponding implementation in the `src/app/api` directory, `src/lib`, or relevant source files. Confirm that the implementation exists, matches expectations, and adheres to project standards.**
   * **Rationale:** Enforces **tool-reliant verification**, **adaptive rigor**, adherence to project standards, **and deep source code validation.**
   * **Mandatory Protocol:**
       * **Intent Framing (Before):** State intent: "I will [Action] [Target] for [Goal] (Crit: [Level])."
       * **Confirmation (After):** State outcome post-tool success: "Tool confirms [Result]" or "Action on [Target] done." Log findings if tracker active.

**3. Compile:**
   * **Action:** Consolidate the verified facts, tool outputs, and confirmed action outcomes gathered in Step 2.
   * **Rationale:** Builds the verified context or knowledge base for the next step.

**4. Elaborate:**
   * **Action:** Generate creative or synthesized content (text, code, plans, analysis) *strictly* based on the compiled, verified context from Step 3 and respecting the rigor level from Step 2. **The scope and granularity of elaboration should align with the assessed rigor; simple or low-criticality tasks may involve concise elaboration.**
   * **Rationale:** Permits necessary expansion but tightly controls elaboration within established factual boundaries. Scope aligns with rigor level.

**5. Check:**
   * **Action:** **Check** Step 4 output against Step 3 context and Step 2 rigor. Verify output consistency & correctness for the inquiry. For code tasks, run basic validation (e.g., linter, `tsc --noEmit`) before task completion. Confirm consistency with Step 2 assessment (esp. for high-stakes code). Verify diffs. Crucially, confirm that modifications maintain alignment with the verified source implementation (e.g., API contracts, shared utilities in `src/lib`) and project standards. Verify active Problem Tracker log updated.
   * **Tool Output Verification:** If the output of a critical tool used in Step 2 or 4 seems suspect or inconsistent with other verified information, attempt verification using alternative methods or tools if possible **(e.g., use `read_file` for specific checks if `codebase_search` seems off, or vice-versa).** Treat persistent failures or unreliable output from a specific tool as an issue requiring investigation (potentially via Problem Tracking, similar to persistent `edit_file` failures).
   * **Handling `edit_file` Failures:** If an `edit_file` action attempted in Step 2/4 reports failure:
       * **First Failure:** Treat as a standard deviation requiring a loop back to earlier steps (Inquire or Assess & Verify/Act) for correction (e.g., re-evaluate context, retry edit).
       * **Second Consecutive Failure (for the same intended edit):** 
           *   **Verify State:** Before looping back or escalating, use `read_file` to check the current state of the target file section.
           *   **Compare:** Compare the actual file content with the intended final state of the failed edit.
           *   **Decision Logic:**
               *   **Match Found:** If the file state *matches* the intended state, log this discrepancy (tool reported failure, but state is correct), treat the edit action as *successful* for planning purposes, update the Problem Tracker (if active), and proceed with the cycle.
               *   **No Match:** If the file state *still does not match*, this indicates a persistent, unexplained tool failure. **Initiate or update a Structured Problem Tracker** for this specific edit failure, hypothesizing the root cause (e.g., tool limitation, malformed edit instructions, permissions). Do not automatically retry the same edit again; consider alternative approaches.
   * **Rationale:** Final validation gateway. Detects contradictions, inaccuracies, or scope deviations. Identified issues (including persistent tool failures) force a loop back to earlier steps or escalation via Problem Tracking. Update the relevant Problem Tracker with the outcome (success, failure, new hypothesis) *if a tracker is active for this issue*.

## Agent Collaboration Model (Deprecated - Replaced by 5-Step Cycle & Problem Tracking)

*(Previous content removed - the 5-Step Cycle and Structured Problem Tracking now define the collaboration and operational model.)*