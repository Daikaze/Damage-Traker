# Damage Hall of Fame — Foundry V14

> **Separate V14 branch.** The `main` branch remains **Foundry V11 v1.0.6**, unchanged.

## Installation

For Foundry **V14 / D&D 5e 6.0.6**, install with the V14-specific manifest URL:

`https://raw.githubusercontent.com/Daikaze/Damage-Traker/foundry-v14/module.json`

This branch uses the same module id (`damage-traker`) and legacy world-setting keys:
`records`, `players`, `portraits`, `currentSession`, `enabledTypes`,
`trackingEnabled`, `captureMode`, `includeNPC`.
**Back up your world before migrating from V11 to V14.**

## Interface

- Native Foundry ApplicationV2 window with resize by edges, double-click minimize, and theme-aware buttons.
- Highest Hit: strongest sum of applied damage by a PC **within a combat round** (outside combat: strongest individual applied hit).
- Total Damage: total applied damage recorded for that PC.
- Best Round: highest sum of applied events for one combat ID and round.
- Type filter and GM-only type-capture toggles (13 standard D&D5e types plus Other/Unknown).
- PC roster including characters with no damage, player selector, individual history and session totals.
- GM can add/edit/remove manual applied-damage events, assign per-record sessions, edit portrait paths, and set a current session.
- Player clients can read the leaderboard and histories but cannot change stored records.

## Automatic capture — important limits

- **Only post-applied damage** from `dnd5e.applyDamage` and Midi-QOL `midi-qol.damaged`; no dice-roll or pre-application guesswork.
- Stores amounts as Other / Unknown unless a reliable post-applied type split exactly matches total damage.
- Captures only **player characters** with a known attacker. Healing, zero damage, self-damage and NPC attacker events are skipped.
- The **primary active GM client** records confirmed damage events. No untrusted player socket payloads are accepted.
- Duplicate hooks with the same attributable chat message, attacker, target and amount are merged within 8 seconds; unattributed independent events are not dropped by arbitrary dedupe.
- Manual entry remains available when an automation provides no trustworthy attacker context or damage runs entirely on a player client.
- Optional tracking is controlled by the world's `trackingEnabled` setting.
- Confirm actual hook payloads in your **live Foundry V14 + D&D5e 6.0.6 + Midi-QOL** setup; mocks alone cannot guarantee compatibility.

## Release

The V14 branch has its own GitHub Actions workflow and tagged ZIP `v14.1.0`.
Its manifest URL stays on `foundry-v14` and the download points to the immutable
release ZIP. The V11 main manifest and V11 releases are untouched.

## Source

- `scripts/v14-main.mjs`: Foundry V14 UI, GM controls and legacy storage.
- `scripts/v14-applied.mjs`: verified post-application hooks and dedupe.
- `scripts/core.mjs`, `scripts/roster.mjs`, `scripts/portraits.mjs`: legacy-compatible pure helpers.
- `templates/v14-window.hbs` and `styles/v14.css`: native Foundry layout.
