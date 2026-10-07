# Frame-input limit: incorporated into the canonical plan

This former addendum is retained only as a stable link. The authoritative implementation instructions are now in [the canonical plan](capture-full-page-extension.md), under the exact types, frame validation and Package 3 budgets.

- MAX_FRAME_DATA_URL_CHARS = 48 × 1024 × 1024 = 50,331,648 characters of the complete data URL, including the `data:image/png;base64,` prefix. Reject lengths greater than this before fetch/decode; equality still requires the other validations.
- MAX_FRAME_BITMAP_BYTES = 64 × 1024 × 1024 = 67,108,864 decoded RGBA bytes, checked as 4 × width × height. It is not the string limit or the runtime messaging limit.
- Neither policy value proves a measured browser-RSS bound or a passed implementation test.
