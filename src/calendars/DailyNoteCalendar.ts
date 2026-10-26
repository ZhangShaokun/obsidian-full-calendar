import moment from "moment";
import { TFile, CachedMetadata, ListItemCache, Loc, Pos } from "obsidian";
import {
    appHasDailyNotesPluginLoaded,
    createDailyNote,
    getAllDailyNotes,
    getDailyNote,
    getDailyNoteSettings,
    getDateFromFile,
} from "obsidian-daily-notes-interface";
import { EventPathLocation } from "../core/EventStore";
import { ObsidianInterface } from "../ObsidianAdapter";
import { OFCEvent, EventLocation, CalendarInfo, validateEvent } from "../types";
import { EventResponse } from "./Calendar";
import { EditableCalendar, EditableEventResponse } from "./EditableCalendar";

const DATE_FORMAT = "YYYY-MM-DD";

// PARSING

type Line = {
    text: string;
    lineNumber: number;
};

const parseBool = (s: string): boolean | string =>
    s === "true" ? true : s === "false" ? false : s;

const fieldRegex = /\[([^\]]+):: ?([^\]]+)\]/g;
export function getInlineAttributes(
    s: string
): Record<string, string | boolean> {
    return Object.fromEntries(
        Array.from(s.matchAll(fieldRegex)).map((m) => [m[1], parseBool(m[2])])
    );
}

const getHeadingPosition = (
    headingText: string,
    metadata: CachedMetadata,
    endOfDoc: Loc
): Pos | null => {
    if (!metadata.headings) {
        return null;
    }

    let level: number | null = null;
    let startingPos: Pos | null = null;
    let endingPos: Pos | null = null;

    for (const heading of metadata.headings) {
        if (!level && heading.heading === headingText) {
            level = heading.level;
            startingPos = heading.position;
        } else if (level && heading.level <= level) {
            endingPos = heading.position;
            break;
        }
    }

    if (!level || !startingPos) {
        return null;
    }

    return { start: startingPos.end, end: endingPos?.start || endOfDoc };
};

const getListsUnderHeading = (
    headingText: string,
    metadata: CachedMetadata
): ListItemCache[] => {
    if (!metadata.listItems) {
        return [];
    }
    const endOfDoc = metadata.sections?.last()?.position.end;
    if (!endOfDoc) {
        return [];
    }
    const headingPos = getHeadingPosition(headingText, metadata, endOfDoc);
    if (!headingPos) {
        return [];
    }
    return metadata.listItems?.filter(
        (l) =>
            headingPos.start.offset < l.position.start.offset &&
            l.position.end.offset <= headingPos.end.offset
    );
};

const listRegex = /^(\s*)\-\s+(\[(.)\]\s+)?/;
const checkboxRegex = /^\s*\-\s+\[(.)\]\s+/;
const checkboxTodo = (s: string) => {
    const match = s.match(checkboxRegex);
    if (!match || !match[1]) {
        return null;
    }
    return match[1] === " " ? false : match[1];
};

const getInlineEventFromLine = (
    text: string,
    globalAttrs: Partial<OFCEvent>
): OFCEvent | null => {
    const attrs = getInlineAttributes(text);

    // Shortcut validation if there are no inline attributes.
    if (Object.keys(attrs).length === 0) {
        return null;
    }

    return validateEvent({
        title: text.replace(listRegex, "").replace(fieldRegex, "").trim(),
        completed: checkboxTodo(text),
        ...globalAttrs,
        ...attrs,
    });
};

function getAllInlineEventsFromFile(
    fileText: string,
    listItems: ListItemCache[],
    fileGlobalAttrs: Partial<OFCEvent>
): { lineNumber: number; event: OFCEvent }[] {
    const lines = fileText.split("\n");
    const listItemText: Line[] = listItems
        .map((i) => i.position.start.line)
        .map((idx) => ({ lineNumber: idx, text: lines[idx] }));

    return listItemText
        .map((l) => ({
            lineNumber: l.lineNumber,
            event: getInlineEventFromLine(l.text, {
                ...fileGlobalAttrs,
                type: "single",
            }),
        }))
        .flatMap(({ event, lineNumber }) =>
            event ? [{ event, lineNumber }] : []
        );
}

