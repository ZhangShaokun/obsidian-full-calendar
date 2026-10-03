import {
    clamp,
    computeAllDayHeight,
    eachDateInRange,
    fitsWithoutScroll,
    minutesToClockTime,
    parseClockTime,
    slotRowCount,
    weekdayFromISODate,
} from "./layout";

describe("parseClockTime", () => {
    it.each([
        ["06:00", 360],
        ["6:00", 360],
        ["13:30", 810],
        ["00:00", 0],
        ["24:00", 1440],
    ])("%p", (time: string, expected: number) => {
        expect(parseClockTime(time)).toBe(expected);
    });

    it.each(["", "6", "25:00", "12:60", "noon", "12:"])(
        "rejects %p",
        (time: string) => {
            expect(parseClockTime(time)).toBeNull();
        }
    );
});

describe("minutesToClockTime", () => {
    it.each([
        [360, "06:00"],
        [810, "13:30"],
        [1440, "24:00"],
        [0, "00:00"],
    ])("%p", (minutes: number, expected: string) => {
        expect(minutesToClockTime(minutes)).toBe(expected);
    });
});

describe("clamp", () => {
    it("applies both bounds", () => {
        expect(clamp(50, 10, 100)).toBe(50);
        expect(clamp(5, 10, 100)).toBe(10);
        expect(clamp(500, 10, 100)).toBe(100);
    });

    it("prefers the minimum when the range is inconsistent", () => {
        expect(clamp(50, 80, 20)).toBe(80);
    });

    it("ignores missing bounds", () => {
        expect(clamp(50)).toBe(50);
    });
});

describe("slotRowCount", () => {
    it("counts rows for the visible range", () => {
        expect(slotRowCount("06:00", "24:00")).toBe(36);
        expect(slotRowCount("06:00", "24:00", 60)).toBe(18);
        expect(slotRowCount("09:00", "17:00")).toBe(16);
    });

    it("returns 0 for invalid or inverted ranges", () => {
        expect(slotRowCount("24:00", "06:00")).toBe(0);
        expect(slotRowCount("nope", "24:00")).toBe(0);
        expect(slotRowCount("06:00", "24:00", 0)).toBe(0);
    });
});

describe("fitsWithoutScroll", () => {
    it("fits when every row gets at least its minimum height", () => {
        expect(fitsWithoutScroll(792, 36, 22)).toBe(true);
    });

    it("does not fit when the rows would be squeezed", () => {
        expect(fitsWithoutScroll(600, 36, 22)).toBe(false);
    });

    it("always fits with no rows", () => {
        expect(fitsWithoutScroll(0, 0, 22)).toBe(true);
    });
});

describe("computeAllDayHeight", () => {
    const options = {
        rowHeight: 22,
        padding: 8,
        minHeight: 36,
        maxHeight: 140,
    };

    it.each([
        [0, 36],
        [1, 36],
        [2, 52],
        [6, 140],
        [20, 140],
    ])("grows with the event count: %p", (eventCount: number, expected) => {
        expect(computeAllDayHeight({ ...options, eventCount })).toBe(expected);
    });

    it("grows without a maximum", () => {
        expect(
            computeAllDayHeight({
                eventCount: 10,
                rowHeight: 22,
                padding: 8,
                minHeight: 36,
            })
        ).toBe(228);
    });
});

describe("weekdayFromISODate", () => {
    it("returns 0 for Sunday", () => {
        expect(weekdayFromISODate("2026-10-04")).toBe(0);
    });

    it("returns 6 for Saturday", () => {
        expect(weekdayFromISODate("2026-10-03")).toBe(6);
    });

    it.each(["2026-10-32", "not-a-date", "2026-10"])(
        "rejects %p",
        (date: string) => {
            expect(weekdayFromISODate(date)).toBeNull();
        }
    );
});

describe("eachDateInRange", () => {
    it("excludes the end date", () => {
        expect(
            eachDateInRange(new Date(2026, 9, 1), new Date(2026, 9, 4))
        ).toEqual(["2026-10-01", "2026-10-02", "2026-10-03"]);
    });

    it("handles a single day", () => {
        expect(
            eachDateInRange(new Date(2026, 9, 1), new Date(2026, 9, 2))
        ).toEqual(["2026-10-01"]);
    });

    it("returns nothing for an inverted range", () => {
        expect(
            eachDateInRange(new Date(2026, 9, 4), new Date(2026, 9, 1))
        ).toEqual([]);
    });
});
