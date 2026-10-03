/**
 * Pure layout math for tuning how FullCalendar renders the time grid views.
 *
 * FullCalendar v5 doesn't expose any option for the height of a row or of the
 * all-day area, so those values have to be computed here and applied either as
 * FullCalendar options or as CSS variables (see overrides.css).
 */

/** Latest time that can be configured in a day. */
export const MINUTES_IN_DAY = 24 * 60;

/**
 * Parse a "HH:mm" (or "H:mm") string into minutes since midnight.
 * "24:00" is allowed so that a day can be configured to end at midnight.
 */
export function parseClockTime(time: string): number | null {
    if (!time) {
        return null;
    }
    const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
    if (!match) {
        return null;
    }
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (minutes > 59) {
        return null;
    }
    const total = hours * 60 + minutes;
    if (total > MINUTES_IN_DAY) {
        return null;
    }
    return total;
}

/** Format minutes since midnight back into "HH:mm". */
export function minutesToClockTime(total: number): string {
    const clamped = Math.max(0, Math.min(MINUTES_IN_DAY, Math.round(total)));
    const hours = Math.floor(clamped / 60);
    const minutes = clamped % 60;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(
        2,
        "0"
    )}`;
}

/**
 * Restrict a value to a range. `min` wins if the range is inconsistent
 * (max < min) so that content is never clipped away entirely.
 */
export function clamp(value: number, min?: number, max?: number): number {
    let result = value;
    if (max !== undefined && max > 0) {
        result = Math.min(result, max);
    }
    if (min !== undefined) {
        result = Math.max(result, min);
    }
    return result;
}

/**
 * Number of slot rows between two times, given a slot duration in minutes.
 * Returns 0 for unparseable or inverted times.
 */
export function slotRowCount(
    startTime: string,
    endTime: string,
    slotMinutes = 30
): number {
    const start = parseClockTime(startTime);
    const end = parseClockTime(endTime);
    if (start === null || end === null || end <= start) {
        return 0;
    }
    if (!slotMinutes || slotMinutes <= 0) {
        return 0;
    }
    return Math.ceil((end - start) / slotMinutes);
}

/**
 * Whether every row can be displayed at its minimum height inside the space
 * that's available. When false, the time grid has to scroll.
 */
export function fitsWithoutScroll(
    availableHeight: number,
    rowCount: number,
    minRowHeight: number
): boolean {
    if (rowCount <= 0) {
        return true;
    }
    return rowCount * minRowHeight <= availableHeight;
}

export interface AllDayHeightOptions {
    /** How many all-day events the busiest visible day has. */
    eventCount: number;
    /** Height of a single all-day event row, in pixels. */
    rowHeight: number;
    /** Extra space taken up by the day cell around the event rows. */
    padding: number;
    /** Smallest height the all-day area is allowed to shrink to. */
    minHeight?: number;
    /** Height at which the all-day area stops growing and starts scrolling. */
    maxHeight?: number;
}

/**
 * Height the all-day area should take up: tall enough for the events that need
 * to be shown, but never smaller than the configured initial height and never
 * taller than the configured maximum.
 */
export function computeAllDayHeight({
    eventCount,
    rowHeight,
    padding,
    minHeight,
    maxHeight,
}: AllDayHeightOptions): number {
    const desired = Math.max(0, eventCount) * rowHeight + padding;
    return clamp(desired, minHeight, maxHeight);
}

/** 0 = Sunday, matching Date.getDay(). Returns null for unparseable dates. */
export function weekdayFromISODate(date: string): number | null {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    if (!match) {
        return null;
    }
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const parsed = new Date(year, month - 1, day);
    if (
        parsed.getFullYear() !== year ||
        parsed.getMonth() !== month - 1 ||
        parsed.getDate() !== day
    ) {
        return null;
    }
    return parsed.getDay();
}

/** All dates in [startDate, endDate), formatted as YYYY-MM-DD. */
export function eachDateInRange(startDate: Date, endDate: Date): string[] {
    const dates: string[] = [];
    const cursor = new Date(
        startDate.getFullYear(),
        startDate.getMonth(),
        startDate.getDate()
    );
    const last = new Date(
        endDate.getFullYear(),
        endDate.getMonth(),
        endDate.getDate()
    );
    if (cursor > last) {
        return dates;
    }
    while (cursor < last) {
        dates.push(
            `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(
                2,
                "0"
            )}-${String(cursor.getDate()).padStart(2, "0")}`
        );
        cursor.setDate(cursor.getDate() + 1);
    }
    return dates;
}