// SERIALIZATION

const generateInlineAttributes = (attrs: Record<string, any>): string => {
    return Object.entries(attrs)
        .map(([k, v]) => `[${k}:: ${v}]`)
        .join("  ");
};

const makeListItem = (
    data: OFCEvent,
    whitespacePrefix: string = ""
): string => {
    if (data.type !== "single") {
        throw new Error("Can only pass in single event.");
    }
    const { completed, title } = data;
    const checkbox = (() => {
        if (completed !== null && completed !== undefined) {
            return `[${completed ? "x" : " "}]`;
        }
        return null;
    })();

    const attrs: Partial<OFCEvent> = { ...data };
    delete attrs["completed"];
    delete attrs["title"];
    delete attrs["type"];
    delete attrs["date"];

    for (const key of <(keyof OFCEvent)[]>Object.keys(attrs)) {
        if (attrs[key] === undefined || attrs[key] === null) {
            delete attrs[key];
        }
    }

    if (!attrs["allDay"]) {
        delete attrs["allDay"];
    }

    return `${whitespacePrefix}- ${
        checkbox || ""
    } ${title} ${generateInlineAttributes(attrs)}`;
};

const modifyListItem = (line: string, data: OFCEvent): string | null => {
    const listMatch = line.match(listRegex);
    if (!listMatch) {
        console.warn(
            "Tried modifying a list item with a position that wasn't a list item",
            { line }
        );
        return null;
    }

    return makeListItem(data, listMatch[1]);
};

const isBlank = (line: string | undefined): boolean =>
    line !== undefined && line.trim() === "";

/**
 * Message shown when the item a cached event points at can no longer be
 * identified in the note. We refuse to guess, because guessing means writing
 * over somebody else's task.
 */
const STALE_LOCATION_ERROR =
    "The daily note changed since the event was loaded; reopen the calendar.";

