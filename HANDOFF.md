# TransitTimetables — maintainer handoff

Everything a new maintainer needs to take this over. Written for someone who knows C# but has never touched Cities: Skylines II modding.

- **Live:** [Paradox Mods 150546](https://mods.paradoxplaza.com/mods/150546) · **v0.2.1** · MIT
- **Repo:** https://github.com/AmicusDeus/TransitTimetables
- **Built with:** Claude Code (Opus 4.8 / Fable 5), directed by the author, who is not a professional programmer.

---

## 1. What it does

Turns a public-transport line into a **fixed-departure timetable** instead of vanilla's continuous headway. Works for bus / tram / metro / train / ferry / plane.

Per line, the player opts in and sets a **first departure** plus **peak / off-peak / night intervals**. The mod then:

1. **Derives the fleet** — `ceil(roundTripTime / interval)` — and applies it through the *vanilla vehicle-count policy* (the same path the in-game slider uses). The player sets departures; the fleet follows.
2. **Zeroes unbunching** (`TransportLine.m_UnbunchingFactor = 0`) so vehicles don't idle mid-route to self-space. ⚠️ See §6.1 — this is the current BLOCKER.
3. **Holds each stop's boarding vehicle** to its scheduled minute (the terminus schedule shifted by that stop's cumulative travel + dwell offset), by writing `PublicTransport.m_DepartureFrame`.
4. **Drains surplus vehicles** at the terminus, only after a full lap, so it never dumps passengers mid-route.

A floating panel shows a printed-timetable departure board for every line serving the selected stop. **No timetable set = the line behaves exactly like vanilla.**

---

## 2. Getting set up

**Prerequisites:** CS2 installed, the official CS2 modding toolchain (sets `CSII_TOOLPATH` / `CSII_MODPUBLISHERPATH`), .NET SDK, Node (for the UI bundle).

```bash
# Build + deploy to the game's local Mods folder (also runs the UI webpack build)
DOTNET_ROLL_FORWARD=LatestMajor dotnet build TransitTimetables.csproj -c Release
```

Deploys to `%LOCALLOW%/Colossal Order/Cities Skylines II/Mods/TransitTimetables`.

- **The game must be CLOSED to build.** If it's running you get `MSB3231 ... Access to the path ... is denied` — the *compile* still succeeded; only the deploy step failed. `0 Errors + MSB3231` means "your code is fine, close the game."
- **Logs:** `%LOCALLOW%/Colossal Order/Cities Skylines II/Logs/TransitTimetables.Mod.log`. The mod logs `[SelfTest]` lines for the hold decisions per stop, fleet vs target, and the vehicle-limit range. These are the primary debugging tool — read them before guessing.
- **Settings** persist to `TransitTimetables.coc` and **only flush on a clean Quit-to-Desktop.** Killing the game (or a dev-mode session) means the next launch reads defaults. This looks exactly like "my settings reverted" but is not a bug — don't chase it.

### ⚠️ The decompiled game source

This mod was written by reading a decompiled copy of the game's assemblies (referred to as `cs2src` in the commit history and comments). **You will need your own copy** — the mod's correctness depends on vanilla behaviour that is not documented anywhere else, and several comments cite `File.cs:line` into it.

**Never commit it.** It is Colossal Order's code. It is reference material only, it is not in this repo, and it must not go into this repo or any public location.

---

## 3. Architecture

