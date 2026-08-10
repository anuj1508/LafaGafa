---
name: update_contact
description: Record details the customer states about themselves onto their contact record.
triggers:
  - The customer gives their name, email, or phone number
  - The customer gives an address that belongs to someone else, for correspondence
  - The customer corrects a detail they gave earlier
---

# Recording customer details

## Record it as they say it

The moment a customer states a detail about themselves, save it — in the same turn, before you
reply. "Hello, I'm Anuj" is a first name being given to you; "you can reach me on 07..." is a
phone number. Do not wait to be asked, do not wait for them to finish, and do not decide it can
be picked up later. There may be no later: most conversations end without anyone ever restating
their name, and a warm greeting that saved nothing is the most common way this fails.

## What you already recorded

The prompt lists what is already on file. Do not save any of it again — a customer repeating
their own email is not a new fact. Save only something you have not been told before, or a
correction to something you have.

## Only what they said

Write the value the customer actually gave, in their words. Do not infer a first name from an
email address, do not normalise "next week sometime" into a date, and do not fill a field because
it looks empty. A wrong value on a contact record is worse than an absent one: it looks
authoritative and nobody re-checks it.

## Act on a preference, do not file it

"Mornings work best for me", "I can only do after work" — do not record these. Search them. The
customer has told you when they can come so that you will look, and answering with "noted, let me
know when you want to book" is the one reply that uses the information for nothing.

The rule for everything on this page: **record what nothing can act on, act on what something can.**
A preference has an action. An address for somebody else does not, which is why that one is worth
writing down and this one is not.

What never belongs here is anything hypothetical, and anything you worked out rather than were
told.

## An address that is not theirs

"Send it to my husband instead, his email is dave@example.com" is worth keeping — they told you so
you would use it. Record it as `correspondenceEmail`. It goes on the contact as a note, which is where reception
looks, and stays out of the field the CRM matches people on.

Never as `email`. That field is who the contact _is_, and the CRM matches people on it: putting a
third party's address there can merge two patients into one record, and sends every future
reminder to somebody who is not the patient.

The same holds for a phone number given as someone else's. If in doubt about whose a detail is,
ask — one question is cheaper than a merged record.

## Say nothing about having saved it

Recording a detail is bookkeeping the customer did not ask for. "Thanks Anuj" is right; "thanks
Anuj, I've saved that to your record" is not — it draws attention to a system they should never
have to think about. Only mention it when a write was refused, because then it genuinely affects
them.

## Confirm identity fields first

For email and phone, read the value back and wait for a yes before saving:

> Just to check I've got that right — priya@example.com?

Call the skill with `confirmed: false` to have it prompt you, then again with `confirmed: true`
once they agree. Mishearing an email is common and a booking confirmation sent to the wrong
address is a silent failure.

## One field per call

Call once per field rather than batching. If someone says "I'm Priya, priya@x.com", that is two
calls. Make them both in the same turn — you do not need to wait for one to come back before
asking for the other. Batching them into a single call makes a partial failure impossible to
describe accurately.

## Names

Map exactly what they told you, and nothing more:

- "I'm Anuj" — `firstName: Anuj`. Say nothing about a surname; they have not given one.
- "I'm Anuj Gupta" — two calls, `firstName: Anuj` and `lastName: Gupta`.
- "my last name is Gupta" — `lastName: Gupta` only. Leave the first name alone.
- "Anuj Kumar Gupta" — `firstName: Anuj`, `lastName: Kumar Gupta`. When a name has more than two
  parts, the first word is the first name and the rest is the surname. If that reads wrong for
  the name in front of you, ask rather than guessing — people's names are not a format.

A visitor who has not introduced themselves has a placeholder first name and no surname. Writing
their real first name replaces the placeholder outright, so there is nothing to clean up.

## When it is refused

The skill will block a field the business does not allow the assistant to change, or a value that
does not look like what it claims to be. Relay that plainly and offer to pass it to the team.
Never say a detail was saved when it was not.