const headingLineRegex = /^(#{1,6})\s+(.+)$/;

const headingLevelOf = (line: string | undefined): number | null => {
    const match = line?.match(headingLineRegex);
    return match ? match[1].length : null;
};

const headingTextOf = (line: string | undefined): string | null => {
    const match = line?.match(headingLineRegex);
    if (!match) {
        return null;
    }
    // Strip the optional closing hashes of an ATX heading.
    return match[2]
        .trim()
        .replace(/\s*#+$/, "")
        .trim();
};

const isListItem = (line: string | undefined): boolean =>
    line !== undefined && listRegex.test(line);

/**
 * Title of a list item, ignoring the bullet, checkbox and inline attributes.
 */
const titleFromListItem = (line: string): string =>
    line.replace(listRegex, "").replace(fieldRegex, "").trim();

/**
 * Find the first heading in the document whose text matches exactly.
 */
const findHeadingLine = (
    lines: string[],
    headingText: string
): number | null => {
    for (let i = 0; i < lines.length; i++) {
        if (headingTextOf(lines[i]) === headingText) {
            return i;
        }
    }
    return null;
};

/**
 * Line range of the body of a heading: everything between the heading itself
 * and the next heading of the same or a higher level.
 */
const getHeadingSectionRange = (
    lines: string[],
    headingLine: number
): { start: number; end: number } => {
    const level = headingLevelOf(lines[headingLine]) ?? 6;
    let end = lines.length;
    for (let i = headingLine + 1; i < lines.length; i++) {
        const nextLevel = headingLevelOf(lines[i]);
        if (nextLevel !== null && nextLevel <= level) {
            end = i;
            break;
        }
    }
    return { start: headingLine + 1, end };
};

/**
 * Figure out which line of the note an event lives on right now.
 *
 * The line number cached alongside an event goes stale whenever another event
 * in the same note is added or removed, so it is only trusted when it can be
 * confirmed against the item that is expected there. Otherwise the item is
 * looked up by title, then by elimination when the heading only holds a single
 * item. If none of that identifies exactly one line, `null` is returned and the
 * caller errors out instead of writing to a line that may belong to another
 * task.
 */
const resolveItemLine = (
    lines: string[],
    headingLine: number,
    cachedLineNumber: number,
    expectedTitle?: string
): number | null => {
    const { start, end } = getHeadingSectionRange(lines, headingLine);
    const itemLines: number[] = [];
    for (let i = start; i < end; i++) {
        if (isListItem(lines[i])) {
            itemLines.push(i);
        }
    }

    if (itemLines.length === 0) {
        return null;
    }

    if (expectedTitle !== undefined && expectedTitle !== "") {
        const matches = itemLines.filter(
            (i) => titleFromListItem(lines[i]) === expectedTitle
        );
        if (matches.length > 0) {
            return matches.includes(cachedLineNumber)
                ? cachedLineNumber
                : matches[0];
        }
        // Nothing under the heading carries the expected title: fall through and
        // only accept an unambiguous answer.
    }

    if (itemLines.length === 1) {
        return itemLines[0];
    }

    if (itemLines.includes(cachedLineNumber) && expectedTitle === undefined) {
        return cachedLineNumber;
    }

    return null;
};

/**
 * Enforce the layout of a daily note:
 * - runs of blank lines collapse into a single blank line,
 * - every heading is surrounded by exactly one blank line,
 * - the file keeps its single trailing newline.
 *
 * Idempotent: running it twice yields the same document.
 */
export function normalizeHeadingSpacing(lines: string[]): string[] {
    const endsWithNewline =
        lines.length > 0 && isBlank(lines[lines.length - 1]);
    const body = endsWithNewline ? lines.slice(0, -1) : lines;

    const result: string[] = [];
    for (const line of body) {
        if (isBlank(line)) {
            // Drop leading blank lines and collapse consecutive ones.
            if (result.length > 0 && !isBlank(result[result.length - 1])) {
                result.push("");
            }
            continue;
        }
        if (headingLevelOf(line) !== null) {
            if (result.length > 0 && !isBlank(result[result.length - 1])) {
                result.push("");
            }
            result.push(line, "");
            continue;
        }
        result.push(line);
    }

    while (result.length > 0 && isBlank(result[result.length - 1])) {
        result.pop();
    }
    if (endsWithNewline) {
        result.push("");
    }
    return result;
}

/**
 * Collapsing blank lines can eat the final newline of a document; put it back so
 * writes stay minimal diffs.
 */
const preserveTrailingNewline = (
    lines: string[],
    endsWithNewline: boolean
): string[] => {
    if (endsWithNewline && !isBlank(lines[lines.length - 1])) {
        lines.push("");
    }
    return lines;
};

/**
 * Splice lines into place, keeping exactly one blank line between the new
 * content and whatever came before it. Returns the line number of the first
 * inserted line.
 */
const insertWithBlankLine = (
    lines: string[],
    index: number,
    newLines: string[]
): number => {
    if (index > 0 && !isBlank(lines[index - 1])) {
        lines.splice(index, 0, "", ...newLines);
        return index + 1;
    }
    lines.splice(index, 0, ...newLines);
    return index;
};

/**
 * Append a heading to the end of the document, separated from existing content
 * by a blank line.
 */
const appendHeading = (lines: string[], headingText: string): number =>
    insertWithBlankLine(lines, lines.length, [`## ${headingText}`]);

/**
 * Insert a list item at the top of the list under a heading. The heading and its
 * first item are always separated by a single blank line.
 */
const insertItemUnderHeading = (
    lines: string[],
    headingLine: number,
    listItem: string
): number => {
    let blankLinesUnderHeading = 0;
    while (isBlank(lines[headingLine + 1 + blankLinesUnderHeading])) {
        blankLinesUnderHeading += 1;
    }
    if (blankLinesUnderHeading > 1) {
        lines.splice(headingLine + 1, blankLinesUnderHeading - 1);
    }

    const index = headingLine + 1 + Math.min(blankLinesUnderHeading, 1);
    return insertWithBlankLine(lines, index, [listItem]);
};

type AddToHeadingProps = {
    headingLine: number | undefined;
    item: OFCEvent;
    headingText: string;
};

/**
 * Add a list item to a given heading.
 * If the heading does not exist in the note, it is appended to the end of the
 * file first. The heading's line number is only used as a hint: it is verified
 * against the heading text so that a stale number can never insert the item
 * into the wrong section.
 */
const addToHeading = (
    page: string,
    { headingLine, item, headingText }: AddToHeadingProps
): { page: string; lineNumber: number } => {
    const endsWithNewline = page.endsWith("\n");
    const lines = page.split("\n");
    const listItem = makeListItem(item);

    let heading =
        headingLine !== undefined &&
        headingTextOf(lines[headingLine]) === headingText
            ? headingLine
            : findHeadingLine(lines, headingText);

    if (heading === null) {
        heading = appendHeading(lines, headingText);
    }

    insertItemUnderHeading(lines, heading, listItem);

    const normalized = normalizeHeadingSpacing(
        preserveTrailingNewline(lines, endsWithNewline)
    );
    const newHeadingLine = findHeadingLine(normalized, headingText);
    if (newHeadingLine === null) {
        throw new Error(
            `Could not find heading "${headingText}" after inserting an event.`
        );
    }

    // New items are the first entry under their heading, which normalization
    // always separates from the heading by exactly one blank line.
    return { page: normalized.join("\n"), lineNumber: newHeadingLine + 2 };
};

export default class DailyNoteCalendar extends EditableCalendar {
    app: ObsidianInterface;
    heading: string;

    constructor(app: ObsidianInterface, color: string, heading: string) {
        super(color);
        appHasDailyNotesPluginLoaded();
        this.app = app;
        this.heading = heading;
    }

    get type(): CalendarInfo["type"] {
        return "dailynote";
    }
    get identifier(): string {
        return this.heading;
    }
    get name(): string {
        return `${this.heading} in daily note`;
    }
    get directory(): string {
        const { folder } = getDailyNoteSettings();
        if (!folder) {
            throw new Error("Could not load daily note settings.");
        }
        return folder;
    }

    async getEventsInFile(file: TFile): Promise<EditableEventResponse[]> {
        // @ts-ignore
        const date = getDateFromFile(file, "day")?.format(DATE_FORMAT);
        if (!date) {
            return [];
        }
        const cache = this.app.getMetadata(file);
        if (!cache) {
            return [];
        }
        const listItems = getListsUnderHeading(this.heading, cache);
        const inlineEvents = await this.app.process(file, (text) =>
            getAllInlineEventsFromFile(text, listItems, { date })
        );
        return inlineEvents.map(({ event, lineNumber }) => [
            event,
            { file, lineNumber },
        ]);
    }

    async getEvents(): Promise<EventResponse[]> {
        const notes = getAllDailyNotes();
        const files = Object.values(notes) as TFile[];
        return (
            await Promise.all(files.map((f) => this.getEventsInFile(f)))
        ).flat();
    }

    async createEvent(event: OFCEvent): Promise<EventLocation> {
        if (event.type !== "single" && event.type !== undefined) {
            console.debug(
                "tried creating a recurring event in a daily note",
                event
            );
            throw new Error("Cannot create a recurring event in a daily note.");
        }
        const m = moment(event.date);
        let file = getDailyNote(m, getAllDailyNotes()) as TFile;
        if (!file) {
            file = (await createDailyNote(m)) as TFile;
        }
        const metadata = await this.app.waitForMetadata(file);

        // If the heading isn't in the note yet, addToHeading() appends it
        // (along with the event) to the end of the file.
        const headingInfo = metadata.headings?.find(
            (h) => h.heading == this.heading
        );
        let lineNumber = await this.app.rewrite(file, (contents) => {
            const { page, lineNumber } = addToHeading(contents, {
                headingLine: headingInfo?.position.start.line,
                item: event,
                headingText: this.heading,
            });
            return [page, lineNumber] as [string, number];
        });
        return { file, lineNumber };
    }

    private getConcreteLocation({ path, lineNumber }: EventPathLocation): {
        file: TFile;
        lineNumber: number;
    } {
        const file = this.app.getFileByPath(path);
        if (!file) {
            throw new Error(`File not found at path: ${path}`);
        }
        if (!lineNumber) {
            throw new Error(`Daily note events must have a line number.`);
        }
        return { file, lineNumber };
    }

    /**
     * Find the line of the note that currently holds an item of this calendar.
     *
     * Line numbers stored with an event go stale as soon as another item in the
     * same note is added or removed, so the cached number is only a hint.
     * Throws instead of guessing when the item cannot be identified, so that a
     * stale cache can never make us overwrite a different task.
     */
    private locateItemLine(
        lines: string[],
        file: TFile,
        cachedLineNumber: number,
        expectedTitle?: string
    ): number {
        const headingLine = findHeadingLine(lines, this.heading);
        if (headingLine === null) {
            throw new Error(
                `Could not find heading "${this.heading}" in ${file.path}.`
            );
        }
        const itemLine = resolveItemLine(
            lines,
            headingLine,
            cachedLineNumber,
            expectedTitle
        );
        if (itemLine === null) {
            throw new Error(STALE_LOCATION_ERROR);
        }
        if (itemLine !== cachedLineNumber) {
            console.warn(
                `Daily note line number ${cachedLineNumber} was stale for heading "${this.heading}"; using line ${itemLine} instead.`
            );
        }
        return itemLine;
    }

    async deleteEvent(
        loc: EventPathLocation,
        previousEvent?: OFCEvent
    ): Promise<void> {
        const { file, lineNumber } = this.getConcreteLocation(loc);
        await this.app.rewrite(file, (contents) => {
            const lines = contents.split("\n");
            const itemLine = this.locateItemLine(
                lines,
                file,
                lineNumber,
                previousEvent?.title
            );
            lines.splice(itemLine, 1);
            return normalizeHeadingSpacing(lines).join("\n");
        });
    }

    async modifyEvent(
        loc: EventPathLocation,
        newEvent: OFCEvent,
        updateCacheWithLocation: (loc: EventLocation) => void,
        previousEvent?: OFCEvent
    ): Promise<void> {
        console.debug("modified daily note event");
        if (newEvent.type !== "single" && newEvent.type !== undefined) {
            throw new Error(
                "Recurring events in daily notes are not supported."
            );
        }
        if (newEvent.endDate) {
            throw new Error(
                "Multi-day events are not supported in daily notes."
            );
        }
        const { file, lineNumber } = this.getConcreteLocation(loc);
        const oldDate = getDateFromFile(file as any, "day")?.format(
            DATE_FORMAT
        );
        if (!oldDate) {
            throw new Error(
                `Could not get date from file at path ${file.path}`
            );
        }
        // The cached line number may point at a different item; the title the
        // event had on disk is what identifies it.
        const expectedTitle = previousEvent?.title ?? newEvent.title;
        if (newEvent.date !== oldDate) {
            // Event needs to be moved to a new file.
            console.debug("daily note event moving to a new file.");
            // TODO: Factor this out with the createFile path.
            const m = moment(newEvent.date);
            let newFile = getDailyNote(m, getAllDailyNotes()) as TFile;
            if (!newFile) {
                newFile = (await createDailyNote(m)) as TFile;
            }
            await this.app.read(newFile);

            const metadata = await this.app.waitForMetadata(newFile);
            // If the heading isn't in the target note yet, addToHeading()
            // appends it along with the event.
            const headingInfo = metadata.headings?.find(
                (h) => h.heading == this.heading
            );

            await this.app.rewrite(file, async (oldFileContents) => {
                // Open the old file and remove the event.
                let lines = oldFileContents.split("\n");
                const itemLine = this.locateItemLine(
                    lines,
                    file,
                    lineNumber,
                    expectedTitle
                );
                lines.splice(itemLine, 1);
                await this.app.rewrite(newFile, (newFileContents) => {
                    // Before writing that change back to disk, open the new file and add the event.
                    const { page, lineNumber } = addToHeading(newFileContents, {
                        headingLine: headingInfo?.position.start.line,
                        item: newEvent,
                        headingText: this.heading,
                    });
                    // Before any file changes are committed, call the updateCacheWithLocation callback to ensure
                    // the cache is properly updated with the new location.
                    updateCacheWithLocation({ file: newFile, lineNumber });
                    return page;
                });
                return normalizeHeadingSpacing(lines).join("\n");
            });
        } else {
            console.debug("daily note event staying in same file.");
            await this.app.rewrite(file, (contents) => {
                const lines = contents.split("\n");
                const itemLine = this.locateItemLine(
                    lines,
                    file,
                    lineNumber,
                    expectedTitle
                );
                const newLine = modifyListItem(lines[itemLine], newEvent);
                if (!newLine) {
                    throw new Error("Did not successfully update line.");
                }
                lines[itemLine] = newLine;
                // Call the callback before returning so that the cache holds the
                // refreshed location before the file is written.
                updateCacheWithLocation({ file, lineNumber: itemLine });
                return normalizeHeadingSpacing(lines).join("\n");
            });
        }
    }

    /**
     * Move an event from this calendar's heading to another heading of the same
     * daily note, keeping the item verbatim (formatting, checkbox state and
     * inline attributes) so nothing but its section changes.
     */
    async move(
        from: EventPathLocation,
        to: EditableCalendar,
        updateCacheWithLocation: (loc: EventLocation) => void,
        previousEvent?: OFCEvent
    ): Promise<void> {
        if (!(to instanceof DailyNoteCalendar)) {
            throw new Error(
                `Events from a daily note can only be moved to another heading of a daily note, not to a calendar of type ${to.type}.`
            );
        }
        const { file, lineNumber } = this.getConcreteLocation(from);

        if (to.heading === this.heading) {
            // Already under this heading; nothing to write.
            updateCacheWithLocation({ file, lineNumber });
            return;
        }

        const targetHeading = to.heading;
        await this.app.rewrite(file, (contents) => {
            const endsWithNewline = contents.endsWith("\n");
            const lines = contents.split("\n");
            const itemLine = this.locateItemLine(
                lines,
                file,
                lineNumber,
                previousEvent?.title
            );

            // Take the raw line so the item keeps its exact formatting.
            const [item] = lines.splice(itemLine, 1);

            let targetHeadingLine = findHeadingLine(lines, targetHeading);
            if (targetHeadingLine === null) {
                targetHeadingLine = appendHeading(lines, targetHeading);
            }
            insertItemUnderHeading(lines, targetHeadingLine, item);

            const normalized = normalizeHeadingSpacing(
                preserveTrailingNewline(lines, endsWithNewline)
            );
            const newHeadingLine = findHeadingLine(normalized, targetHeading);
            if (newHeadingLine === null) {
                throw new Error(
                    `Could not find heading "${targetHeading}" after moving the event.`
                );
            }

            // The moved item is the first entry under its new heading.
            updateCacheWithLocation({
                file,
                lineNumber: newHeadingLine + 2,
            });
            return normalized.join("\n");
        });
    }
}
