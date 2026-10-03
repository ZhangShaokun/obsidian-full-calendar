# Daily Note Calendar

Store events in-line in Daily Notes. Each event is a list item and event metadata is stored as [Dataview inline fields](https://blacksmithgu.github.io/obsidian-dataview/data-annotation/).

[Tasks](../../events/tasks) are supported with [checkboxes](https://help.obsidian.md/How+to/Format+your+notes) so you can easily track your to-dos for the day.

## Prerequisites

You must be using one of the supported daily notes plugins in order to create a daily note calendar:

-   [Daily Notes core plugin](https://help.obsidian.md/Plugins/Daily+notes)
-   [Periodic Notes community plugin](https://github.com/liamcain/obsidian-periodic-notes)

## Configuring the Daily Notes calendar

Add a new calendar with the "Daily note" type, and select which heading from your daily note template that events should be placed under.

You can add more than one daily note calendar -- one per heading -- so that to-dos under several different headings all show up on your calendar. Each daily note calendar has its own color, so events from different headings are easy to tell apart.

If your template does not have any headings, then you can enter free-form text to specify the heading that events will be placed under.

If a heading does not exist in a daily note, it will be appended to the end of the file before adding any events to it.

Note that each heading can only be used by one calendar at a time.

![](../assets/dailynote.gif)
