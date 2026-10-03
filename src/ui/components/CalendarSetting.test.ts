import { findDuplicateHeadings } from "./CalendarSetting";

describe("findDuplicateHeadings", () => {
    it("allows multiple daily note calendars with different headings", () => {
        const sources = [
            { type: "dailynote" as const, heading: "Tasks", color: "red" },
            { type: "dailynote" as const, heading: "Events", color: "blue" },
            { type: "local" as const, directory: "events", color: "green" },
        ];

        expect(findDuplicateHeadings(sources)).toEqual([]);
    });

    it("flags a heading that is used more than once", () => {
        const sources = [
            { type: "dailynote" as const, heading: "Tasks", color: "red" },
            { type: "dailynote" as const, heading: "Events", color: "blue" },
            { type: "dailynote" as const, heading: "Tasks", color: "green" },
        ];

        expect(findDuplicateHeadings(sources)).toEqual(["Tasks"]);
    });

    it("ignores daily note calendars without a heading", () => {
        const sources = [
            { type: "dailynote" as const, color: "red" },
            { type: "dailynote" as const, color: "blue" },
        ];

        expect(findDuplicateHeadings(sources)).toEqual([]);
    });
});