| File | Responsibility |
|---|---|
| `Mod.cs` | Entry point; registers systems in order: HourlyFleet → TimetableDispatch → VehicleLimit → TransitParamsUI. Settings + English locale. |
| `Setting.cs` | **Global** settings only: peak/night windows, `VehicleLimitMultiplier`, `AnalyzeSharedStops`. No per-line settings, **no master switch** (see §6.6). |
| `TimetableSchedule.cs` | **Per-line serialized ECS component**: enabled, first departure, 3 intervals, terminus stop. **13 bytes — layout is FROZEN, see §7.1.** |
| `LineSchedule.cs` | Reads the line's vanilla Day / Night / DayAndNight route option. |
| `ScheduleMath.cs` | Pure math, no ECS: `NextDeparture`, `FirstDeparture`, `InService`, `Upcoming`, `IntervalFor`, `DerivedFleet`, `MaxInterval`. Unit-testable in your head; start here. |
| `HourlyFleetSystem.cs` | Round-trip duration; `TrySetLineFleet` / `TryClearLineFleet` via the vanilla policy. **Contains two forked vanilla algorithms — see §7.2.** |
| `VehicleLimitSystem.cs` | Widens the **shared** vehicle-count policy range (the global cap). |
| `TimetableDispatchSystem.cs` | **The core.** Runs every 8 frames. Fleet derive+apply, unbunching, `HoldAllStops`/`HoldStop`, surplus drain. Read this first. |
| `TransitParamsUISystem.cs` | C#↔React bindings; builds the departure board. |
| `UI/src/**` | React (`cs2/modding`, `cs2/api`, `cs2/ui`). Injects the editor into `Game.UI.InGame.LineSection`; floating panel + toolbar button. |

### Key vanilla mechanics you must know

These are non-obvious and load-bearing. All verified against the decompiled source.

- **Time:** 1 in-game day = 262,144 sim frames, so 1 in-game minute ≈ 182.04 frames. Route "duration units" are 60-frame units.
- **The hold works because of one gate:** `TransportCarAISystem.StopBoarding` keeps a vehicle boarding while `frame < m_DepartureFrame`, but **only for the vehicle currently in the stop's single `BoardingVehicle` slot**. That's why the mod checks the vehicle is on *this* line's roster before writing (a shared stop's slot may hold another line's bus), and why "one bus per headway occupies the slot" underpins the drain. The same gate is duplicated in the Train / Watercraft / Aircraft AIs.
- **There's a 1800-frame force cutoff:** if `frame >= m_DepartureFrame + 1800`, vanilla skips the passenger-ready wait and departs regardless. The mod's on-time release deliberately uses `frame - 1` (not `frame - 1800`) to open the gate *without* tripping that, which would leave behind a cim still walking up to board.
- **Vanilla does NOT scale a line's fleet to demand.** Vehicle count comes from line length/duration + the vehicle-count policy slider. It's essentially fixed.
- **Ridership is a wait cost.** A cim's routing adds `max(vehicleInterval * 0.5, averageWaitingTime)` to the trip cost. So a wider headway ⇒ longer wait ⇒ fewer riders. This is why timetabling a line with sparse headways visibly loses passengers, and it is not a bug.
- **Surplus culling is odometer-based:** vanilla retires the *highest-mileage* vehicles first, which is why a bus deployed for a peak can be the first flagged when the peak ends. The mod intercepts the `AbandonRoute` flag to defer that until the vehicle completes a lap and reaches the terminus.
- **Vanilla's transport night is hardcoded 22:00–06:00** and it forces a day-only line's vehicle count to **zero** outside its own window. A mod cannot outvote this. See §6.3.
- **A stuck transit vehicle is deleted** only when it is *both* flagged stuck *and* unable to route (pathfind failed / target gone). Merely stuck in traffic with a valid path, it waits. Trams hit this far more than buses because rail can't detour. Not mod-caused; not practically fixable from a mod.

---

## 4. Version history

- **v0.1** — initial release.
- **v0.2** (2026-07-16) — 11 of 12 audited bugs fixed: dwell added to the per-stop hold offset (fixed the reported "buses leave a minute early"); shared-stop foreign-bus skip; vehicle-cap latch + cross-save leak; disable now returns the line to vanilla auto-count and releases held buses; graceful `frame-1` release; per-day anchored departures (fixed schedule drift); out-of-window handling; departures-board reopen bar; dictionary pruning; removed a dead component.
- **v0.2.1** (2026-07-17) — hotfix: the kerb-freeze (see §7.5).

---

## 5. Ground rules for this codebase

