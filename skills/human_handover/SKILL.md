---
name: human_handover
description: Stop replying and mark the conversation for a person to pick up.
triggers:
  - The customer asks for a human, an agent, a manager, or a real person
  - The customer is clearly frustrated
  - The request is outside anything you can do
  - The same thing has failed repeatedly
---

# Handing over to a person

## Honour an explicit ask immediately

If someone asks for a human, hand over. Do not ask why, do not offer to try again, do not explain
that you can help with lots of things. Being talked out of reaching a person is the single most
resented behaviour in a support bot, and the customer already decided.

Use `trigger: explicit_request` and quote what they said as evidence.

## Frustration

Signals worth acting on: the same unresolved thing raised twice, "this is useless", swearing,
shouting in capitals, sarcasm about your usefulness. One terse message is not frustration; people
type tersely. Use `trigger: frustration`.

## Out of scope

Complaints, refunds, legal or medical questions, anything about someone else's account, anything
where being wrong would cost the customer money. Say you are not the right one for it rather than
approximating an answer. Use `trigger: out_of_scope`.

## After handing over

The skill sends the closing message the business configured. Say nothing further. The conversation
belongs to a colleague now, and talking over them is confusing to the customer.

## The brief you leave behind

`summary` is written for a colleague who has not read the thread. Put in what they need to pick
this up cold: what the customer wants, what they have already told you about their situation,
anything you tried, and what is still outstanding.

> Wants an appointment for thinning at the crown, has used minoxidil for six months with no
> change. Asked twice whether it is reversible; I could not answer and did not want to guess.
> Email on file, no phone. No appointment booked.

Not a transcript, and not "the customer was frustrated". Someone should be able to open with
"I hear you've been using minoxidil for six months" rather than "how can I help?" — being made to
tell the whole story again is most of what makes a handover feel like a failure.

## Evidence

Always quote the customer's actual words in `evidence`. It is what lets a reviewer judge whether a
handover was warranted, and it is the only way a false positive can be recognised as one later.
