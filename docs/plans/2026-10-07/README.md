# Capture Full Page plans · 2026-10-07

Start with [the canonical implementation plan](capture-full-page-extension.md), then [the finite closure/evidence checklist](closure-evidence-checklist.md). These are the only current implementation instructions for this plan. The earlier mechanical contract and separate addendum are superseded; Git history preserves them for reference. [The frame-limit link](capture-frame-input-limit.md) now points to the integrated contract.

Revision 3 is source-reviewed: the original 14 findings and the three residual interactions are closed in their assigned scopes. [Geometry/resource approval](reviews/geometry-resources-approval.md), [lifecycle/publication approval](reviews/lifecycle-publication-approval.md) and [source provenance](source-provenance.md) record the exact reviewed hashes, editorial publication hashes and limits of those approvals.

The publication parent is 221521fc63bff7ab6d8a71a2d8792d1b476ff462. Its product code matches ee790c62eb9b8e1d14587d8921dc8184e59aefc8, source version 5.3.0. This packet changes documentation only. It does not implement, install, release or publish an extension. Existing repository build CI is not real-browser, installed-update or store proof.

The earlier Package 1 attempt reported 24 synthetic cases before quota failure; its final diff, commit, pull request and real-browser acceptance remain unverified. None is counted as completed implementation evidence here.

The input ceiling is 50,331,648 characters of the complete PNG data URL. The separate decoded-frame ceiling is 67,108,864 bytes. Neither establishes measured browser-RSS limits.

The plan preserves right-click full-page capture, automatic naming and one native PNG download without an extension-added Save prompt. Incomplete compatibility work stays draft while the useful baseline remains available. Actual implementation, native pixel/geometry/resource/private-path qualification, toolchain/CI-graph checks, account/fee/license/signing/protection/verified privacy URL gates, store-live status and installed updates remain future evidence requirements.
