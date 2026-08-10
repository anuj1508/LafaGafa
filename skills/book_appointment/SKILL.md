---
name: book_appointment
description: Find open appointment times and book the one the customer chooses.
triggers:
  - The customer asks to book, schedule, or come in
  - The customer answers a question about which time suits them
---

# Booking an appointment

## What you already offered

The prompt tells you what you offered earlier and how long ago, in two groups.

**Still true** — reuse it. If someone picks a time from a list you gave two minutes ago, book it;
do not check the calendar again just to tell them what you already told them. If they name a time
that is not on that list, say so directly and repeat the list. No lookup, no "let me check".

**May have changed** — someone else may have taken those slots. Do not repeat them as though
they were still available. Check again first, then either offer the same times or say plainly
what moved: "8:30 has gone since I last looked, but 9:00 and 9:30 are free." Never pretend you
did not offer them.

A booking you already made never expires. If the customer asks what they booked, tell them from
memory.

## Always look before you offer something new

For any time range you have not already checked, call `action: check_slots` first. Never invent a
time, infer one from the conversation, or offer what merely seems reasonable — only times the
calendar returned, or times still listed as offered above. An invented slot produces a customer
who turns up to a closed door.

## Search first. Always.

**Any message that mentions when they could come** gets `action: check_slots` in that same turn,
before you reply. Not only a request to book — a bare preference counts. "Mornings work best for
me" is a customer telling you where to look, and the reply that uses it is a list of morning times,
not "noted, let me know when you are ready".

That includes no timeframe at all: "I need to come in", "when are you free", "what have you got" —
search from now across the next several days and show them.

Never answer a timing message with a question. "When would suit you?" and "what time of day works
best?" are the two replies this skill exists to prevent: the customer asked you to look, and
looking is free.

| What they said               | What you search                        |
| ---------------------------- | -------------------------------------- |
| "tomorrow at 9"              | that time                              |
| "tomorrow morning"           | tomorrow, opening until midday         |
| "mornings work best for me"  | mornings, across the next several days |
| "I'd rather come after work" | from 5pm, across the next several days |
| "sometime next week"         | Monday to Sunday, all of it            |
| "I need to come in"          | from now, across the next several days |

Read the table as one rule with examples, not as six rules. A phrasing that is not on it is still a
range; work out which one.

Breadth is not ambiguity. Someone who says "next week" may well have said it precisely because they
are flexible, and narrowing it for them before you have shown them anything makes them do your job.
Someone who says "mornings work best" has already answered the question you were about to ask, and
asking it anyway tells them you were not listening.

### The only time you ask instead of searching

One case, and it is narrow: **a named weekday that could be either of two weeks** — "next Friday"
said on a Wednesday. Nothing else qualifies. Vague is not unclear: "sometime", "soon", "whenever
you have space" and no timeframe at all are all searchable, and searching them is the answer.

If you are about to ask a clarifying question about timing, check it against that one case first.
If it does not match, search instead.

## Hold the range you were given

Offer what is inside it. If nothing inside it is free, say that plainly and offer the nearest thing
there is — labelled as what it is: "nothing in the mornings this week, but there is 2pm on
Thursday." Presenting an afternoon as though it answered a request for a morning is worse than
having nothing to offer, because it looks like you were not listening.

## A preference outlives the message it arrived in

"Mornings work best for me" is not only a search. It is a fact about this person, and it holds for
the rest of the conversation and the next one. Once you know it, it is the default for everything
they ask afterwards: "can I come Thursday?" from someone who told you they prefer mornings means
Thursday morning. Do not make them repeat it.

The prompt tells you what you have learned about them. Use it rather than asking again — and if
they later say something that contradicts it, the new thing wins.

## Offer few, exactly as given

Offer at most the times returned, copied exactly. Two or three is plenty; a wall of options makes
people choose nothing. Then book with the slot string exactly as it was offered.

## Nothing available is an answer

When no times come back, say so and offer the next opening the skill found. If there is nothing
at all, say that plainly and offer to pass it to the team. Do not keep widening the search.

## Losing the slot

If someone else takes the slot between offering and booking, the skill says so. Tell the customer
directly — "that one just went" — then offer fresh times. Never claim a booking that did not
happen, and never book a different time on their behalf because it was close to what they wanted.

## The order of a booking

Answer the availability question first, always. Someone asking "can I come in tomorrow at 8:30?"
wants to know whether 8:30 is free — that is the question in front of you, and it needs nothing
from them to answer.

1. Check, and tell them what you found. If their time is taken, say so and offer what is open.
2. Once they pick a time, you need an email or a phone number to attach the booking to. Ask then,
   and only then.
3. Save it with `update_contact`, book, and confirm.

Asking for contact details before you have told them whether the slot exists is the wrong way
round. It reads as a form to be filled in rather than a question being answered, and half of them
will not bother.
