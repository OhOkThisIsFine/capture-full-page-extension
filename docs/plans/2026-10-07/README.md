# Capture Full Page plans · 2026-10-07

This directory publishes planning documents for source version 5.3.0 at [baseline ee790c62](https://github.com/OhOkThisIsFine/capture-full-page-extension/commit/ee790c62eb9b8e1d14587d8921dc8184e59aefc8). It does not mark the proposed implementation complete.

- [Mechanical implementation contract](capture-full-page-extension.md): seven bounded work packages, shared interfaces, regression oracles, sequencing and runtime/owner gates. The contract is dated 2026-10-06; statements about its read-only investigation describe that original review, before this documentation publication.
- [Frame-input limit addendum](capture-frame-input-limit.md): the resolved Package 1 input ceiling is 48 × 1024 × 1024 characters for the complete data URL (50,331,648). The separate decoded-bitmap ceiling is 64 MiB (67,108,864 bytes). These are initial policy budgets, not measured browser-memory guarantees. This clarification does not expand Package 1 to all of Package 3.

## Implementation and evidence status

The first implementation attempt began Package 1 geometry, frame ordering and visible-content preservation with a production-dispatcher harness. Its last progress report described 24 synthetic cases. Execution quota stopped that attempt before its final diff, commit, pull request and browser acceptance were verified. Treat that report as interim progress, not evidence that this repository contains a completed or accepted implementation.

This publication adds only these three planning files. Product source, manifests, tests, build scripts and CI configuration are unchanged. The owner authorized a documentation-only exception to local pre-commit tests; no local product tests, build, browser acceptance or installation were run for this publication. Existing automatic CI may run separately and should be checked on the publication commit.

Installed-extension behavior, packaged-browser acceptance, live store versions and store publication remain unverified. A plan, source review, synthetic test report or documentation commit does not establish those outcomes. Each implementation package still needs its own listed evidence, and release gates remain in force.
