# Damage Hall of Fame — Foundry V11

Foundry VTT **v11** D&D 5e damage leaderboard built from scratch.

## Install

**Add-on Modules → Install Module → Manifest URL**:

https://raw.githubusercontent.com/Daikaze/Damage-Traker/main/module.json

The packaged ZIP is hosted in the v1.0.0 GitHub Release created by Actions. If the release has not been published, download a manual ZIP from the project and unpack it under Foundry Data/modules/damage-traker/ with module.json at the root.

Open with one click from the **trophy icon in the left Scene Controls toolbar** or from **Chat sidebar → Hall of Fame**. The shortcut does not switch canvas tools or require a second click. Double-click the Foundry window title bar to minimize.

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

## v1.0.2 fix

- Windows light dropdown menus now use readable **dark option text**, while the closed select stays dark-themed.
- **Rolled damage never creates a record**. The standard capture mode is attached to Foundry V11 D&D5e's Apply Damage / Half / Double context-menu actions.
- Records use **the real HP and temporary HP lost** after the target actor update completes (rather than the rolled number).
- If the user had the old "rolls" capture mode selected, it now behaves as applied-only; old records are NOT deleted.
- Single damage types retain their type even if applied damage is reduced or capped. A mixed-type roll that cannot be split exactly after application is stored under **Other / Unknown**, never guessed.
- Other damage applications from unrelated third-party module buttons, or manual HP edits lacking source attribution, are not inferred.

## v1.0.3 — Token art in Hall of Fame

- The leaderboard displays the **current scene's token artwork** for a hero when available. If there is no token, it uses the hero's **prototype token art**, followed by the **actor portrait**. If no image is available, the original initial-letter badge remains.
- The current record holder's portrait is displayed on the highlighted champion card.
- A **GM-only camera icon on each leaderboard portrait** opens the *Hero Artwork* dialog. **Choose Art** uses Foundry's File Browser to select an image for this hero; **Use Token Art** removes the manual override and returns to the automatic token/actor portrait.
- Players see the configured artwork without being able to change it. Manual overrides persist as a separate world setting; **no actor/token texture or damage record is edited**.
- Artwork is keyed by actor ID, or by normalized hero name for manually created entries without an actor.

All previously recorded damage, filters, and capture settings remain unchanged.

## v1.0.4 — Confirmed damage & initiative-aware Highest Hit

- **Applied Damage:** tracks HP and temporary-HP loss after the chat's Apply Damage
  action, and uses D&D5e's post-application hook for damage applied by the system.
  A roll alone never becomes a record. Duplicate observations of the same HP
  change are ignored.
- **Attacker attribution:** chat-card buttons and chat context actions identify
  the rolling PC. If no source was supplied for a system damage application,
  the current initiative combatant can be used if they are a tracked PC.
  Outside combat, unattributed system damage is intentionally not guessed.
- **Highest Hit:** during initiative, combines that PC's applied hits for
  each combat round (same combat ID + round). Outside initiative it continues
  to score single applied hits. The highest of these scores wins.
- **Best Round**, **Total Damage**, filters, artwork, stored records and existing
  manual edits remain intact. Existing entries with combat/round metadata
  are automatically regrouped in the leaderboard; no migrations.
- Requires a live Foundry V11/D&D5e test for specific third-party damage
  automation pathways; not all third-party buttons expose source metadata.

## v1.0.5 — Saved PCs, Player Selection, per-session history

- **Fix: Add PC** now saves an independent PC roster in the module's **world
  settings**. Adding an existing PC Actor or entering a custom character name
  works even with **zero damage**. Previously Add Record required a positive
  damage number and did not register an empty PC.
- A **Players** tab is next to Damage Types, with a **Player Selection** dropdown,
  a GM-only **Add PC** button and a scrollable roster. Selecting one PC filters
  the leaderboard, without hiding the player's saved identity when they have
  no recorded hits.
- **Click any PC's name, roster card or selected PC's History button** to open
  their damage history. It shows applied damage, type, attack note, combat
  round, date, and a **Damage by Session** summary. Players can view it; only
  the GM can modify or delete it.
- **Session assignment is intentionally GM-controlled**. In the Players panel,
  enter and save **Current Session** to label new applied events. In any PC's
  history, the GM can set or correct the session for each saved event.
  The existing Add/Edit Record form also supports a Session field. Unlabeled
  old records display under "Unassigned session"; no data are erased.
- New **+ Add Damage** in PC History prefills the character in the manual
  damage form, useful for entering previous sessions.
- Removing a PC from the *registered roster* does not erase their damage
  records, which remain discoverable via Player Selection and history.
- Highest Hit in initiative, regular hits outside combat, damage filters,
  GM-only edit controls, artwork, and existing records/settings are preserved.
- Compatibility target remains **Foundry VTT v11 / D&D5e**. The new pure
  roster/session utilities have dedicated automated tests; live V11 testing
  of the interface remains recommended.


## v1.0.6 — Fix Applied Damage and black history theme

- Damage history dialogs now have their own dark/black background and high
  contrast text, controls, headings, session summaries and buttons. The
  dashboard's palette is retained.
- **Fix**: capture HP/temporary-HP losses that originate from other clients.
  The primary online GM listens to all Actor HP updates, not only its own
  actions, while player-initiated events can also be forwarded over the
  existing module socket.
- **Fix**: D&D5e preApplyDamage and applyDamage hooks preserve verified
  damage attribution; damageActor and Actor document updates offer
  deduplicated fallbacks. Damage-roll chat provenance is matched only
  when a recent relevant damage message is available.
- When damage was confirmed by D&D5e and chat attribution is absent during
  initiative, the currently active PC may be credited. Out of combat
  with no attributable source, damage is not assigned to an arbitrary PC.
- **Never** count a bare chat damage roll. Damage is recorded only after
  HP or temporary HP loss or a confirmed D&D5e applied-damage event.
- Automatic and socket duplicates are deduplicated using target final HP
  state, source, combat round and message identity.
- Existing world records, registered PCs, portraits, damage types and
  manually assigned sessions are preserved without migration.
- Live end-to-end validation is still required on the user's actual
  Foundry V11/D&D5e world, including third-party damage automation.
