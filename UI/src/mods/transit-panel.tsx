import { useState, useEffect, useRef } from "react";
import { bindValue, useValue, trigger } from "cs2/api";
import { FloatingButton } from "cs2/ui";
import { useT } from "mods/i18n";
import ICON from "../transittimetables-icon.svg";

const G = "TransitParams";

// Selected LINE timetable (drives the editor injected into the line panel).
const selHas$ = bindValue<boolean>(G, "selHas", false);
const selTtEnabled$ = bindValue<boolean>(G, "selTtEnabled", false);
const selTtFirst$ = bindValue<number>(G, "selTtFirst", 300);
const selTtPeak$ = bindValue<number>(G, "selTtPeak", 8);
const selTtOffPeak$ = bindValue<number>(G, "selTtOffPeak", 12);
const selTtNight$ = bindValue<number>(G, "selTtNight", 30);
const selTtInterval$ = bindValue<number>(G, "selTtInterval", 0);
const selTtFleet$ = bindValue<number>(G, "selTtFleet", 0);
const selTtNext$ = bindValue<string>(G, "selTtNext", "");

// Which windows apply + their hours, so the editor shows only relevant intervals and communicates the times.
const selSchedule$ = bindValue<number>(G, "selSchedule", 2); // 0=Day, 1=Night, 2=DayAndNight
const peakHours$ = bindValue<string>(G, "peakHours", "");
const nightHours$ = bindValue<string>(G, "nightHours", "");

// Selected STOP departure board (drives the floating panel).
const selStopHas$ = bindValue<boolean>(G, "selStopHas", false);
const selStopBoard$ = bindValue<string>(G, "selStopBoard", "[]");
const autoOpen$ = bindValue<number>(G, "autoOpen", 0);
// "Selected line" context for the per-line terminus button (the line open on the left panel).
const selStopLineNum$ = bindValue<number>(G, "selStopLineNum", 0);
const selStopLineServes$ = bindValue<boolean>(G, "selStopLineServes", false);

// Module-level open state for the floating stop panel.
let _open = false;
const _subs = new Set<() => void>();
function setOpen(v: boolean) {
    if (_open !== v) { _open = v; _subs.forEach((f) => f()); }
}
function useOpen() {
    const [, force] = useState(0);
    useEffect(() => {
        const f = () => force((x) => x + 1);
        _subs.add(f);
        return () => { _subs.delete(f); };
    }, []);
    return _open;
}

const hm = (min: number) => {
    let m = ((Math.round(min) % 1440) + 1440) % 1440;
    const h = Math.floor(m / 60), mm = m % 60;
    return (h < 10 ? "0" : "") + h + ":" + (mm < 10 ? "0" : "") + mm;
};

const stepBtn = {
    cursor: "pointer", width: "24rem", height: "22rem", fontSize: "14rem", color: "white",
    background: "rgba(255,255,255,0.12)", borderRadius: "4rem",
} as const;

// Coarse step (±1h on the clock, ±10 on an interval) — wider so a two-character label fits, smaller type so it sits
// level with the ± glyphs. Paired with stepBtn everywhere: coarse outside, fine inside, value in the middle.
const stepBtnCoarse = {
    cursor: "pointer", width: "30rem", height: "22rem", fontSize: "11rem", color: "white",
    background: "rgba(255,255,255,0.12)", borderRadius: "4rem",
} as const;

// First departure is a CLOCK time, so stepping WRAPS rather than clamping: -5 from 00:00 gives 23:55, which is how
// you reach a late-night first departure without 280 clicks. The C# trigger clamps to 0..1439 anyway, and this is
// already normalized into that range, so the clamp is a no-op.
const wrapMin = (v: number) => ((Math.round(v) % 1440) + 1440) % 1440;

// Native close button: the game's Close glyph as a mask tinted with the panel text colour (matches the native
// panels, which use url(Media/Glyphs/...) masks — not a literal "X"). pointerEvents:auto for reliable clicks.
const CloseGlyph = ({ onClick }: { onClick: () => void }) => (
    <button
        onClick={onClick}
        style={{ cursor: "pointer", width: "24rem", height: "24rem", border: "none", background: "transparent", padding: 0, pointerEvents: "auto" } as any}
    >
        <div style={{
            width: "24rem", height: "24rem", margin: "auto", backgroundColor: "var(--textColor)",
            maskImage: "url(Media/Glyphs/Close.svg)", WebkitMaskImage: "url(Media/Glyphs/Close.svg)",
            maskSize: "contain", WebkitMaskSize: "contain", maskRepeat: "no-repeat", WebkitMaskRepeat: "no-repeat",
            maskPosition: "center", WebkitMaskPosition: "center",
        } as any} />
    </button>
);

