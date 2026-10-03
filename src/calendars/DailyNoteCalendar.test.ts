import { CachedMetadata, TFile, TFolder } from "obsidian";
import { ObsidianInterface } from "../ObsidianAdapter";
import { OFCEvent } from "../types";
import DailyNoteCalendar, { getInlineAttributes } from "./DailyNoteCalendar";

// The daily note that the daily-notes interface hands back. Set per test.
let dailyNote: TFile | null = null;

jest.mock("obsidian-daily-notes-interface", () => ({
    appHasDailyNotesPluginLoaded: () => true,
    getDailyNoteSettings: () => ({
        folder: "daily",
        format: "YYYY-MM-DD",
        template: "",
    }),
    getAllDailyNotes: () => ({}),
    getDailyNote: () => dailyNote,
    createDailyNote: jest.fn(),
    getDateFromFile: () => null,
}));

const app = {} as ObsidianInterface;

it.each([
    ["one variable [hello:: world]", { hello: "world" }],
    ["[first:: a] message [second:: b]", { first: "a", second: "b" }],
    [
        "this is a long string with [some brackets] but no actual:: inline fields",
        {},
    ],
])("%p", (line: string, obj: any) => {
    expect(getInlineAttributes(line)).toEqual(obj);
});

describe("calendar identity", () => {
    it("creates one calendar per heading, each with its own color", () => {
        const tasksCalendar = new DailyNoteCalendar(app, "#ff0000", "Tasks");
        const eventsCalendar = new DailyNoteCalendar(app, "#0000ff", "Events");

        expect(tasksCalendar.type).toBe("dailynote");
        expect(tasksCalendar.id).toBe("dailynote::Tasks");
        expect(eventsCalendar.id).toBe("dailynote::Events");
        expect(tasksCalendar.id).not.toEqual(eventsCalendar.id);

        expect(tasksCalendar.color).toBe("#ff0000");
        expect(eventsCalendar.color).toBe("#0000ff");

        expect(tasksCalendar.name).toBe('Daily note under "Tasks"');
        expect(eventsCalendar.name).toBe('Daily note under "Events"');
    });
});

const linePosition = (line: number) => ({
    start: { line, col: 0, offset: 0 },
    end: { line, col: 0, offset: 0 },
});

function makeFakeApp(
    initialContents: string,
    metadata: Partial<CachedMetadata>
) {
    let contents = initialContents;

    const folder = new TFolder();
    folder.name = "daily";
    const file = new TFile();
    file.name = "2026-10-03.md";
    file.parent = folder;

    const fakeApp = {
        waitForMetadata: jest.fn(async () => metadata as CachedMetadata),
        getMetadata: jest.fn(() => metadata as CachedMetadata),
        rewrite: jest.fn(async (_file: TFile, rewriteFunc: any) => {
            const result = rewriteFunc(contents);
            if (Array.isArray(result)) {
                contents = result[0];
                return result[1];
            }
            contents = result;
        }),
    } as unknown as ObsidianInterface;

    return { fakeApp, file, read: () => contents };
}

const timedEvent: OFCEvent = {
    type: "single",
    title: "写周报",
    date: "2026-10-03",
    endDate: null,
    allDay: false,
    startTime: "14:00",
    endTime: "15:00",
    completed: null,
} as OFCEvent;

describe("createEvent", () => {
    beforeEach(() => {
        dailyNote = null;
    });

    it("appends the heading when the daily note doesn't have it", async () => {
        const { fakeApp, file, read } = makeFakeApp("# 2026-10-03\n", {});
        dailyNote = file;

        const calendar = new DailyNoteCalendar(fakeApp, "red", "待办");
        const location = await calendar.createEvent(timedEvent);

        expect(location.file).toBe(file);
        expect(location.lineNumber).toBe(4);
        expect(read().split("\n")).toEqual([
            "# 2026-10-03",
            "",
            "## 待办",
            "",
            expect.stringContaining("写周报"),
        ]);
    });

    it("writes the event title and times to the daily note", async () => {
        const { fakeApp, file, read } = makeFakeApp("# 2026-10-03\n", {});
        dailyNote = file;

        const calendar = new DailyNoteCalendar(fakeApp, "red", "待办");
        await calendar.createEvent(timedEvent);

        const itemLine = read()
            .split("\n")
            .find((line) => line.trim().startsWith("- "));
        expect(itemLine).toBeDefined();
        expect(itemLine).toContain("写周报");
        expect(itemLine).toContain("[startTime:: 14:00]");
        expect(itemLine).toContain("[endTime:: 15:00]");
    });

    it("adds to an existing heading without duplicating it", async () => {
        const { fakeApp, file, read } = makeFakeApp(
            "# 2026-10-03\n\n## 待办\n\n",
            {
                headings: [
                    { heading: "待办", level: 2, position: linePosition(2) },
                ],
            }
        );
        dailyNote = file;

        const calendar = new DailyNoteCalendar(fakeApp, "red", "待办");
        const location = await calendar.createEvent(timedEvent);

        const lines = read().split("\n");
        expect(lines.filter((line) => line === "## 待办").length).toBe(1);
        expect(location.lineNumber).toBe(4);
        expect(lines[4]).toContain("写周报");
        // Exactly one blank line between the heading and its list.
        expect(lines[3]).toBe("");
        expect(lines[5]).not.toBe("");
    });

    it("keeps a single blank line when adding several events", async () => {
        const { fakeApp, file, read } = makeFakeApp(
            "# 2026-10-03\n\n## 待办\n\n\n",
            {
                headings: [
                    { heading: "待办", level: 2, position: linePosition(2) },
                ],
            }
        );
        dailyNote = file;

        const calendar = new DailyNoteCalendar(fakeApp, "red", "待办");
        await calendar.createEvent(timedEvent);
        const lines = read().split("\n");
        expect(lines.filter((line) => line === "").length).toBe(2);

        await calendar.createEvent({ ...timedEvent, title: "第二件事" });

        const updated = read().split("\n");
        expect(updated).toEqual([
            "# 2026-10-03",
            "",
            "## 待办",
            "",
            expect.stringContaining("第二件事"),
            expect.stringContaining("写周报"),
        ]);
    });

    it("writes all day events without a time range", async () => {
        const { fakeApp, file, read } = makeFakeApp("# 2026-10-03\n", {});
        dailyNote = file;

        const calendar = new DailyNoteCalendar(fakeApp, "red", "待办");
        await calendar.createEvent({
            type: "single",
            title: "买菜",
            date: "2026-10-03",
            endDate: null,
            allDay: true,
            completed: null,
        } as OFCEvent);

        const itemLine = read()
            .split("\n")
            .find((line) => line.trim().startsWith("- "));
        expect(itemLine).toContain("[allDay:: true]");
        expect(itemLine).not.toContain("startTime");
    });
});
