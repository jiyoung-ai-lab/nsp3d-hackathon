# Muse CLI Usage Record (MUSE_CLI_USAGE.md) — NSP_3D

- Written: 2026-11-02. Principle: only file- and log-confirmed items are recorded.
- Related: `META_AI_USAGE.md` (Baseten API), `MUSE_SPARK_USAGE.md` (deliverables, limits §4).

## 1. Channel split

- Baseten API (`meta-models/muse-spark-open-1026`, `inference.baseten.co/v1`):
  58 calls / 262,708 tokens (2026-10-29~11-02 KST, fully cross-checked against `python/credit_log.jsonl`).
  Uses: consults, cross-reviews, log narratives, connection probes. CLI session usage not included.
- Muse Code CLI sessions: all interactive development in §2 below. Usage confirmed
  recorded as token events (`"input_tokens"` etc.) in session logs. 2,758 sessions in period
  (10-20~11-02, all projects combined. Session headers carry no project identifier so
  NSP_3D-only counting is impossible — see §3). Daily totals (10-27~11-02, active KST days):
  in 3,105,181,399 / out 21,121,661 (full session-log count, all projects combined).
- Spark daily (10-30~11-02, KST): in 585M·358M·571M·492M (≈2,006M total) /
  out 3.6M·2.3M·3.6M·2.7M (≈12.2M total). Source: usage page (CLI session logs).
  The 7-day total above (3,105M/21.1M) and the daily table cover different ranges, so no direct comparison.
  Dashboard: 22.9k requests · 128 tool calls · 93.9% cache hit.
- Meta AI chat: quick questions (competition, video shooting) (user-attested, no logs).
  Detail: `META_AI_USAGE.md`.

## 2. CLI usage log (evidence files)

1. K-fix dev loop (measure→fix→verify): `docs/CHANGELOG.md`, all of `tests/`
   (176 pass / 9 skip, confirmed via `npm test`), `tests/verify-*.mjs`.
2. Ax batches: `python/ax_loop.py` (local `ax-platform`, 0 API tokens),
   `python/trial.cjs` (browser trial bridge). First study `multi0`
   12 trials, 0 failures (recorded in `META_AI_USAGE.md`).
3. Baseten PC capture link: 6 `video_resources/scripts/desktop_*.bat` files
   (auto_rec, batch_rec, capture, chrome_headless, localhost, move_watcher),
   `video_output/desktop_bundle/`, `python/ba/answer_desk_pipeline.md`,
   `python/ba/answer_chrome_fontcrash.md` (each + `.raw.json`).
  Note: no Dockerfile in repo. Docker setup lives on the user's PC side.
4. Agent logs and background runs: `python/credit_log.jsonl` (58-line API call log),
   2,758 session logs, background batch chunks (recorded in `MUSE_SPARK_USAGE.md` §8).
   `python/usage_daily.jsonl` is a 2-line old version, for reference only.
5. Video recording: `video_resources/scripts/` (`screencast.cjs`, `capture.cjs`,
   `demo_shoot.cjs`, `assemble_*.ps1`, `build_top4.ps1`),
   `video_resources/clips/` (demo1/2/3, top4_new, v2 takes),
   `video_output/20261102_3min_review_v8_1080.mp4` (1920x1080, 180s).
6. Auto history, file and git management: 4 worklogs (EN/KO, kept locally),
   session memory (`checklist.md` etc.).
7. Tech issue response: `META_AI_USAGE.md` consult records (10-30/31, answer file exists for every case),
   71 files under `python/ba/` (answers + raw JSON + queries), worklogs (local) · CHANGELOG.
8. Live UI edits: `src/ui/` (`app.js`, `i18n.js`), `index.html` (:8123 verified live),
   `pages/*.html` (except multilab), KO/EN dictionary and style edits.
9. BGM audio search and player screen: `video_output/bgm_preview.html`,
    `video_resources/audio/test_meanwhile.mp3`,
    `python/ba/answer_bgm_youtube_safe.md` (+`.raw.json`),
    2 BGM entries in credit_log (per-genre pick + retry).
10. Experiment management screens: `pages/multilab.html` (multilab batch experiments),
    `pages/ax-compare.html` (AX before/after), `index.html` experiment anchors.
11. Custom neuron-cloud render (11-03): `video_resources/scripts/render_neuron_hook.py`
    (1,854-neuron schematic layout rotation, 210 frames + `final/work/nhook/build.log`),
    dropped from final after P1 1b replaced it with a text card (trace kept).
12. P1 shot4 drone shoot (11-03): `video_resources/scripts/shoot_s4.cjs`
    (maze2 Smart Drone + panel, binocular fusion 20s → reshot monocular fog 20s),
    `clips/s4_follow_mono_fog_20s.mp4` 2-12s used.

## 3. Usage evidence and limits

- Baseten API figures are final (§1). CLI (Muse) figures count full session logs:
  2,758 sessions, summed over usage records (reported, provider), by active KST day (18 record-less cases excluded as missing).
  10-27~11-02 in 3,105,181,399 / out 21,121,661 (all projects combined,
  NSP_3D-only split impossible). Cross-checked against Meta Model API dashboard totals (3,135.1M/19.4M):
  in matches within 1% (out is 9% higher due to counting-basis differences).
  Dashboard captures: my_clip/screenshots 2026-11-03 0107*.png (2 files).
- Counting method (for future dumps): match and sum `"input_tokens"` /
  `"output_tokens"` values in each `session.jsonl`. Token-event presence confirmed in the live session.
- Attribution limits: per `MUSE_SPARK_USAGE.md` §4. No claim of commit-, prompt-original-, or line-level
  attribution (session logs are execution records, not authorship attribution).
