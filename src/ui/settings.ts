import FullCalendarPlugin from "../main";
import {
    App,
    DropdownComponent,
    Notice,
    PluginSettingTab,
    Setting,
    TFile,
    TFolder,
} from "obsidian";
import { makeDefaultPartialCalendarSource, CalendarInfo } from "../types";
import { CalendarSettings } from "./components/CalendarSetting";
import { AddCalendarSource } from "./components/AddCalendarSource";
import * as ReactDOM from "react-dom";
import { createElement } from "react";
import { getDailyNoteSettings } from "obsidian-daily-notes-interface";
import ReactModal from "./ReactModal";
import { importCalendars } from "src/calendars/parsing/caldav/import";
import { TimeRange } from "./work_hours";
import { MINUTES_IN_DAY, minutesToClockTime, parseClockTime } from "./layout";

export interface FullCalendarSettings {
    calendarSources: CalendarInfo[];
    defaultCalendar: number;
    firstDay: number;
    initialView: {
        desktop: string;
        mobile: string;
    };
    timeFormat24h: boolean;
    clickToCreateEventFromMonthView: boolean;
    /** First time of day shown in the time grid views. */
    dayStartTime: string;
    /** Last time of day shown in the time grid views. "24:00" ends at midnight. */
    dayEndTime: string;
    /** Smallest height of the all-day area, in pixels. */
    allDayMinHeight: number;
    /** Height at which the all-day area starts scrolling, in pixels. */
    allDayMaxHeight: number;
    /** Smallest height of one row on the time grid, in pixels. */
    slotMinRowHeight: number;
    /** Working hours by weekday, where 0 is Sunday. Empty means disabled. */
    workHours: { [weekday: number]: TimeRange[] };
    workHoursColor: string;
    nonWorkHoursColor: string;
}

export const DEFAULT_SETTINGS: FullCalendarSettings = {
    calendarSources: [],
    defaultCalendar: 0,
    firstDay: 0,
    initialView: {
        desktop: "timeGridWeek",
        mobile: "timeGrid3Days",
    },
    timeFormat24h: false,
    clickToCreateEventFromMonthView: true,
    dayStartTime: "06:00",
    dayEndTime: "24:00",
    allDayMinHeight: 36,
    allDayMaxHeight: 140,
    // The default day spans 06:00-24:00, i.e. 36 half-hour rows. 18px keeps
    // them on screen in a typical window; raise it to have the grid scroll.
    slotMinRowHeight: 18,
    workHours: {},
    workHoursColor: "#7f7f7f",
    nonWorkHoursColor: "#c0c0c0",
};

const WEEKDAYS = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
];

const INITIAL_VIEW_OPTIONS = {
    DESKTOP: {
        timeGridDay: "Day",
        timeGridWeek: "Week",
        dayGridMonth: "Month",
        listWeek: "List",
    },
    MOBILE: {
        timeGrid3Days: "3 Days",
        timeGridDay: "Day",
        listWeek: "List",
    },
};

export function addCalendarButton(
    app: App,
    plugin: FullCalendarPlugin,
    containerEl: HTMLElement,
    submitCallback: (setting: CalendarInfo) => void,
    listUsedDirectories?: () => string[]
) {
    let dropdown: DropdownComponent;
    const directories = app.vault
        .getAllLoadedFiles()
        .filter((f) => f instanceof TFolder)
        .map((f) => f.path);

    return new Setting(containerEl)
        .setName("Calendars")
        .setDesc("Add calendar")
        .addDropdown(
            (d) =>
                (dropdown = d.addOptions({
                    local: "Full note",
                    dailynote: "Daily Note",
                    icloud: "iCloud",
                    caldav: "CalDAV",
                    ical: "Remote (.ics format)",
                }))
        )
        .addExtraButton((button) => {
            button.setTooltip("Add Calendar");
            button.setIcon("plus-with-circle");
            button.onClick(() => {
                let modal = new ReactModal(app, async () => {
                    await plugin.loadSettings();
                    const usedDirectories = (
                        listUsedDirectories
                            ? listUsedDirectories
                            : () =>
                                  plugin.settings.calendarSources
                                      .map(
                                          (s) =>
                                              s.type === "local" && s.directory
                                      )
                                      .filter((s): s is string => !!s)
                    )();
                    // A daily note calendar is one-per-heading, so don't offer
                    // headings that are already configured.
                    const usedHeadings = plugin.settings.calendarSources
                        .map((s) => (s.type === "dailynote" ? s.heading : null))
                        .filter((s): s is string => !!s);
                    let headings: string[] = [];
                    let { template } = getDailyNoteSettings();

                    if (template) {
                        if (!template.endsWith(".md")) {
                            template += ".md";
                        }
                        const file = app.vault.getAbstractFileByPath(template);
                        if (file instanceof TFile) {
                            headings =
                                app.metadataCache
                                    .getFileCache(file)
                                    ?.headings?.map((h) => h.heading) || [];
                        }
                    }

                    return createElement(AddCalendarSource, {
                        source: makeDefaultPartialCalendarSource(
                            dropdown.getValue() as CalendarInfo["type"]
                        ),
                        directories: directories.filter(
                            (dir) => usedDirectories.indexOf(dir) === -1
                        ),
                        headings: headings.filter(
                            (heading) => usedHeadings.indexOf(heading) === -1
                        ),
                        submit: async (source: CalendarInfo) => {
                            if (source.type === "caldav") {
                                try {
                                    let sources = await importCalendars(
                                        {
                                            type: "basic",
                                            username: source.username,
                                            password: source.password,
                                        },
                                        source.url
                                    );
                                    sources.forEach((source) =>
                                        submitCallback(source)
                                    );
                                } catch (e) {
                                    if (e instanceof Error) {
                                        new Notice(e.message);
                                    }
                                }
                            } else {
                                submitCallback(source);
                            }
                            modal.close();
                        },
                    });
                });
                modal.open();
            });
        });
}

