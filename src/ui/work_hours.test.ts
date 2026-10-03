import {
    buildBackgroundEvents,
    complementRanges,
    hasAnyWorkHours,
    hexToRgba,
    NON_WORK_HOURS_CLASS,
    normalizeRanges,
    parseTimeRange,
    WORK_HOURS_CLASS,
} from "./work_hours";

describe("parseTimeRange", () => {
    it("parses a valid range", () => {
        expect(parseTimeRange({ start: "08:00", end: "12:00" })).toEqual({
            start: 480,
            end: 720,
        });
    });

    it.each([
        { start: "12:00", end: "08:00" },
        { start: "08:00", end: "08:00" },
        { start: "nope", end: "12:00" },
        { start: "08:00", end: "25:00" },
    ])("rejects %p", (range) => {
        expect(parseTimeRange(range)).toBeNull();
    });
});

describe("normalizeRanges", () => {
    it("sorts ranges", () => {
        expect(
            normalizeRanges([
                { start: "19:00", end: "21:00" },
                { start: "08:00", end: "12:00" },
            ])
        ).toEqual([
            { start: 480, end: 720 },
            { start: 1140, end: 1260 },
        ]);
    });

    it("merges overlapping ranges", () => {
        expect(
            normalizeRanges([
                { start: "08:00", end: "12:00" },
                { start: "11:00", end: "13:00" },
            ])
        ).toEqual([{ start: 480, end: 780 }]);
    });

    it("merges adjacent ranges", () => {
        expect(
            normalizeRanges([
                { start: "08:00", end: "12:00" },
                { start: "12:00", end: "13:00" },
            ])
        ).toEqual([{ start: 480, end: 780 }]);
    });

    it("drops invalid ranges", () => {
        expect(
            normalizeRanges([
                { start: "08:00", end: "12:00" },
                { start: "14:00", end: "13:00" },
            ])
        ).toEqual([{ start: 480, end: 720 }]);
    });
});

describe("complementRanges", () => {
    it("fills the gaps between ranges", () => {
        const ranges = normalizeRanges([
            { start: "08:00", end: "12:00" },
            { start: "13:30", end: "17:30" },
        ]);
        expect(complementRanges(ranges, 360, 1440)).toEqual([
            { start: 360, end: 480 },
            { start: 720, end: 810 },
            { start: 1050, end: 1440 },
        ]);
    });

    it("returns the whole range when there is nothing", () => {
        expect(complementRanges([], 360, 1440)).toEqual([
            { start: 360, end: 1440 },
        ]);
    });

    it("returns nothing when the range is fully covered", () => {
        const ranges = normalizeRanges([{ start: "06:00", end: "24:00" }]);
        expect(complementRanges(ranges, 360, 1440)).toEqual([]);
    });
});

describe("hexToRgba", () => {
    it.each([
        ["#ffffff", 0.5, "rgba(255, 255, 255, 0.5)"],
        ["#000000", 1, "rgba(0, 0, 0, 1)"],
        ["#fff", 0.2, "rgba(255, 255, 255, 0.2)"],
    ])("%p", (hex: string, alpha: number, expected: string) => {
        expect(hexToRgba(hex, alpha)).toBe(expected);
    });

    it.each(["", "#ff", "nonsense"])("rejects %p", (hex: string) => {
        expect(hexToRgba(hex, 0.5)).toBeNull();
    });
});

describe("hasAnyWorkHours", () => {
    it("detects configured ranges", () => {
        expect(hasAnyWorkHours({ 1: [{ start: "08:00", end: "12:00" }] })).toBe(
            true
        );
    });

    it("is false for empty configurations", () => {
        expect(hasAnyWorkHours({ 1: [], 2: [] })).toBe(false);
        expect(hasAnyWorkHours({})).toBe(false);
    });
});

describe("buildBackgroundEvents", () => {
    const base = {
        workHours: {
            // 2026-10-05 is a Monday.
            1: [
                { start: "08:00", end: "12:00" },
                { start: "13:30", end: "17:30" },
                { start: "19:00", end: "21:00" },
            ],
        },
        dayStartMin: 360,
        dayEndMin: 1440,
        workColor: "#123456",
        nonWorkColor: "#abcdef",
    };

    it("returns nothing when no working hours are configured", () => {
        expect(
            buildBackgroundEvents({
                ...base,
                workHours: {},
                startDate: new Date(2026, 9, 5),
                endDate: new Date(2026, 9, 6),
            })
        ).toEqual([]);
    });

    it("tints the whole day when a weekday has no ranges", () => {
        const events = buildBackgroundEvents({
            ...base,
            startDate: new Date(2026, 9, 4), // Sunday
            endDate: new Date(2026, 9, 5),
        });
        expect(
            events.filter((e) => e.classNames.includes(WORK_HOURS_CLASS))
        ).toEqual([]);
        expect(
            events
                .filter((e) => e.classNames.includes(NON_WORK_HOURS_CLASS))
                .map((e) => [e.start, e.end])
        ).toEqual([["2026-10-04T06:00:00", "2026-10-04T24:00:00"]]);
    });

    it("creates work and non-work blocks covering the visible day", () => {
        const events = buildBackgroundEvents({
            ...base,
            startDate: new Date(2026, 9, 5), // Monday
            endDate: new Date(2026, 9, 6),
        });

        const work = events.filter((e) =>
            e.classNames.includes(WORK_HOURS_CLASS)
        );
        const nonWork = events.filter((e) =>
            e.classNames.includes(NON_WORK_HOURS_CLASS)
        );

        expect(work.map((e) => [e.start, e.end])).toEqual([
            ["2026-10-05T08:00:00", "2026-10-05T12:00:00"],
            ["2026-10-05T13:30:00", "2026-10-05T17:30:00"],
            ["2026-10-05T19:00:00", "2026-10-05T21:00:00"],
        ]);
        expect(nonWork.map((e) => [e.start, e.end])).toEqual([
            ["2026-10-05T06:00:00", "2026-10-05T08:00:00"],
            ["2026-10-05T12:00:00", "2026-10-05T13:30:00"],
            ["2026-10-05T17:30:00", "2026-10-05T19:00:00"],
            ["2026-10-05T21:00:00", "2026-10-05T24:00:00"],
        ]);

        for (const event of events) {
            expect(event.display).toBe("background");
            expect(event.editable).toBe(false);
        }
        expect(work[0].backgroundColor).toBe("rgba(18, 52, 86, 0.22)");
        expect(nonWork[0].backgroundColor).toBe("rgba(171, 205, 239, 0.08)");
    });

    it("clips ranges to the visible part of the day", () => {
        const events = buildBackgroundEvents({
            ...base,
            workHours: { 1: [{ start: "00:00", end: "09:00" }] },
            dayStartMin: 360,
            dayEndMin: 720,
            startDate: new Date(2026, 9, 5),
            endDate: new Date(2026, 9, 6),
        });

        const work = events.filter((e) =>
            e.classNames.includes(WORK_HOURS_CLASS)
        );
        expect(work.map((e) => [e.start, e.end])).toEqual([
            ["2026-10-05T06:00:00", "2026-10-05T09:00:00"],
        ]);
    });
});
