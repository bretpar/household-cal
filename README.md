# Parker Family Hub

Lovable Prompt — Parker Family Calendar v1 Visual Shell

Build the first version of a responsive family calendar web app called Parker Family Calendar.

The goal is a warm, family-friendly interface inspired by the simplicity of Cozi and Skylight, but do not copy either product. Prioritize iPad and mobile usability while still creating a strong desktop/web layout.

Important Scope

For this first build:

Build the UI, data structure, sample data, and interactions.

Do not connect Google Calendar yet.

Architect the data model so Google Calendar can be added afterward without redesigning the app.

Use local/mock data for the first version.

Keep the implementation clean and extensible.

Family Members

Create these family members:

D — Dad

M — Mom

B — Bailey

E — Ellison

J — Jack

Each person must have:

a permanent pastel color

their initial displayed inside a small colored circle/badge

ability to be used as a calendar filter

Colors should feel soft and family-friendly rather than bright or corporate.

Dad and Mom are full-access users.

Babysitter and future additional users will be view-only.

For this visual build, permissions can be represented in the data model but full authentication does not need to be implemented yet.

Main Navigation

Create:

Today

Calendar

Activities

Family

Place Settings inside Family rather than making it a primary navigation item.

Desktop/iPad can use a top or side navigation.

Phone layouts should be structured so they can later use bottom navigation.

Calendar Views

Build:

Month

Week

Today / Agenda

Calendar should default to Month on larger screens.

Use a soft off-white background rather than pure white.

Days should have generous spacing and subtle borders.

Make the design warm, clean, rounded, and uncluttered.

Events

Each event should support:

title

date

start time

end time

all-day option

location

notes

event type

one or multiple assigned family members

recurring or single event

recurrence rule placeholder/data structure

source calendar

external Google event ID placeholder for future sync

Event Types

Use:

School

Activity

Work

Childcare

Appointment

Family

Other

Event type should not replace the family-member color system.

Family-member assignment is the primary visual identity.

Event type can use a subtle icon or secondary label.

Multi-Person Events

One event can belong to multiple family members.

Example:

School
8:00 AM–3:00 PM
B E J

This should render as one calendar event, not three duplicate events.

Show the assigned family-member initials as small colored circles within or beside the event.

Filtering by B, E, or J should still show the shared event.

Sample Events

Populate realistic mock data including:

School — B, E, J — Mon–Fri, 8:00 AM–3:00 PM

Soccer Practice — J — Tuesday, 4:30–5:30 PM

Dance — E — Wednesday, 4:00–5:00 PM

Appointment — B

Family Dinner — D, M, B, E, J

Dad Work — D

Mom Work — M

Use recurring sample events where appropriate.

Babysitter Coverage Layer

This is a critical visual behavior.

There will eventually be a separate Google Calendar called Babysitter.

Babysitter entries should NOT look like normal events.

Instead, render babysitter coverage as a subtle background time-range layer behind the normal calendar events.

Example:

Babysitter scheduled 8:00 AM–5:00 PM.

That portion of the day should have a slightly darker warm neutral / beige / gray background.

Requirements:

visually distinct from the normal off-white calendar

intentionally subtle

does not compete with family events

normal events remain prominent above the shading

optional small label near the top of the shaded area such as:
“Babysitter 8–5”

Do not use one of the children’s assigned colors for babysitter coverage.

Use sample babysitter coverage blocks on several days.

In Month view, use a subtle indicator or lightly tinted day area.

In Week/Day views, show the actual time-range background shading.

Filters

At the top of the calendar, show filter chips/circles for:

All

D

M

B

E

J

Each initial uses that person’s permanent color.

Allow multiple people to be selected if practical.

Filtering should work with the mock data.

Shared events should appear if any selected person is assigned.

Add Event

Create a prominent + Add Event button.

Add Event modal should include:

Event name

Date

Start time

End time

All-day toggle

Who? — multi-select D/M/B/E/J

Event Type

Recurrence:



Does not repeat

Daily

Weekly

Every 2 weeks

Monthly

Custom placeholder

Location

Notes

Do NOT include pickup or drop-off fields.

Do NOT include Google Calendar authorization yet.

Activities Page

Create a basic Activities page for recurring family activities.

Each activity can show:

activity name

assigned child/children

typical day/time

location

active recurring schedule

Use examples like:

Jack Soccer

Ellison Dance

School

This page can remain simple for v1.

Family Page

Show the family members with:

name

initial

assigned color

role

Roles:

Dad — Parent

Mom — Parent

Bailey — Child

Ellison — Child

Jack — Child

Also show a placeholder Caregiver section for Babysitter with View Only status.

Data Architecture

Create clean models/tables suitable for eventual Google Calendar synchronization.

Suggested entities:

family_members

id

name

initial

color

role

active

events

id

title

start_at

end_at

all_day

location

notes

event_type

recurrence_rule

source_calendar

google_calendar_id

google_event_id

event_members

Many-to-many relationship:

event_id

family_member_id

calendar_sources

Prepare for:

Parker Family

Babysitter

Include fields such as:

id

name

source_type

external_calendar_id

display_mode

Parker Family should ultimately use normal event rendering.

Babysitter should ultimately use coverage_background rendering.

Do not implement Google OAuth yet.

Design Direction

Use:

soft off-white calendar background

subtle warm neutrals

pastel family colors

rounded event cards

rounded buttons

readable modern typography

minimal shadows

generous spacing

large touch targets

clear hierarchy

friendly rather than corporate styling

Avoid:

dense enterprise-calendar appearance

harsh borders

overly saturated colors

tiny text

excessive gradients

overly complicated dashboards

The most important first screen is the Calendar.

When the build is complete, the user should immediately be able to understand:

what everyone is doing

which child an event belongs to

when multiple children share an activity

when babysitter coverage exists

how to filter the calendar by family member

Build this as a polished first visual prototype that we can refine before adding Google Calendar synchronization.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://household-cal.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/59a26a17-1a46-4d37-bcef-754fd9db6154).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