function addNumberSetting(
    containerEl: HTMLElement,
    plugin: FullCalendarPlugin,
    name: string,
    desc: string,
    get: () => number,
    set: (value: number) => void
) {
    new Setting(containerEl)
        .setName(name)
        .setDesc(desc)
        .addText((text) =>
            text.setValue(String(get())).onChange(async (value) => {
                const parsed = Number(value);
                if (!Number.isFinite(parsed) || parsed <= 0) {
                    new Notice(`"${name}" must be a positive number.`);
                    return;
                }
                set(parsed);
                await plugin.saveViewSettings();
            })
        );
}

function addTimeSetting(
    containerEl: HTMLElement,
    plugin: FullCalendarPlugin,
    name: string,
    desc: string,
    get: () => string,
    set: (value: string) => void,
    validate?: (value: string) => string | null
) {
    new Setting(containerEl)
        .setName(name)
        .setDesc(desc)
        .addText((text) =>
            text
                .setPlaceholder("HH:mm")
                .setValue(get())
                .onChange(async (value) => {
                    if (parseClockTime(value) === null) {
                        new Notice(
                            `"${value}" is not a valid time. Use HH:mm, for example 06:00 or 24:00.`
                        );
                        return;
                    }
                    if (validate) {
                        const error = validate(value);
                        if (error) {
                            new Notice(error);
                            return;
                        }
                    }
                    set(value);
                    await plugin.saveViewSettings();
                })
        );
}

function addColorSetting(
    containerEl: HTMLElement,
    plugin: FullCalendarPlugin,
    name: string,
    desc: string,
    get: () => string,
    set: (value: string) => void
) {
    const setting = new Setting(containerEl).setName(name).setDesc(desc);
    const input = document.createElement("input");
    input.type = "color";
    input.value = get();
    input.onchange = async () => {
        set(input.value);
        await plugin.saveViewSettings();
    };
    setting.controlEl.appendChild(input);
}

/** Length of a working hours range added from the settings. */
const DEFAULT_RANGE_MINUTES = 60;

/** Suggested end time for a range that starts at `time`. */
function nextTimeAfter(time: string): string {
    const minutes = parseClockTime(time);
    if (minutes === null) {
        return "17:00";
    }
    return minutesToClockTime(
        Math.min(MINUTES_IN_DAY, minutes + DEFAULT_RANGE_MINUTES)
    );
}