1. **Never add a field to a shipped serialized component.** (§7.1 — this one will corrupt every player's save.)
2. **Read the decompiled source before assuming vanilla behaviour.** Nearly every bug in this mod's history came from an assumption about vanilla that the source contradicted.
3. **Prefer loud failure to silent.** The mod's real risk profile is *silent* misbehaviour blamed on the base game, not crashes. When you add an assumption, add a `[SelfTest]` log or a WARN that fires when it's violated.
4. **Check `[SelfTest]` logs before theorising.** They already report hold decisions, fleet vs target, and the policy range.

---

## 6. Open issues — ranked

### 6.1 🔴 BLOCKER (live): uninstalling with a timetable ON permanently disables unbunching

`TimetableDispatchSystem` writes `m_UnbunchingFactor = 0f` on every enabled line, every tick. All three legs verified:

1. It **persists** — `TransportLine` serializes `m_UnbunchingFactor` into the save.
2. **Nothing in vanilla ever restores it** — the only assignment in the game's source is the component's constructor from the prefab default, which runs only when the component is first created.
3. It is **not player-visible** — there is no UI control, policy, or slider for it anywhere in the game.

So: enable a timetable → save → uninstall → those lines have unbunching off **forever**, with no cause, no indicator and no way to fix it. The resulting bunching looks like a vanilla bug. Same outcome if the mod fails to load after a game patch. The only code that can undo it (`RestoreUnbunching`) leaves with the mod.

**Fix:**
- **(a)** A master switch + a `[SettingsUIButton] ResetAllTimetables` ("turn all timetables off before uninstalling") in `Setting.cs`, both running the existing sweep: `RestoreUnbunching` + `ReleaseHeldVehicles` + `TryClearLineFleet` + `m_Enabled=false`. ~20 lines, and it also fixes §6.6.
- **(b) Better** — a system at `SystemUpdatePhase.Serialize` that restores the prefab default just before the save is written. Dispatch re-zeroes it within 8 frames of the next load, so the player never notices and *the save never carries the mod's fingerprint*. Clean by construction rather than by instruction.
- **Check first:** the 8-frame `m_DepartureFrame` re-assert may already dominate unbunching's effect. If so, stop writing the field at all and the hazard disappears entirely.

### 6.2 Accepted, do not re-litigate: the shared vehicle-count policy

Enabling any timetable widens the **one shared** vehicle-count policy range ~8×, which affects other lines whose vehicle slider is above minimum. This is **inherent to CS2**: vanilla saturates a per-line adjustment and lerps it within the shared range, so there is no per-line lever. The author has accepted this.

### 6.3 The mod's night window ≠ vanilla's (silent, daily)

Vanilla hardcodes the transport night as 22:00–06:00 and forces a day-only line's vehicle count to zero outside its window. `ScheduleMath.InService` instead uses the player's `NightStart`/`NightEnd`. At the old default (22/5) they disagreed by an hour **every day, in both directions** — the board posting departures for buses vanilla had already retired, or the timetable silently lapsing while the line still ran.

The **default** is now 22:00–06:00 (existing players keep their saved value, so they still see this). The **full fix**: derive the *operating* window from vanilla's constants, and demote `NightStart`/`NightEnd` to a pure *headway selector* (relabel accordingly). Worth doing alongside Last Departure.

### 6.4 VehicleLimitSystem ordering / cadence skew

It's registered *after* dispatch and runs every 256 frames gated on a flag dispatch only sets at the *end* of its own update. So dispatch computes adjustments against the narrow range, gets silently clamped (while still reporting success, so it caches a fleet that was never applied), then jumps ~8× whenever anything re-evaluates the line.

**Fix:** register VehicleLimit **first**; give it its own query instead of the frame-late static; drop its interval to 8; add a range-version counter that makes dispatch re-apply. Capture the original range from the **authored prefab asset**, not the live buffer (otherwise another mod widening it first compounds). ⚠️ Do **not** add a load-time "recapture" while still reading the live buffer — that creates a real 8×-on-8× ratchet.

### 6.5 Forked vanilla algorithms with no drift detection
See §7.2.

### 6.6 The UI is the only control
There is no `Setting.cs` equivalent for enabling/disabling a line's timetable — it's reachable *only* through the custom React panel. If the bindings break or the `.mjs` fails to load, dispatch keeps holding every bus forever with no way to stop it short of uninstalling, which then triggers §6.1. Fixed by the same change as §6.1(a).

### 6.7 A renamed UI key makes the editor vanish — and the log says it succeeded
`index.tsx` wraps `Game.UI.InGame.LineSection` (literally the vanilla C# type's `FullName`). If that key doesn't exist, the code **proceeds anyway**, installs a wrapper nothing reads, throws nothing, and logs success. A routine CO refactor silently removes the editor.

**Fix:** make a missing key a loud `console.error` that **dumps `Object.keys(map)`** — that tells you the new name immediately, turning a future break into a one-line fix. Also wrap the two raw `moduleRegistry.append` components in the error boundary, and give `safe.tsx` a `componentDidCatch` (it currently swallows throws entirely).

### 6.8 Smaller
Clock canary (§7.4); no `OnGameLoadingComplete` reset (dictionaries persist across save loads within a session); `UI/mod.json` version is stale vs `ModVersion`; `VehicleLimitSystem`'s Absolute branch lacks the interval-floor clamp its Relative sibling has.

---

## 7. Landmines

### 7.1 `TimetableSchedule`'s layout is an immutable on-disk contract

**Adding a field to it will break every existing save.** This is provable, not cautious:

The serializer writes all entities of a component type into **one length-prefixed block with no per-entity delimiter**. A wider reader reads entity 0 correctly, then consumes entity 1's leading bytes as its own new field, and every subsequent entity drifts — including the `Entity` field, which resolves to an *arbitrary unrelated entity* rather than null. The block-length check then throws `ComponentSerializerException` on load.

All three escapes fail: `reader.context.version` is the **game build** version (not yours, and you can't add to it); adding a version field now can't help, because the old bytes don't contain one; and "read only if bytes remain" is impossible — the reader API exposes no position or length.

**The only safe growth path:** put new state in a **new sibling component** with its own leading version byte, written unconditionally. Old saves simply lack the component — the game logs "serializer not found" and cleanly skips it — and the version byte gives you free growth forever via version-gated trailing reads (this is exactly how vanilla grows its own components).

### 7.2 Two vanilla algorithms are copy-pasted

Because the originals are `private`, `HourlyFleetSystem` reimplements vanilla's *stable duration* and *adjustment-from-vehicle-count* calculations. They are faithful today (verified line by line), **including the subtle part**: vanilla uses the *flat prefab* stop duration for stable duration, not the per-stop value. Do not "fix" that — it would be a real regression.

They are forks with **no drift detection, and they compile clean when wrong.** If CO changes the original, the mod's fleet math silently diverges from the game's own vehicle-count panel, and because the same term feeds the hold offsets and the board, everything skews at once.

Worse, the request path doesn't report honesty: vanilla clamps a saturated adjustment but the mod's helper still returns success, so dispatch caches a fleet the line isn't running. **Fix:** forward-verify inside the helper using vanilla's own public path, and on mismatch warn once and return false.

### 7.3 `GameVersion` is not a guard
`GameVersion "1.6.*"` in `Properties/PublishConfiguration.xml` only feeds a *recommended version* field on the store listing. The game will happily load this mod into 1.7. Keep it accurate as a promise to players, but it is not a mechanism.

### 7.4 Compile-time constants cannot self-check
The game's clock constants are `public const`, so referencing them **inlines the value into this mod's IL at compile time**. A "check" like `kTicksPerDay == 262144` is folded to `true` by the compiler and detects nothing. Only a **runtime measurement** (sample `normalizedTime` and `frameIndex` twice, derive frames-per-day) can ever catch a moved clock.

### 7.5 Do not "simplify" the hold's headway clamp
`HoldStop` clamps a hold to `ScheduleMath.MaxInterval` (the line's *longest configured* headway). It is deliberately **not** `IntervalFor(now)`.

The v0.2.1 bug: at an operating-window edge, `NextDeparture` finds no further in-window slot and returns *tomorrow's* first departure, so the wait became hundreds of minutes and got written straight into `m_DepartureFrame` — freezing the bus at the kerb for 6–16 hours while it occupied the stop's single boarding slot, starving every other line there. Nothing recovered it.

Clamping per-minute (`IntervalFor(now)`) looks tighter but **false-positives**: a 04:50 night slot at a 30-minute interval legitimately schedules 05:20, yet `IntervalFor(05:00)` returns the off-peak 12 — releasing a bus 20 minutes early, every night. Any real gap between consecutive slots equals *some* `IntervalFor` value, so bounding by the **maximum** can never false-positive while still catching a runaway.

### 7.6 `TimetableSchedule` is a one-way door
The UI adds the component to any line the player touches, and nothing ever removes it — so it accumulates on abandoned lines and permanently makes those saves depend on this mod. Worth adding a removal path.

---

## 8. Where **not** to spend effort

This matters as much as the bug list.

**There is no Harmony and no reflection anywhere.** Everything goes through `EntityManager` and `World.GetOrCreateSystemManaged`. That removes the single largest failure class in CS2 modding — there is no IL patching to rot.

It also means **most of the exposure is checked by the compiler**: every plain component read is a stable one-field struct, so if CO renames one you get a *build error* — the good failure. **A clean rebuild against each new game version validates that entire surface for free.**

Vanilla also wraps every system's `Update()` in its own try/catch and continues, so **this mod cannot brick a city.** "Mod corrupts save" is not on the table (with the sole exception of §7.1, which is self-inflicted and avoidable).

Enum ordinals are effectively frozen by save compatibility (they're serialized as raw ints), so don't harden there.

**Your entire real exposure is the short list a build will NOT catch:** the boarding gate's semantics, the forked fleet math (§7.2), the UI section key (§6.7), the clock constants (§7.4), and the 1800 force-cutoff constant. Keep that list as a per-patch checklist.

---

## 9. Designed but not built: "Last Departure"

A per-line last departure, so a line runs only for a span of the day. **Feasible** — roughly 150 lines of C#, one new component, one UI row. It's genuinely additive: vanilla's Day/Night is hardcoded and unmovable, a day-and-night line has *no* end of service today, and this would be per-line rather than global.

Design decisions already made (from a full feasibility study):

- **Use a new sibling component** (§7.1). Never extend `TimetableSchedule`.
- **`last` is a bound on the departure grid, not a scheduled event** — the last real departure is the last slot at or before it. Do *not* snap a departure onto `last`: it breaks the day-anchoring, the fleet math's uniform-headway assumption, and the one-bus-per-headway drain gate.
- **Measure the span in elapsed-from-first space, never minute-of-day** (`spanLen = mod1440(last - firstDeparture)`), or every wrapping (night) span breaks. This *replaces* the existing per-day bound and is bit-for-bit identical when unset, so lines without a last departure are provably unaffected.
- **"Unset" must be an explicit flag, never `last == first`** — that's a real configuration meaning "exactly one departure per day".
- Gate per stop against the stop's own seed, not "now" — that's what makes the final lap serve its downstream stops at their posted times for free.
- **Don't** drive the line's Inactive route option to reach a zero fleet: it's the player-facing toggle, it's serialized, and a line left inactive on uninstall stays dead forever. Accept that the line drains to one idling bus (vanilla clamps vehicle count to a minimum of 1) and say so in the UI.

---

## 10. Publishing

`Properties/PublishConfiguration.xml` holds the store listing, `ModId`, `ModVersion` and changelog.

```bash
# from the project root (CWD matters — the thumbnail path is relative)
ModPublisher.exe NewVersion "Properties/PublishConfiguration.xml" -c "<deployed mod folder>" -v
```

Verbs: `Publish` (first time, assigns an id), `NewVersion` (new binary), `Update` (metadata only).

Gotchas that have each cost a failed publish:
- **`Update` requires a non-empty `<ChangeLog>`** or it fails with `Error while processing args`.
- **`ModId` is not written back after the first `Publish`** — if it's blank, a later publish can create a **duplicate listing** instead of updating. Always confirm the `-v` output echoes the expected `Mod Id:` **and** `Display Name:`.
- `ShortDescription` must be 1–200 characters.
- Paradox auto-login works from the **cached session with the game closed** — you don't need the game running.
