---
name: parallel-task-execution
description: Plan and execute substantial project work with parallel agents when independent implementation, research, testing, or review can proceed without conflicting edits. Use for decomposable work queues and multi-feature requests.
---

# Parallel task execution

The user prefers parallel work when tasks are independent. Decompose work to expose that independence instead of leaving one large sequential assignment.

## Plan around dependencies and ownership

- Map the requested outcomes to a small dependency graph. Separate shared contracts from implementation, integration, and validation. Keep the active objective and pending requests visible.
- Define a concrete deliverable and acceptance checks for each ready task. Give each worker exact file ownership, allowed side effects, dependencies, and a stop condition.
- Freeze shared interfaces before dependent workers implement against them. A small contract task may finish first while independent research, tests, or UI preparation proceeds.
- Never assign simultaneous writers to the same file. Split files by responsibility, or use isolated worktrees and have the coordinator integrate them. Assign a single owner to shared types, lockfiles, builds, migrations, and deployments.
- Preserve user changes and unrelated processes. A worker does not gain authority to publish, contact people, change accounts, or expand scope merely from being delegated work.

## Use the available parallel capacity

- Start several ready, independent tasks at once. For a sufficiently broad queue, use approximately 8-12 workers when the environment and useful work support it; do not create filler assignments to reach a number.
- Respect the actual runtime cap and tool limits. The configured limit is a preference, not proof that the current session has accepted it. Distinguish child-worker limits from limits that include the coordinator.
- Reuse an idle worker for a related follow-up; use the tool that actually starts its next turn. A queued message alone may not resume an idle worker.
- Do not give a worker a task blocked on unfinished dependencies merely to report it as running. Reassign freed capacity to ready backlog items, tests, or independent reviews.
- Nested delegation uses the same total budget and ownership map. Avoid duplicate investigations and competing coordinators.

## Integrate without races

- Workers report files changed, checks run, findings, and unresolved limits. Code present is not the same as code verified, committed, or deployed.
- Use one coordinator for integration builds and public runtime changes. Do not rebuild assets while another worker validates an exact served build.
- Run independent tests and reviews concurrently when their inputs are stable. Resolve findings with the owning writer, then perform the relevant integration and browser checks.
- Preserve the active priority while parallel workers handle independent ready backlog tasks. Do not replace unfinished work with a newly mentioned feature or silently drop required verification.
- Keep screenshot and visual work in a fresh isolated worker using the installed isolated-ui-review or isolated-image-work skill; return text and artifact paths to the coordinator.