function addWorkHoursSettings(
    containerEl: HTMLElement,
    plugin: FullCalendarPlugin
) {
    // Additions and deletions redraw this section only, instead of re-rendering
    // the whole tab (which would scroll back to the top).
    const sectionEl = containerEl.createDiv();
    let focus: { weekday: number; index: number } | null = null;

    const rangesFor = (weekday: number): TimeRange[] =>
        plugin.settings.workHours[weekday] || [];

    const commit = async (weekday: number, ranges: TimeRange[]) => {
        plugin.settings.workHours[weekday] = ranges;
        await plugin.saveViewSettings();
    };

    const updateRange = async (
        weekday: number,
        index: number,
        changes: Partial<TimeRange>
    ) => {
        const ranges = [...rangesFor(weekday)];
        const current = ranges[index];
        if (!current) {
            return;
        }
        ranges[index] = { ...current, ...changes };
        await commit(weekday, ranges);
    };

    const render = () => {
        sectionEl.empty();

        WEEKDAYS.forEach((day, weekday) => {
            const ranges = rangesFor(weekday);

            new Setting(sectionEl)
                .setName(day)
                .setDesc(
                    ranges.length === 0
                        ? "No working hours: the whole day is off hours."
                        : "Add another range of working hours."
                )
                .addButton((button) =>
                    button.setButtonText("Add range").onClick(async () => {
                        const current = rangesFor(weekday);
                        // Continue where the last range ended instead of
                        // dropping the user back on a default range.
                        const start =
                            current[current.length - 1]?.end || "09:00";
                        focus = { weekday, index: current.length };
                        await commit(weekday, [
                            ...current,
                            { start, end: nextTimeAfter(start) },
                        ]);
                        render();
                    })
                );

            ranges.forEach((range, index) => {
                // Always read the ranges back out of the settings: the array
                // captured when this row was rendered can be out of date.
                const other = (field: "start" | "end") =>
                    parseClockTime(rangesFor(weekday)[index]?.[field] || "");

                const rangeSetting = new Setting(sectionEl)
                    .setName(`Range ${index + 1}`)
                    .setDesc("Working hours as HH:mm.")
                    .addText((text) =>
                        text
                            .setPlaceholder("HH:mm")
                            .setValue(range.start)
                            .onChange(async (value) => {
                                const parsed = parseClockTime(value);
                                if (parsed === null) {
                                    // Ignore values that are still being typed.
                                    return;
                                }
                                const end = other("end");
                                if (end !== null && parsed >= end) {
                                    return;
                                }
                                await updateRange(weekday, index, {
                                    start: value,
                                });
                            })
                    )
                    .addText((text) =>
                        text
                            .setPlaceholder("HH:mm")
                            .setValue(range.end)
                            .onChange(async (value) => {
                                const parsed = parseClockTime(value);
                                if (parsed === null) {
                                    return;
                                }
                                const start = other("start");
                                if (start !== null && parsed <= start) {
                                    return;
                                }
                                await updateRange(weekday, index, {
                                    end: value,
                                });
                            })
                    )
                    .addExtraButton((button) =>
                        button
                            .setIcon("trash")
                            .setTooltip("Delete range")
                            .onClick(async () => {
                                await commit(
                                    weekday,
                                    rangesFor(weekday).filter(
                                        (_, i) => i !== index
                                    )
                                );
                                render();
                            })
                    );

                if (
                    focus &&
                    focus.weekday === weekday &&
                    focus.index === index
                ) {
                    focus = null;
                    rangeSetting.controlEl.querySelector("input")?.focus();
                }
            });
        });
    };

    render();
}

export class FullCalendarSettingTab extends PluginSettingTab {
    plugin: FullCalendarPlugin;

