---
name: systematic-debugging
description: A comprehensive methodology for diagnosing and fixing bugs systematically. Use this skill when troubleshooting failing tests, runtime errors, unexpected behavior, performance issues, integration failures, or any problem requiring root-cause analysis.
---

# Systematic Debugging

Follow a disciplined debugging process instead of guessing.

## Core Workflow

1. Reproduce the issue reliably.
2. Read the exact error messages, stack traces, logs, and failing assertions.
3. Identify what changed recently, if version control or history is available.
4. Form a small, testable hypothesis about the root cause.
5. Inspect the data flow and control flow around the failure.
6. Add targeted instrumentation only where it clarifies the hypothesis.
7. Make the smallest fix that addresses the root cause.
8. Verify with the original failing case and nearby regression coverage.
9. Remove temporary debugging output before finishing.

## Rust-Focused Checks

When debugging Rust code, start with compiler and tool feedback:

- Run `cargo check` to catch type, borrow, lifetime, and feature-gating errors.
- Run `cargo test` to reproduce behavior failures.
- Run `cargo clippy -- -D warnings` for common logic, API, and maintainability bugs.
- Use `RUST_BACKTRACE=1` for panics and `RUST_BACKTRACE=full` when frames are missing.
- Inspect `Result` and `Option` paths for swallowed errors, fallback behavior, and incorrect `unwrap` or `expect` assumptions.
- Check async boundaries for dropped futures, blocking calls inside async code, missed cancellation, and lock ordering issues.
- Check unsafe blocks for aliasing, lifetime, initialization, FFI layout, and ownership invariants.

## Investigation Prompts

Ask these questions while narrowing the fault:

- What is the first observable incorrect state?
- Which input, state, or dependency differs between passing and failing runs?
- Is the failure deterministic, timing-dependent, or environment-dependent?
- Did the bug exist before the recent change?
- Is the current fix treating the root cause or just hiding the symptom?

## Patch Discipline

Keep the change focused:

- Prefer one root-cause fix over broad refactors.
- Preserve existing public behavior unless the bug is that behavior.
- Add or update tests when the failure can reasonably be captured.
- Mention any remaining uncertainty or untested edge case in the final response.