const IntervalRow = ({ label, hours, value$, trig }: { label: string; hours?: string; value$: any; trig: string }) => {
    const v = useValue(value$) as number;
    const set = (nv: number) => trigger(G, trig, Math.max(1, Math.round(nv)));
    return (
        <div style={{ display: "flex", alignItems: "center", padding: "3rem 0" }}>
            <div style={{ flex: 1 }}>
                <div style={{ fontSize: "13rem" }}>{label}</div>
                {hours ? <div style={{ fontSize: "10rem", opacity: 0.5 }}>{hours}</div> : null}
            </div>
            {/* ±10 keeps a two-digit headway cheap to reach (16 min = +10 then +1 x6, not sixteen clicks), while ±1
                still lands on any exact minute. Adds/subtracts a flat 10 rather than snapping to a multiple of it, so
                the ones digit you dialled in survives: 16 -> 26 -> 16. `set` already clamps at 1. Margins, not `gap`
                (cohtml has no flex gap). Mirrors the First departure row above: coarse outside, fine inside. */}
            <button style={{ ...stepBtnCoarse, marginRight: "5rem" }} onClick={() => set(v - 10)}>−10</button>
            <button style={stepBtn} onClick={() => set(v - 1)}>−</button>
            <div style={{ width: "54rem", textAlign: "center", fontSize: "13rem" }}>{Math.round(v)} min</div>
            <button style={stepBtn} onClick={() => set(v + 1)}>+</button>
            <button style={{ ...stepBtnCoarse, marginLeft: "5rem" }} onClick={() => set(v + 10)}>+10</button>
        </div>
    );
};

// The timetable editor — injected into the native line info panel. Renders nothing unless a transport line is
// selected (self-gates on selHas, so it's inert on non-line selections and work routes).
export const TimetableEditor = () => {
    const has = useValue(selHas$);
    const on = useValue(selTtEnabled$);
    const first = useValue(selTtFirst$) as number;
    const interval = useValue(selTtInterval$) as number;
    const fleet = useValue(selTtFleet$) as number;
    const next = useValue(selTtNext$) as string;
    const schedule = useValue(selSchedule$) as number; // 0=Day, 1=Night, 2=DayAndNight
    const peakHrs = useValue(peakHours$) as string;
    const nightHrs = useValue(nightHours$) as string;
    const t = useT();
    if (!has) return null;
    // Only show the intervals the line actually runs: day-only → Peak+Off-peak, night-only → Night, both → all.
    const showDay = schedule === 0 || schedule === 2;
    const showNight = schedule === 1 || schedule === 2;

    return (
        <div style={{ borderTop: "1rem solid rgba(255,255,255,0.15)", padding: "8rem 14rem 10rem", color: "white" }}>
            <div style={{ display: "flex", alignItems: "center", marginBottom: "6rem" }}>
                <div style={{ flex: 1, fontSize: "var(--fontSizeS)", fontWeight: "bold", textTransform: "uppercase", color: "var(--textColor)", opacity: 0.9 } as any}>{t("timetable", "TIMETABLE")}</div>
                <button
                    onClick={() => trigger(G, "setSelTtEnabled", !on)}
                    style={{
                        cursor: "pointer", padding: "4rem 12rem", borderRadius: "4rem", fontSize: "12rem", color: "white",
                        background: on ? "rgba(60, 160, 90, 0.95)" : "rgba(120, 120, 120, 0.6)",
                    }}
                >
                    {on ? t("on", "ON") : t("off", "OFF")}
                </button>
            </div>
            {on && (
                <>
                    <div style={{ fontSize: "12rem", color: "rgb(120, 210, 130)", marginBottom: "2rem" }}>
                        {t("ttNow", "now every {i} min · {f} vehicles", { i: interval, f: fleet })}
                    </div>
                    <div style={{ fontSize: "12rem", opacity: 0.7, marginBottom: "6rem" }}>
                        {t("ttNext", "next: {n}", { n: next || "—" })}
                    </div>
                    {/* ±1 / ±10, deliberately identical to the interval rows below — one mental model for the panel.
                        ±1 matters: staggering first departures a minute apart across lines that share a stop is a real
                        technique, and the old ±15 (then ±5) could not express it.
                        Why not an ±1h coarse step, given this is a clock? It would make crossing hours cheaper, but the
                        long moves it helps with barely happen: ScheduleMath.FirstDeparture already auto-clamps a
                        night-only line's first departure to the night window start (and a day-only line's into the
                        day), so the extremes are set for you. Real edits are 5-60 min — exactly ±10's range. */}
                    <div style={{ display: "flex", alignItems: "center", padding: "3rem 0" }}>
                        <div style={{ flex: 1, fontSize: "13rem" }}>{t("firstDeparture", "First departure")}</div>
                        {/* Margins, not `gap`: the game's cohtml UI has no flex gap. Coarse buttons sit slightly apart
                            from the fine pair so the two granularities read as groups. */}
                        <button style={{ ...stepBtnCoarse, marginRight: "5rem" }} onClick={() => trigger(G, "setSelTtFirst", wrapMin(first - 10))}>−10</button>
                        <button style={stepBtn} onClick={() => trigger(G, "setSelTtFirst", wrapMin(first - 1))}>−</button>
                        <div style={{ width: "54rem", textAlign: "center", fontSize: "13rem" }}>{hm(first)}</div>
                        <button style={stepBtn} onClick={() => trigger(G, "setSelTtFirst", wrapMin(first + 1))}>+</button>
                        <button style={{ ...stepBtnCoarse, marginLeft: "5rem" }} onClick={() => trigger(G, "setSelTtFirst", wrapMin(first + 10))}>+10</button>
                    </div>
                    {showDay ? <IntervalRow label={t("peakInterval", "Peak")} hours={peakHrs} value$={selTtPeak$} trig="setSelTtPeak" /> : null}
                    {showDay ? <IntervalRow label={t("offPeakInterval", "Off-peak")} hours={t("otherHours", "other hours")} value$={selTtOffPeak$} trig="setSelTtOffPeak" /> : null}
                    {showNight ? <IntervalRow label={t("nightInterval", "Night")} hours={nightHrs} value$={selTtNight$} trig="setSelTtNight" /> : null}
                    <div style={{ fontSize: "11rem", opacity: 0.45, marginTop: "4rem" }}>
                        {t("terminusHint", "Select a stop to see its departures and set it as this line's terminus.")}
                    </div>
                </>
            )}
        </div>
    );
};

