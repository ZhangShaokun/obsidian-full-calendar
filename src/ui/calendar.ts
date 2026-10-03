/**
 * Handles rendering the calendar given a container element, eventSources, and interaction callbacks.
 */
import {
    Calendar,
    CalendarApi,
    EventApi,
    EventClickArg,
    EventHoveringArg,
    EventSourceInput,
} from "@fullcalendar/core";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import rrulePlugin from "@fullcalendar/rrule";
import listPlugin from "@fullcalendar/list";
import interactionPlugin from "@fullcalendar/interaction";
import googleCalendarPlugin from "@fullcalendar/google-calendar";
import iCalendarPlugin from "@fullcalendar/icalendar";
import { computeAllDayHeight, parseClockTime } from "./layout";
import { buildBackgroundEvents, WorkHoursByWeekday } from "./work_hours";

// There is an issue with FullCalendar RRule support around DST boundaries which is fixed by this monkeypatch:
// https://github.com/fullcalendar/fullcalendar/issues/5273#issuecomment-1360459342
rrulePlugin.recurringTypes[0].expand = function (errd, fr, de) {
    const hours = errd.rruleSet._dtstart.getHours();
    return errd.rruleSet
        .between(de.toDate(fr.start), de.toDate(fr.end), true)
        .map((d: Date) => {
            return new Date(
                Date.UTC(
                    d.getFullYear(),
                    d.getMonth(),
                    d.getDate(),
                    hours,
                    d.getMinutes()
                )
            );
        });
};

/**
 * Everything that controls how the time grid views are laid out. Unlike the
 * other render props these come straight from the plugin settings.
 */
export interface LayoutSettings {
    dayStartTime: string;
    dayEndTime: string;
    allDayMinHeight: number;
    allDayMaxHeight: number;
    slotMinRowHeight: number;
    workHours: WorkHoursByWeekday;
    workHoursColor: string;
    nonWorkHoursColor: string;
}

interface ExtraRenderProps {
    eventClick?: (info: EventClickArg) => void;
    select?: (
        startDate: Date,
        endDate: Date,
        allDay: boolean,
        viewType: string
    ) => Promise<void>;
    modifyEvent?: (event: EventApi, oldEvent: EventApi) => Promise<boolean>;
    eventMouseEnter?: (info: EventHoveringArg) => void;
    firstDay?: number;
    initialView?: { desktop: string; mobile: string };
    timeFormat24h?: boolean;
    openContextMenuForEvent?: (
        event: EventApi,
        mouseEvent: MouseEvent
    ) => Promise<void>;
    toggleTask?: (event: EventApi, isComplete: boolean) => Promise<boolean>;
    forceNarrow?: boolean;
    layout?: LayoutSettings;
    /** Height available to the calendar, in pixels. */
    height?: number;
}

const WORK_HOURS_SOURCE_ID = "ofc-work-hours-source";

/** Height of one all-day event row, used to size the all-day area. */
const ALL_DAY_ROW_HEIGHT = 22;
/** Space the day cell needs around its event rows. */
const ALL_DAY_PADDING = 8;

function setLayoutVars(el: HTMLElement, layout?: LayoutSettings) {
    el.style.setProperty(
        "--ofc-slot-min-height",
        `${layout?.slotMinRowHeight ?? 22}px`
    );
    el.style.setProperty(
        "--ofc-allday-min-height",
        `${layout?.allDayMinHeight ?? 36}px`
    );
    el.style.setProperty(
        "--ofc-allday-max-height",
        `${layout?.allDayMaxHeight ?? 140}px`
    );
}

/**
 * Size the all-day area to the busiest visible day, so that it grows with the
 * to-dos it holds instead of collapsing them into a "+N more" link.
 */
export function applyAllDayHeight(
    cal: CalendarApi,
    root: HTMLElement,
    layout?: LayoutSettings
) {
    const perDay = new Map<string, number>();
    for (const event of cal.getEvents()) {
        if (!event.allDay) {
            continue;
        }
        const key = event.startStr.slice(0, 10);
        perDay.set(key, (perDay.get(key) || 0) + 1);
    }
    const busiest = Math.max(0, ...perDay.values());
    const height = computeAllDayHeight({
        eventCount: busiest,
        rowHeight: ALL_DAY_ROW_HEIGHT,
        padding: ALL_DAY_PADDING,
        minHeight: layout?.allDayMinHeight,
        maxHeight: layout?.allDayMaxHeight,
    });
    root.style.setProperty("--ofc-allday-height", `${height}px`);
}

/**
 * Draw the working hours of every visible day as background events. Only the
 * time grid views have a meaningful notion of working hours.
 */
export function applyWorkHours(cal: CalendarApi, layout?: LayoutSettings) {
    const existing = cal.getEventSourceById(WORK_HOURS_SOURCE_ID);
    if (existing) {
        existing.remove();
    }
    const view = cal.view;
    if (!layout || !view || !view.type.startsWith("timeGrid")) {
        return;
    }
    const dayStartMin = parseClockTime(layout.dayStartTime);
    const dayEndMin = parseClockTime(layout.dayEndTime);
    if (dayStartMin === null || dayEndMin === null) {
        return;
    }
    const events = buildBackgroundEvents({
        startDate: view.currentStart,
        endDate: view.currentEnd,
        workHours: layout.workHours,
        dayStartMin,
        dayEndMin,
        workColor: layout.workHoursColor,
        nonWorkColor: layout.nonWorkHoursColor,
    });
    if (events.length > 0) {
        cal.addEventSource({ id: WORK_HOURS_SOURCE_ID, events });
    }
}

