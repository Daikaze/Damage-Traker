# Damage Hall of Fame — Foundry V11

Foundry VTT **v11** D&D 5e damage leaderboard built from scratch.

## Install

**Add-on Modules → Install Module → Manifest URL**:

https://raw.githubusercontent.com/Daikaze/Damage-Traker/main/module.json

The packaged ZIP is hosted in the v1.0.0 GitHub Release created by Actions. If the release has not been published, download a manual ZIP from the project and unpack it under Foundry Data/modules/damage-traker/ with module.json at the root.

Open from **Chat sidebar → Hall of Fame**. Double-click the Foundry window title bar to minimize.

## Leaderboards

- **Highest Hit:** largest single damage-roll event, including all typed parts.
- **Total Damage:** sum of recorded damage events for each character.
- **Best Round:** sum of each character's recorded damage events with the same combat ID and round. Out-of-combat rolls count only in the other two categories.
- Players can view the leaderboard. Only GM can add, edit or delete records.
- **Tracking toggle** at top right switches automatic recording on and off for the entire world. Turning it off never deletes existing records.
- **13 official D&D 5e types**: acid, bludgeoning, cold, fire, force, lightning, necrotic, piercing, poison, psychic, radiant, slashing, thunder. An extra **Other / Unknown** bucket accounts for untyped or ambiguous damage.
- Filter the leaderboard by type using the dropdown. GM can open the options panel and toggle capture of each type individually. Disabling a type prevents NEW damage of that type from being saved; existing records remain.
- Damage logs are stored as world settings, not browser-local data. No demo records.

## Accuracy

By default the tracker records already evaluated D&D 5e DamageRoll totals, including modifiers and critical dice, and never rerolls a formula. Where chat exposes multiple typed rolls or reliable flavored-term subtotals, the event is split by type. If a combined formula cannot be split exactly, it is marked Other / Unknown instead of guessing. Healing and normal skill/attack checks are ignored.

**Rolled damage is NOT necessarily damage dealt**: an attack may miss, the target may save, or damage may be reduced by resistance/immunity. Standard mode tracks rolled damage, not inferred HP loss. Generic chat rolls without damage metadata are skipped.

### Optional Midi-QOL applied mode

In module settings, select **Midi-QOL applied damage**. Requires a Foundry V11-compatible Midi-QOL build exposing its RollComplete workflow and target appliedDamage. This mode records damage applied to each target, and can use an exact post-mitigation typed breakdown when supplied; otherwise applied total is Other / Unknown. Midi mode and default roll mode never capture simultaneously. Test your specific Midi-QOL version before relying on it.

## Notes

- At least one online GM is needed to save world records.
- New messages only; no automatic backfill of historic chat.
- Chat message IDs deduplicate repeated evaluations and edits to existing events are preserved.
- NPCs are off by default; GM can enable in module settings.
- If every damage type is switched off, no automatic events are saved.
- Live Foundry V11 end-to-end tests have not yet been run.

## Development

Run: node --test tests/core.test.mjs

The GitHub Actions workflow tests sources and packages a ZIP with module.json, scripts, templates and styles at its root. The manifest's release link requires GitHub Actions to be enabled for the repository.
