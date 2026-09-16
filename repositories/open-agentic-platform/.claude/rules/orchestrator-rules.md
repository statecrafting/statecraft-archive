# Orchestrator Behavioral Rules

These rules apply to any orchestrated, multi-step command or agent workflow in this project. Violating any rule is a failure.

1. **Execute steps in order.** Do NOT skip ahead, reorder, or merge steps.
2. **Write output files.** Each step MUST produce its output file before the next step begins. Read from prior step files -- do NOT rely on context window memory.
3. **Stop at checkpoints.** When you reach a checkpoint, you MUST stop and wait for explicit user approval before continuing.
4. **Halt on failure.** If any step fails (agent error, test failure, missing dependency), STOP immediately. Present the error and ask the user how to proceed. Do NOT silently continue.
5. **Use only local agents.** All agent references use agents bundled with this project. No cross-project dependencies.
6. **Never enter plan mode autonomously.** Do NOT use EnterPlanMode. The command IS the plan -- execute it.
