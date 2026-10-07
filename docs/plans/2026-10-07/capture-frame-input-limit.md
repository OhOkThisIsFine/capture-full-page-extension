# Capture frame-input limit: resolved

Source: [mechanical implementation contract](capture-full-page-extension.md), contract dated 2026-10-06, pinned baseline `ee790c62eb9b8e1d14587d8921dc8184e59aefc8`.

- **Exact frame-input limit:** `MAX_FRAME_DATA_URL_CHARS = 48 * 1024 * 1024` = **50,331,648 characters**.
- **Source:** Package 3 → “Budgets and single-capture admission (CD4),” lines 281–288. Line 283 places the shared policy constants in `capture-protocol.js`; line 288 gives the exact value.
- **Package 1 scope:** “Compositor edits at S10/S11,” lines 163–166, requires envelope validation before fetch/decode and rejection of non-PNG data URLs, lengths above the Q3 frame-input budget, and invalid geometry before expensive work. Package 1 therefore references this shared numeric limit. Apply it to the complete `dataUrl.length`, not only the base64 payload; reject lengths greater than 50,331,648. At the exact limit, all other validations still apply.
- **Accepted input:** Package 5 → “Sender and input validation,” line 612, specifies `data:image/png;base64,` captures with bounded length.
- **Distinct related ceiling:** Line 288 separately specifies `MAX_FRAME_BITMAP_BYTES = 64 * 1024 * 1024` = **67,108,864 bytes**. This is not the data-URL character limit. Lines 304–305 distinguish string/transport accounting from decoded bitmap accounting (`4 * w * h`). The 64 KiB small-envelope bound and Chrome’s separate 64 MiB serialized-message maximum in line 304 also do not replace the 48 Mi-character input limit.

This is a source-fact resolution only. It does not expand the Package 1 implementation assignment to all of Package 3, establish runtime resource qualification, authorize code changes or task continuation, or claim tests passed. The contract identifies these budgets as unmeasured initial policy (line 293).
