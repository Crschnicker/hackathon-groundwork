---
target: iOS Walk tab
total_score: 13
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
timestamp: 2026-09-29T21-46-21Z
slug: ios-overlay-walkviewcontroller-swift
---
Method: dual-agent (A: design review · B: detector and measured evidence), followed by an independent adversarial check of each priority finding (10 checkers). Reviewed 2026-09-29. No code was changed.

# Groundwork UI review: web app and iOS Walk tab

## Design health score

| # | Heuristic | Web | iOS Walk tab | Key issue |
|---|---|---|---|---|
| 1 | Visibility of system status | 2 | 2 | Web: 16-second extraction with only a label change. iOS: no elapsed time, and "Recording" stays up after the recorder disconnects. |
| 2 | Match with the real world | 1 | 1 | Neo4j, OpenRouter, "factor code", "next cut in", "gap 850 ms" |
| 3 | User control and freedom | 2 | 1 | iOS: no exit from "Finishing…", no retry for a failed recording |
| 4 | Consistency and standards | 2 | 1 | iOS: breaks the title, margin and card pattern of its three neighbouring tabs |
| 5 | Error prevention | 2 | 1 | iOS: Start is enabled with nothing connected; locking the phone silently stops cuts |
| 6 | Recognition over recall | 2 | 2 | Web: questions sit apart from the area they refer to |
| 7 | Flexibility and efficiency | 2 | 1 | Web: 51 Tab presses to reach the walkthrough box |
| 8 | Aesthetic and minimalist | 2 | 1 | iOS: recorder, diagnostics, settings and log on one screen |
| 9 | Error recovery | 2 | 2 | Messages are well written but shown as low-contrast footnotes or developer text |
| 10 | Help and documentation | 1 | 1 | The rules for a good walk live only in the README |
| | **Total** | **18/40** | **13/40** | Both in the "Poor" band |

## Design specificity verdict

Both surfaces are generic. The web page is the create-next-app look (Geist, stone background, emerald button) and describes itself as exercising the foundation; there is no job, client, address or property anywhere. The Walk tab is a debug console that foregrounds cuts, gaps and kilobytes.

Detector: CLI scan of apps/web/src clean (0 findings). In-page scan reported 5 on desktop: line-length on the two section subheads (apps/web/src/app/page.tsx:20 and :31, real but minor); nested-cards, cramped-padding and em-dash-overuse are false positives (table header, table wrapper, 25 empty table cells).

## What's working

- Gaps are flagged for review, named per area, never guessed.
- The walk recorder protects the audio: an unconfirmed cut becomes a longer recording, the screen stays awake, the token renews itself.
- Search is debounced, cancels stale requests, aligns numerals, and has a useful empty state.

## Priority issues: web app