export function renderCalendar(
    containerEl: HTMLElement,
    eventSources: EventSourceInput[],
    settings?: ExtraRenderProps
): Calendar {
    const isMobile = window.innerWidth < 500;
    const isNarrow = settings?.forceNarrow || isMobile;
    const {
        eventClick,
        select,
        modifyEvent,
        eventMouseEnter,
        openContextMenuForEvent,
        toggleTask,
        layout,
    } = settings || {};

    const timeGridOptions = {
        slotMinTime: layout?.dayStartTime || "00:00",
        slotMaxTime: layout?.dayEndTime || "24:00",
        // The all-day area is sized to its contents (see applyAllDayHeight),
        // so it must not collapse its overflow into a "+N more" link.
        dayMaxEvents: false,
        expandRows: true,
    };
    setLayoutVars(containerEl, layout);

    const modifyEventCallback =
        modifyEvent &&
        (async ({
            event,
            oldEvent,
            revert,
        }: {
            event: EventApi;
            oldEvent: EventApi;
            revert: () => void;
        }) => {
            const success = await modifyEvent(event, oldEvent);
            if (!success) {
                revert();
            }
        });

    const cal = new Calendar(containerEl, {
        plugins: [
            // View plugins
            dayGridPlugin,
            timeGridPlugin,
            listPlugin,
            // Drag + drop and editing
            interactionPlugin,
            // Remote sources
            googleCalendarPlugin,
            iCalendarPlugin,
            rrulePlugin,
        ],
        googleCalendarApiKey: "AIzaSyDIiklFwJXaLWuT_4y6I9ZRVVsPuf4xGrk",
        initialView:
            settings?.initialView?.[isNarrow ? "mobile" : "desktop"] ||
            (isNarrow ? "timeGrid3Days" : "timeGridWeek"),
        nowIndicator: true,
        scrollTimeReset: false,
        dayMaxEvents: true,
        // Only show the configured part of the day. Views without a time grid
        // (month, list) ignore these.
        slotMinTime: layout?.dayStartTime || "00:00",
        slotMaxTime: layout?.dayEndTime || "24:00",

        // A definite height is what lets the time grid scroll instead of
        // squeezing rows below their minimum height.
        ...(settings?.height ? { height: settings.height } : {}),

        headerToolbar: !isNarrow
            ? {
                  left: "prev,next today",
                  center: "title",
                  right: "dayGridMonth,timeGridWeek,timeGridDay,listWeek",
              }
            : !isMobile
            ? {
                  right: "today,prev,next",
                  left: "timeGrid3Days,timeGridDay,listWeek",
              }
            : false,
        footerToolbar: isMobile
            ? {
                  right: "today,prev,next",
                  left: "timeGrid3Days,timeGridDay,listWeek",
              }
            : false,

        // Only show the part of the day that matters, let rows fill whatever
        // height is available, and let the all-day area hold all of its events
        // instead of collapsing them into a "+N more" link.
        views: {
            timeGridDay: {
                type: "timeGrid",
                duration: { days: 1 },
                buttonText: isNarrow ? "1" : "day",
                ...timeGridOptions,
            },
            timeGrid3Days: {
                type: "timeGrid",
                duration: { days: 3 },
                buttonText: "3",
                ...timeGridOptions,
            },
            timeGridWeek: timeGridOptions,
        },
        firstDay: settings?.firstDay,
        ...(settings?.timeFormat24h && {
            eventTimeFormat: {
                hour: "numeric",
                minute: "2-digit",
                hour12: false,
            },
            slotLabelFormat: {
                hour: "numeric",
                minute: "2-digit",
                hour12: false,
            },
        }),
        eventSources,
        eventClick,

        datesSet: (info) => {
            applyWorkHours(info.view.calendar, layout);
            applyAllDayHeight(info.view.calendar, containerEl, layout);
        },

        selectable: select && true,
        selectMirror: select && true,
        select:
            select &&
            (async (info) => {
                await select(info.start, info.end, info.allDay, info.view.type);
                info.view.calendar.unselect();
            }),

        editable: modifyEvent && true,
        eventDrop: modifyEventCallback,
        eventResize: modifyEventCallback,

        eventMouseEnter,

        eventDidMount: ({ event, el, textColor }) => {
            el.addEventListener("contextmenu", (e) => {
                e.preventDefault();
                openContextMenuForEvent && openContextMenuForEvent(event, e);
            });
            if (toggleTask) {
                if (event.extendedProps.isTask) {
                    const checkbox = document.createElement("input");
                    checkbox.type = "checkbox";
                    checkbox.checked =
                        event.extendedProps.taskCompleted !== false;
                    checkbox.onclick = async (e) => {
                        e.stopPropagation();
                        if (e.target) {
                            let ret = await toggleTask(
                                event,
                                (e.target as HTMLInputElement).checked
                            );
                            if (!ret) {
                                (e.target as HTMLInputElement).checked = !(
                                    e.target as HTMLInputElement
                                ).checked;
                            }
                        }
                    };
                    // Make the checkbox more visible against different color events.
                    if (textColor == "black") {
                        checkbox.addClass("ofc-checkbox-black");
                    } else {
                        checkbox.addClass("ofc-checkbox-white");
                    }

                    if (checkbox.checked) {
                        el.addClass("ofc-task-completed");
                    }

                    // Depending on the view, we should put the checkbox in a different spot.
                    const container =
                        el.querySelector(".fc-event-time") ||
                        el.querySelector(".fc-event-title") ||
                        el.querySelector(".fc-list-event-title");

                    container?.addClass("ofc-has-checkbox");
                    container?.prepend(checkbox);
                }
            }
        },

        longPressDelay: 250,
    });
    cal.render();
    applyWorkHours(cal, layout);
    applyAllDayHeight(cal, containerEl, layout);
    return cal;
}
