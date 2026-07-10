# Transit Timetables

Real timetables for public transport in **Cities: Skylines II** — fixed departures, auto-sized fleets, and terminus timing points. Works for buses, trams, metros, trains, ferries and aircraft.

**Paradox Mods:** https://mods.paradoxplaza.com/mods/150546

## What it does
Turn any line into a scheduled service:
- Set a first departure time and peak / off-peak / night intervals.
- The mod derives how many vehicles the line needs and raises the game's vehicle-count ceiling so the fleet isn't clamped.
- Vehicles are **held at each stop until that stop's scheduled departure**, then leave — proper timetabled service instead of bunching.
- Surplus vehicles retire at the terminus after finishing their loop, never mid-route.

No timetable set = the line runs exactly like vanilla. Includes an in-game departures board.

## Under the hood (for the curious / security-minded)
- **Pure ECS — no Harmony patches.** It writes `PublicTransport.m_DepartureFrame` to hold vehicles to their scheduled minute, drives the game's own vehicle-count policy for fleet sizing, and manages retirement via the vehicle's own route flags.
- **No network access at all** — nothing leaves your machine.
- **Filesystem:** writes only its own settings file and a log (`TransitTimetables.Mod.log`). Nothing else.
- **UI:** ships an in-game panel (React module, `.mjs`). It's UI only — it reads/writes the mod's own settings, no external calls.
- **Dependencies:** none beyond the base game.

Full source is here; the compiled DLL decompiles cleanly if you'd like to verify it matches.

## Build from source
Requires the official CS2 modding toolchain. `dotnet build -c Release` compiles the C#, builds the UI, and deploys to your local Mods folder.

## License
[MIT](LICENSE).

---

*Made with [Claude Code](https://claude.com/claude-code), Anthropic's agentic coding tool.*