    constructor(app: App, plugin: FullCalendarPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    async display(): Promise<void> {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl("h2", { text: "Calendar Preferences" });
        new Setting(containerEl)
            .setName("Desktop Initial View")
            .setDesc("Choose the initial view range on desktop devices.")
            .addDropdown((dropdown) => {
                Object.entries(INITIAL_VIEW_OPTIONS.DESKTOP).forEach(
                    ([value, display]) => {
                        dropdown.addOption(value, display);
                    }
                );
                dropdown.setValue(this.plugin.settings.initialView.desktop);
                dropdown.onChange(async (initialView) => {
                    this.plugin.settings.initialView.desktop = initialView;
                    await this.plugin.saveSettings();
                });
            });

        new Setting(containerEl)
            .setName("Mobile Initial View")
            .setDesc("Choose the initial view range on mobile devices.")
            .addDropdown((dropdown) => {
                Object.entries(INITIAL_VIEW_OPTIONS.MOBILE).forEach(
                    ([value, display]) => {
                        dropdown.addOption(value, display);
                    }
                );
                dropdown.setValue(this.plugin.settings.initialView.mobile);
                dropdown.onChange(async (initialView) => {
                    this.plugin.settings.initialView.mobile = initialView;
                    await this.plugin.saveSettings();
                });
            });

        new Setting(containerEl)
            .setName("Starting Day of the Week")
            .setDesc("Choose what day of the week to start.")
            .addDropdown((dropdown) => {
                WEEKDAYS.forEach((day, code) => {
                    dropdown.addOption(code.toString(), day);
                });
                dropdown.setValue(this.plugin.settings.firstDay.toString());
                dropdown.onChange(async (codeAsString) => {
                    this.plugin.settings.firstDay = Number(codeAsString);
                    await this.plugin.saveSettings();
                });
            });

        new Setting(containerEl)
            .setName("24-hour format")
            .setDesc("Display the time in a 24-hour format.")
            .addToggle((toggle) => {
                toggle.setValue(this.plugin.settings.timeFormat24h);
                toggle.onChange(async (val) => {
                    this.plugin.settings.timeFormat24h = val;
                    await this.plugin.saveSettings();
                });
            });

        new Setting(containerEl)
            .setName("Click on a day in month view to create event")
            .setDesc("Switch off to open day view on click instead.")
            .addToggle((toggle) => {
                toggle.setValue(
                    this.plugin.settings.clickToCreateEventFromMonthView
                );
                toggle.onChange(async (val) => {
                    this.plugin.settings.clickToCreateEventFromMonthView = val;
                    await this.plugin.saveSettings();
                });
            });

        containerEl.createEl("h3", { text: "Time grid" });

        addTimeSetting(
            containerEl,
            this.plugin,
            "Start of day",
            "First time shown in the week and day views.",
            () => this.plugin.settings.dayStartTime,
            (value) => (this.plugin.settings.dayStartTime = value),
            (value) => {
                const start = parseClockTime(value);
                const end = parseClockTime(this.plugin.settings.dayEndTime);
                return start !== null && end !== null && start >= end
                    ? "The start of the day must be before its end."
                    : null;
            }
        );

        addTimeSetting(
            containerEl,
            this.plugin,
            "End of day",
            "Last time shown in the week and day views. Use 24:00 to end at midnight.",
            () => this.plugin.settings.dayEndTime,
            (value) => (this.plugin.settings.dayEndTime = value),
            (value) => {
                const start = parseClockTime(this.plugin.settings.dayStartTime);
                const end = parseClockTime(value);
                return start !== null && end !== null && end <= start
                    ? "The end of the day must be after its start."
                    : null;
            }
        );

        addNumberSetting(
            containerEl,
            this.plugin,
            "All-day area height",
            "Smallest height of the all-day row, in pixels. It grows to fit your to-dos.",
            () => this.plugin.settings.allDayMinHeight,
            (value) => (this.plugin.settings.allDayMinHeight = value)
        );

        addNumberSetting(
            containerEl,
            this.plugin,
            "All-day area maximum height",
            "Once the all-day row reaches this height it scrolls instead of growing.",
            () => this.plugin.settings.allDayMaxHeight,
            (value) => (this.plugin.settings.allDayMaxHeight = value)
        );

        addNumberSetting(
            containerEl,
            this.plugin,
            "Minimum row height",
            "Smallest height of one row on the time grid, in pixels. Rows fill the screen until they would get shorter than this, then the grid scrolls.",
            () => this.plugin.settings.slotMinRowHeight,
            (value) => (this.plugin.settings.slotMinRowHeight = value)
        );

        containerEl.createEl("h3", { text: "Working hours" });

        addColorSetting(
            containerEl,
            this.plugin,
            "Working hours color",
            "Background tint of your working hours.",
            () => this.plugin.settings.workHoursColor,
            (value) => (this.plugin.settings.workHoursColor = value)
        );

        addColorSetting(
            containerEl,
            this.plugin,
            "Off hours color",
            "Background tint of the rest of the day.",
            () => this.plugin.settings.nonWorkHoursColor,
            (value) => (this.plugin.settings.nonWorkHoursColor = value)
        );

        addWorkHoursSettings(containerEl, this.plugin);

        containerEl.createEl("h2", { text: "Manage Calendars" });
        addCalendarButton(
            this.app,
            this.plugin,
            containerEl,
            async (source: CalendarInfo) => {
                sourceList.addSource(source);
            },
            () =>
                sourceList.state.sources
                    .map((s) => s.type === "local" && s.directory)
                    .filter((s): s is string => !!s)
        );

        const sourcesDiv = containerEl.createDiv();
        sourcesDiv.style.display = "block";
        let sourceList = ReactDOM.render(
            createElement(CalendarSettings, {
                sources: this.plugin.settings.calendarSources,
                submit: async (settings: CalendarInfo[]) => {
                    this.plugin.settings.calendarSources = settings;
                    await this.plugin.saveSettings();
                },
            }),
            sourcesDiv
        );
    }
}