// The stop departure board — every line's next departures from the selected stop.
const StopBoard = () => {
    const raw = useValue(selStopBoard$) as string;
    const lineNum = useValue(selStopLineNum$) as number;   // the line open on the left panel
    const lineServes = useValue(selStopLineServes$) as boolean; // ...and it's timetabled + serves this stop
    const t = useT();
    let board: Array<{ n: number; tt: boolean; term: boolean; d: string }> = [];
    try { board = JSON.parse(raw || "[]"); } catch { board = []; }
    const anyTimetabled = board.some((e) => e.tt);
    const termBtn = {
        cursor: "pointer", display: "block", width: "100%", padding: "7rem 12rem", borderRadius: "4rem",
        fontSize: "13rem", color: "white", pointerEvents: "auto", textAlign: "center",
    } as const;
    return (
        <div style={{ padding: "8rem 0 12rem" }}>
            {board.length === 0 ? (
                <div style={{ padding: "0 14rem", fontSize: "12rem", opacity: 0.5 }}>{t("noLines", "No lines serve this stop.")}</div>
            ) : (
                board.map((e, i) => (
                    <div key={i} style={{ padding: "5rem 14rem", borderTop: i > 0 ? "1rem solid rgba(255,255,255,0.08)" : undefined }}>
                        <div style={{ display: "flex", alignItems: "center", fontSize: "13rem", fontWeight: "bold" }}>
                            <div style={{ flex: 1 }}>{t("line", "Line {n}", { n: e.n })}</div>
                            {e.term ? <div style={{ fontSize: "11rem", color: "rgb(120, 210, 130)" }}>★ {t("terminusBadge", "terminus")}</div> : null}
                        </div>
                        <div style={{ fontSize: "12rem", color: e.tt ? "rgb(120, 210, 130)" : "rgba(255,255,255,0.45)" }}>
                            {e.tt ? (e.d ? t("departs", "departs: {d}", { d: e.d }) : t("noDepartures", "no departures scheduled")) : t("notTimetabled", "not timetabled")}
                        </div>
                    </div>
                ))
            )}
            {anyTimetabled && (
                <div style={{ padding: "10rem 14rem 2rem" }}>
                    {lineServes ? (
                        <button onClick={() => trigger(G, "setSelTerminusLine")} style={{ ...termBtn, background: "rgba(70, 110, 170, 0.95)" } as any}>
                            {t("setTerminusLine", "Set as terminus for Line {n}", { n: lineNum })}
                        </button>
                    ) : null}
                    <button
                        onClick={() => trigger(G, "setSelTerminusAll")}
                        style={{ ...termBtn, marginTop: lineServes ? "6rem" : "0", background: "rgba(90, 100, 115, 0.9)" } as any}
                    >
                        {t("setTerminusAll", "Set as terminus for all lines here")}
                    </button>
                    <div style={{ fontSize: "11rem", opacity: 0.45, marginTop: "4rem" }}>
                        {t("setTerminusHint", "The terminus anchors the schedule and the vehicle hold; buses retire here.")}
                    </div>
                </div>
            )}
        </div>
    );
};

