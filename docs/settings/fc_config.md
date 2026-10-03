# FullCalendar Configuration

There's a bunch of ways to configure how the underlying FullCalendar plugin displays events. Full Calendar exposes a few of these to users in settings.

![](../assets/settings.png)

## First day of week

The first day of the week defaults to Sunday, but you can change it to Monday, or any other day of the week.

![](../assets/change-week-start.gif)

## Default calendar views

Change your default calendar views on Desktop and Mobile to match your preference.

## 24-hour time

Ditch AM/PM for 24-hour time.

## Start and end of day

By default the week and day views run from 06:00 to 24:00. Change these to only show the part of the day you care about -- the end of the day can be `24:00` to run up to midnight.

## All-day area height

The all-day row starts at its minimum height, then grows to fit however many to-dos it holds. Once it reaches its maximum height it scrolls on its own instead of pushing the time grid off screen.

## Minimum row height

Rows on the time grid fill whatever height is available. They stop shrinking at this height, and the grid starts scrolling when even that is too small to fit the whole day.

The default day (06:00 to 24:00) has 36 half-hour rows, so a minimum of 18px keeps the whole day on screen in a typical window. Raise it if you prefer taller rows and don't mind scrolling.

## Working hours

Configure the times you work, separately for each day of the week: every day can have several ranges such as 8:00-12:00, 13:30-17:30 and 19:00-21:00. Working hours are tinted with the working hours color and the rest of the day with the (lighter) off hours color. Days you don't configure are treated as entirely off hours.
