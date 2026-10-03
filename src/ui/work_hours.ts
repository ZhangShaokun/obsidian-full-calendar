/**
 * Working hours, expressed as a set of time ranges per weekday, are rendered by
 * FullCalendar as background events.
 *
 * `businessHours` is not used here: it only colors the *non*-business part of
 * the day, while the plugin wants both working hours (darker) and the rest of
 * the day (lighter) to be tinted.
 */
import {
    eachDateInRange,
    minutesToClockTime,
    parseClockTime,
    weekdayFromISODate,
} from "./layout";

export interface TimeRange {
    start: string;
    end: string;
}

export interface MinuteRange {
    start: number;
    end: number;
}

export interface BackgroundEvent {
    id: string;
    start: string;
    end: string;
    allDay: false;
    display: "background";
    backgroundColor: string;
    classNames: string[];
    editable: boolean;
    startEditable: boolean;
    durationEditable: boolean;
}

export const WORK_HOURS_CLASS = "ofc-work-hours";
export const NON_WORK_HOURS_CLASS = "ofc-non-work-hours";
export const DEFAULT_WORK_ALPHA = 0.22;
export const DEFAULT_NON_WORK_ALPHA = 0.08;

/** Parse a range of "HH:mm" strings. Returns null when it isn't usable. */
export function parseTimeRange(range: TimeRange): MinuteRange | null {
    if (!range) {
        return null;
    }
    const start = parseClockTime(range.start);
    const end = parseClockTime(range.end);
    if (start === null || end === null || end <= start) {
        return null;
    }
    return { start, end };
}

/**
 * Drop unusable ranges, then sort and merge overlaps so that the ranges of a
 * day form a clean, non-overlapping list.
 */
export function normalizeRanges(ranges: TimeRange[]): MinuteRange[] {
    if (!ranges) {
        return [];
    }
    const parsed = ranges
        .map(parseTimeRange)
        .filter((r): r is MinuteRange => r !== null)
        .sort((a, b) => a.start - b.start);

    const merged: MinuteRange[] = [];
    for (const range of parsed) {
        const last = merged[merged.length - 1];
        if (last && range.start <= last.end) {
            last.end = Math.max(last.end, range.end);
        } else {
            merged.push({ ...range });
        }
    }
    return merged;
}

/** Intersect a range with [min, max], returning null if nothing is left. */
export function clipRange(
    range: MinuteRange,
    min: number,
    max: number
): MinuteRange | null {
    const start = Math.max(range.start, min);
    const end = Math.min(range.end, max);
    if (end <= start) {
        return null;
    }
    return { start, end };
}

/** The parts of [dayStart, dayEnd] that aren't covered by `ranges`. */
export function complementRanges(
    ranges: MinuteRange[],
    dayStart: number,
    dayEnd: number
): MinuteRange[] {
    const gaps: MinuteRange[] = [];
    let cursor = dayStart;
    for (const range of ranges) {
        if (range.start > cursor) {
            gaps.push({ start: cursor, end: Math.min(range.start, dayEnd) });
        }
        cursor = Math.max(cursor, range.end);
    }
    if (cursor < dayEnd) {
        gaps.push({ start: cursor, end: dayEnd });
    }
    return gaps.filter((gap) => gap.end > gap.start);
}

/** Turn "#abc" / "#aabbcc" into an rgba() string. Returns null if invalid. */
export function hexToRgba(hex: string, alpha: number): string | null {
    if (!hex) {
        return null;
    }
    const value = hex.trim().replace(/^#/, "");
    const full =
        value.length === 3
            ? value
                  .split("")
                  .map((c) => c + c)
                  .join("")
            : value;
    if (!/^[0-9a-fA-F]{6}$/.test(full)) {
        return null;
    }
    const r = parseInt(full.slice(0, 2), 16);
    const g = parseInt(full.slice(2, 4), 16);
    const b = parseInt(full.slice(4, 6), 16);
    const clampedAlpha = Math.max(0, Math.min(1, alpha));
    return `rgba(${r}, ${g}, ${b}, ${clampedAlpha})`;
}

/** 0 = Sunday based keys, matching Date.getDay(). */
export type WorkHoursByWeekday = {
    [weekday: number]: TimeRange[];
};

export function hasAnyWorkHours(workHours: WorkHoursByWeekday): boolean {
    return Object.values(workHours || {}).some(
        (ranges) => ranges && ranges.length > 0
    );
}

export interface BuildBackgroundEventsOptions {
    /** Visible range. startDate is inclusive, endDate exclusive. */
    startDate: Date;
    endDate: Date;
    workHours: WorkHoursByWeekday;
    /** Visible start of day, in minutes. */
    dayStartMin: number;
    /** Visible end of day, in minutes. */
    dayEndMin: number;
    workColor: string;
    nonWorkColor: string;
    workAlpha?: number;
    nonWorkAlpha?: number;
}

const toDateTimeString = (date: string, minutes: number): string =>
    `${date}T${minutesToClockTime(minutes)}:00`;

function backgroundEvent(
    date: string,
    range: MinuteRange,
    className: string,
    color: string,
    alpha: number
): BackgroundEvent {
    const fill = hexToRgba(color, alpha) || color;
    const suffix = className === WORK_HOURS_CLASS ? "work" : "nonwork";
    return {
        id: `ofc-${suffix}-${date}-${range.start}-${range.end}`,
        start: toDateTimeString(date, range.start),
        end: toDateTimeString(date, range.end),
        allDay: false,
        display: "background",
        backgroundColor: fill,
        classNames: [className],
        editable: false,
        startEditable: false,
        durationEditable: false,
    };
}

/**
 * Background events covering every visible day: one per working range and one
 * per remaining gap of the visible part of the day.
 */
export function buildBackgroundEvents({
    startDate,
    endDate,
    workHours,
    dayStartMin,
    dayEndMin,
    workColor,
    nonWorkColor,
    workAlpha = DEFAULT_WORK_ALPHA,
    nonWorkAlpha = DEFAULT_NON_WORK_ALPHA,
}: BuildBackgroundEventsOptions): BackgroundEvent[] {
    if (!hasAnyWorkHours(workHours) || dayEndMin <= dayStartMin) {
        return [];
    }

    const events: BackgroundEvent[] = [];
    for (const date of eachDateInRange(startDate, endDate)) {
        const weekday = weekdayFromISODate(date);
        if (weekday === null) {
            continue;
        }
        const ranges = normalizeRanges(workHours[weekday] || [])
            .map((range) => clipRange(range, dayStartMin, dayEndMin))
            .filter((range): range is MinuteRange => range !== null);

        for (const range of ranges) {
            events.push(
                backgroundEvent(
                    date,
                    range,
                    WORK_HOURS_CLASS,
                    workColor,
                    workAlpha
                )
            );
        }
        for (const gap of complementRanges(ranges, dayStartMin, dayEndMin)) {
            events.push(
                backgroundEvent(
                    date,
                    gap,
                    NON_WORK_HOURS_CLASS,
                    nonWorkColor,
                    nonWorkAlpha
                )
            );
        }
    }
    return events;
}