export const TransitButton = () => {
    const t = useT();
    return <FloatingButton src={ICON} tooltipLabel={t("buttonTooltip", "Transit Timetables")} onSelect={() => setOpen(!_open)} />;
};

export const TransitPanelHost = () => {
    const open = useOpen();
    const stopHas = useValue(selStopHas$);
    const auto = useValue(autoOpen$) as number;
    const t = useT();

    // Auto-open when a new stop is selected (auto counter increments C#-side).
    const lastAuto = useRef<number>(auto);
    useEffect(() => {
        if (auto !== lastAuto.current) {
            lastAuto.current = auto;
            setOpen(true);
        }
    }, [auto]);

    // Close the panel when the selection stops being a stop — e.g. the player clicks a transport LINE — so the
    // empty "select a stop" hint doesn't linger over an unrelated panel (issue #3). Only the true->false transition
    // closes it, so a panel opened from the toolbar button while nothing is selected still shows its hint.
    const prevStopHas = useRef(stopHas);
    useEffect(() => {
        if (prevStopHas.current && !stopHas) setOpen(false);
        prevStopHas.current = stopHas;
    }, [stopHas]);

    if (!open) {
        // Closed but a stop is still selected: keep a slim reopen bar. Re-clicking the SAME stop can't reopen the
        // panel (the game fires no reselect event for an already-selected entity), so offer this affordance instead.
        if (!stopHas) return null;
        return (
            <div
                onClick={() => setOpen(true)}
                style={{
                    position: "fixed", top: "90rem", right: "56rem", zIndex: 99999, pointerEvents: "auto",
                    cursor: "pointer", background: "rgba(13, 21, 33, 0.97)", borderRadius: "6rem",
                    padding: "8rem 12rem", color: "white", fontSize: "var(--fontSizeM)", fontWeight: "bold",
                    textTransform: "uppercase", boxShadow: "0 4rem 24rem rgba(0,0,0,0.5)",
                } as any}
            >
                {t("panelTitle", "DEPARTURES")} ▸
            </div>
        );
    }
    return (
        <div
            style={{
                position: "fixed", top: "90rem", right: "56rem", width: "360rem", zIndex: 99999,
                pointerEvents: "auto", background: "rgba(13, 21, 33, 0.97)", borderRadius: "6rem",
                display: "flex", flexDirection: "column", color: "white",
                boxShadow: "0 4rem 24rem rgba(0,0,0,0.5)",
            }}
        >
            <div style={{ display: "flex", alignItems: "center", padding: "10rem 14rem", borderBottom: "1rem solid rgba(255,255,255,0.12)" }}>
                <div style={{ flex: 1, fontSize: "var(--fontSizeM)", fontWeight: "bold", textTransform: "uppercase", color: "var(--textColor)" } as any}>{t("panelTitle", "DEPARTURES")}</div>
                <CloseGlyph onClick={() => setOpen(false)} />
            </div>
            {stopHas ? (
                <StopBoard />
            ) : (
                <div style={{ padding: "12rem 14rem", fontSize: "12rem", opacity: 0.6 }}>
                    {t("panelHint", "Select a stop to see every line's departures from it. To edit a line's timetable, select the line — its controls are in the line's info panel.")}
                </div>
            )}
        </div>
    );
};