1. [P1] Main feature buried. The walkthrough heading is 2,300px down at 1440x900 and 4,240px down at 390x844, under 50 catalog rows (ItemSearch.tsx:59, :79). Fix: walkthrough first, catalog second, cap the catalog at about 10 rows. Command: layout.
2. [P1] No walk view. GET /api/walks and /api/walks/:id return transcript and site model; apps/web reads neither. Fix: a walk page that lists walks and polls while unsettled; share the site-model rendering with SiteModelDemo. Do not add a Next route handler at /api/walks (it would shadow the rewrite and break the phone's POSTs). Command: shape.
3. [P1] Area cards drop returned data (SiteModelDemo.tsx:107-130): asSpoken, conditions.notes, removals.quantity and reason, proposedChanges.material. Missing length prints "? ft". A removal is rendered twice. Fix: render them; never print "?". Command: clarify.
4. [P2] Kit panel opens off-screen (ItemSearch.tsx:126). From row 45: rect top -1617 to -1297 desktop, -3231 to -2871 mobile. Persists after the query changes. Fix: expand under the clicked row, keyed on partNumber. Command: layout.
5. [P2] Kit prices mislead (ItemSearch.tsx:40-50): unit price beside fractional quantity, no unit, no extended cost, no total. Fix: kit table with totals. Command: clarify.
6. [P2] Extraction feedback (15.0 to 17.3 s): busy label at 1.49:1, stale result undimmed, no aria-live, focus lost. Fix: always-mounted status line, readable busy button, aria-busy and dimming on the stale result, summary line. Command: harden.
7. [P2] Phone width: table 356/631px, 2 of 7 columns visible, Kit column off-screen; 53 of 54 targets under 44px; kit buttons 22x16. Fix: stacked rows on phone. Command: adapt.
8. [P2] Server-down state: same raw error twice, backticks shown literally (lib/api.ts:22), no recovery. Fix: one banner, retry, plain wording. Command: harden.
9. [P2] Status dots: only Neo4j is a real check; the other three mean a key is set (Crusoe green while returning 401). State conveyed by colour and title only. Fix: three-way state in words. Command: clarify.
10. [P2] Result is a dead end: read-only, nothing to answer, copy or keep; lost on reload. Command: shape.

## Priority issues: iOS Walk tab

1. [P1] Backgrounding or locking stops cuts silently (WalkCutManager.swift:214-221; no lifecycle observers). Fix: observe background and foreground, cut on return, explain. Command: harden.
2. [P1] Device disconnect mid-walk not shown; connection read once at start (WalkCutManager.swift:109). Fix: subscribe to the connection state publisher. Command: harden.
3. [P1] Failed upload cannot be retried and the walk ends looking like success (WalkCutManager.swift:349-357, :395). Fix: distinct end state with "Send again". Command: harden.
4. [P2] Finishing has no exit (WalkViewController.swift:226; WalkCutManager.swift:141-143, :373-398). Self-resolves if the device reconnects. Fix: finishNow() behind a confirmation. Command: harden.
5. [P2] Weak proof of recording: no elapsed time, indicator or haptic; Stop is one tap near the top. Fix: elapsed timer, bottom-pinned button, confirm, haptics. Command: layout.
6. [P2] "Ready" untrue; errors in gray5 #858585 on #f9f9f9 (3.50:1). Fix: status names the first unmet requirement. Command: clarify.
7. [P2] Five jobs on one screen; off-pattern versus Home, Files, Settings (44pt light title, 24pt margins, white 12pt cards). Diagnostics are deliberate for the test build. Command: layout.
8. [P2] Accessibility: fixed fonts down to 11pt, no accessibility labels or announcements, dark-mode text fields on a fixed light page, no keyboard avoidance, 40pt controls. Command: audit.

## Persona red flags

- First-timer: vendor names lead the web page; the walkthrough box has no visible label; README setup order is not on the phone.
- Architect outdoors: 11 to 16pt text; "next cut in" and "Cutting…" read as loss; no haptics.
- Keyboard and screen reader (web): 49 kit buttons named by bare code; 44 Shift+Tab presses from row 45 to Close; Escape does not close; focus lost on Close and on extraction.

## Minor observations

- Default Next.js favicon on the web; the phone app has its own icon.
- Vocabulary differs across surfaces (walkthrough/walk; to confirm/open questions).
- Cost and sale price identical on most rows; one row sells below cost (3531-201).
- "0 items shown (first 50 matches)" in the empty state.
- Question count varies 5 to 8 for the same text; demo script promises two.
- Same phrase extracted as "full sun" and "part sun" in different runs.
- Walk tab icon is an SF Symbol beside three custom assets; bottom inset 110 versus the neighbours' 120.
- Desktop CLS 0.218 when results load.

## Questions to consider

1. Should the recorder's own button be the only control and the phone a silent relay?
2. What would each screen look like if it showed only areas appearing as they are spoken?
3. Which questions actually block a quote, and which could be assumed with a stated default?

## Could not be verified

- Anything rendered on iOS (source review only).
- How a real walk renders (the server held no walks).
- Plaud SDK behaviour on disconnect (closed source).
