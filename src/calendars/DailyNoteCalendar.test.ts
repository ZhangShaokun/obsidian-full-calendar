import { CachedMetadata, TFile, TFolder } from "obsidian";
import { ObsidianInterface } from "../ObsidianAdapter";
import { OFCEvent } from "../types";
import { EditableCalendar } from "./EditableCalendar";
import DailyNoteCalendar, {
    getInlineAttributes,
    normalizeHeadingSpacing,
} from "./DailyNoteCalendar";

// The daily note that the daily-notes interface hands back. Set per test.
let dailyNote: TFile | null = null;
// What the daily-notes interface reports as the date of a file. Set per test.
let mockDateFromFile: { format: (format: string) => string } | null = null;

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
    getDateFromFile: () => mockDateFromFile,
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

        expect(tasksCalendar.name).toBe("Tasks in daily note");
        expect(eventsCalendar.name).toBe("Events in daily note");
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
        getFileByPath: jest.fn(() => file),
        read: jest.fn(async () => contents),
        rewrite: jest.fn(async (_file: TFile, rewriteFunc: any) => {
            const result = await rewriteFunc(contents);
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

const timedEventWith = (overrides: Record<string, unknown>): OFCEvent =>
    ({ ...timedEvent, ...overrides } as OFCEvent);

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
            "",
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
        expect(lines[5]).toBe("");
        expect(lines.length).toBe(6);
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
        // One blank line after the title, one after the heading, then the final
        // newline of the file.
        expect(read().split("\n")).toEqual([
            "# 2026-10-03",
            "",
            "## 待办",
            "",
            expect.stringContaining("写周报"),
            "",
        ]);

        await calendar.createEvent({ ...timedEvent, title: "第二件事" });

        const updated = read().split("\n");
        expect(updated).toEqual([
            "# 2026-10-03",
            "",
            "## 待办",
            "",
            expect.stringContaining("第二件事"),
            expect.stringContaining("写周报"),
            "",
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

describe("normalizeHeadingSpacing", () => {
    it("surrounds headings with a single blank line", () => {
        expect(
            normalizeHeadingSpacing(["# 标题", "## 待办", "- 任务A"])
        ).toEqual(["# 标题", "", "## 待办", "", "- 任务A"]);
    });

    it("collapses runs of blank lines", () => {
        expect(
            normalizeHeadingSpacing(["# 标题", "", "", "", "- 任务A", "", ""])
        ).toEqual(["# 标题", "", "- 任务A", ""]);
    });

    it("separates consecutive headings", () => {
        expect(normalizeHeadingSpacing(["## 待办", "## 工作"])).toEqual([
            "## 待办",
            "",
            "## 工作",
        ]);
    });

    it("is idempotent", () => {
        const once = normalizeHeadingSpacing([
            "# 标题",
            "",
            "",
            "## 待办",
            "- 任务A",
            "",
            "",
            "## 工作",
            "",
            "- 任务B",
            "",
        ]);
        expect(normalizeHeadingSpacing(once)).toEqual(once);
    });
});

describe("item location", () => {
    beforeEach(() => {
        mockDateFromFile = { format: () => "2026-10-03" };
    });

    afterEach(() => {
        mockDateFromFile = null;
    });

    // 任务A was deleted from this note earlier, so 任务B and 任务C moved up one
    // line while the cache still thinks 任务B is on line 5.
    const shiftedNote = [
        "# 2026-10-03",
        "",
        "## 待办",
        "",
        "- [ ] 任务B [startTime:: 14:00]  [endTime:: 15:00]",
        "- [ ] 任务C [startTime:: 16:00]  [endTime:: 17:00]",
        "",
    ].join("\n");

    it("modifies the dragged item, not the task on the cached line", async () => {
        const { fakeApp, file, read } = makeFakeApp(shiftedNote, {});
        const calendar = new DailyNoteCalendar(fakeApp, "red", "待办");
        const updateCacheWithLocation = jest.fn();

        await calendar.modifyEvent(
            { path: file.path, lineNumber: 5 },
            timedEventWith({
                title: "任务B",
                startTime: "18:00",
                endTime: "19:00",
            }),
            updateCacheWithLocation,
            timedEventWith({ title: "任务B" })
        );

        const lines = read().split("\n");
        expect(lines[4]).toContain("任务B");
        expect(lines[4]).toContain("[startTime:: 18:00]");
        expect(lines[5]).toContain("任务C");
        expect(lines[5]).toContain("[startTime:: 16:00]");
        expect(updateCacheWithLocation).toHaveBeenCalledWith({
            file,
            lineNumber: 4,
        });
    });

    it("refuses to write when the item cannot be identified", async () => {
        const { fakeApp, file, read } = makeFakeApp(shiftedNote, {});
        const calendar = new DailyNoteCalendar(fakeApp, "red", "待办");

        await expect(
            calendar.modifyEvent(
                { path: file.path, lineNumber: 5 },
                timedEventWith({ title: "任务X" }),
                jest.fn(),
                timedEventWith({ title: "任务X" })
            )
        ).rejects.toThrow(/reopen the calendar/);

        expect(read()).toBe(shiftedNote);
    });

    it("deletes the item, not the task on the cached line", async () => {
        const { fakeApp, file, read } = makeFakeApp(shiftedNote, {});
        const calendar = new DailyNoteCalendar(fakeApp, "red", "待办");

        await calendar.deleteEvent(
            { path: file.path, lineNumber: 5 },
            timedEventWith({ title: "任务B" })
        );

        expect(read()).toBe(
            [
                "# 2026-10-03",
                "",
                "## 待办",
                "",
                "- [ ] 任务C [startTime:: 16:00]  [endTime:: 17:00]",
                "",
            ].join("\n")
        );
    });

    it("keeps heading spacing after a delete", async () => {
        const { fakeApp, file, read } = makeFakeApp(
            "# 2026-10-03\n\n## 待办\n- [ ] 任务A\n\n\n- [ ] 任务B\n",
            {}
        );
        const calendar = new DailyNoteCalendar(fakeApp, "red", "待办");

        await calendar.deleteEvent(
            { path: file.path, lineNumber: 3 },
            { ...timedEvent, title: "任务A" }
        );

        expect(read()).toBe("# 2026-10-03\n\n## 待办\n\n- [ ] 任务B\n");
    });
});

describe("move between headings", () => {
    const twoHeadingsNote = [
        "# 2026-10-03",
        "",
        "## 待办",
        "",
        "- [ ] 任务A [startTime:: 09:00]  [endTime:: 10:00]",
        "",
        "## 工作",
        "",
        "- [ ] 任务Z [startTime:: 11:00]  [endTime:: 12:00]",
        "",
    ].join("\n");

    it("moves the item under the target heading", async () => {
        const { fakeApp, file, read } = makeFakeApp(twoHeadingsNote, {});
        const from = new DailyNoteCalendar(fakeApp, "red", "待办");
        const to = new DailyNoteCalendar(fakeApp, "blue", "工作");
        const updateCacheWithLocation = jest.fn();

        await from.move(
            { path: file.path, lineNumber: 4 },
            to,
            updateCacheWithLocation,
            timedEventWith({ title: "任务A" })
        );

        expect(read()).toBe(
            [
                "# 2026-10-03",
                "",
                "## 待办",
                "",
                "## 工作",
                "",
                "- [ ] 任务A [startTime:: 09:00]  [endTime:: 10:00]",
                "- [ ] 任务Z [startTime:: 11:00]  [endTime:: 12:00]",
                "",
            ].join("\n")
        );
        expect(updateCacheWithLocation).toHaveBeenCalledWith({
            file,
            lineNumber: 6,
        });
    });

    it("appends the target heading when the note does not have it yet", async () => {
        const { fakeApp, file, read } = makeFakeApp(
            [
                "# 2026-10-03",
                "",
                "## 待办",
                "",
                "- [ ] 任务A [startTime:: 09:00]  [endTime:: 10:00]",
                "",
            ].join("\n"),
            {}
        );
        const from = new DailyNoteCalendar(fakeApp, "red", "待办");
        const to = new DailyNoteCalendar(fakeApp, "blue", "新标题");
        const updateCacheWithLocation = jest.fn();

        await from.move(
            { path: file.path, lineNumber: 4 },
            to,
            updateCacheWithLocation,
            timedEventWith({ title: "任务A" })
        );

        expect(read()).toBe(
            [
                "# 2026-10-03",
                "",
                "## 待办",
                "",
                "## 新标题",
                "",
                "- [ ] 任务A [startTime:: 09:00]  [endTime:: 10:00]",
                "",
            ].join("\n")
        );
        expect(updateCacheWithLocation).toHaveBeenCalledWith({
            file,
            lineNumber: 6,
        });
    });

    it("rejects moving to a calendar that is not a daily note", async () => {
        const { fakeApp, file } = makeFakeApp(twoHeadingsNote, {});
        const from = new DailyNoteCalendar(fakeApp, "red", "待办");
        const other = { type: "local" } as unknown as EditableCalendar;

        await expect(
            from.move({ path: file.path, lineNumber: 4 }, other, jest.fn())
        ).rejects.toThrow(/daily note/);
    });
});
