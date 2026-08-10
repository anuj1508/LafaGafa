---
name: ghl-api-endpoint
description: Add a typed method to the GoHighLevel client in packages/ghl. Use when the harness needs a CRM capability it cannot currently reach — contacts, conversations, calendars, users.
---

# Adding a GHL client method

## Before writing anything

Read the actual endpoint documentation and confirm three things, because getting any of them
wrong produces a method that typechecks and fails at runtime:

- The **`Version` header** the endpoint expects. It is not uniform across GHL — conversations,
  contacts, and calendars have differed. Pass it explicitly per call; never rely on a default.
- Whether the endpoint is **location-scoped or company-scoped**, which decides the `resourceId`
  the caller passes to `requests()`.
- Which **OAuth scope** it needs, and whether the app already requests it. A missing scope is a
  403 that looks exactly like an expired token.

## What to write

1. The method on the client, taking a typed input and returning a parsed, typed result.
2. A **zod schema for the response**, parsed before returning. GHL responses vary by plan and by
   endpoint version; an unvalidated response becomes an undefined three call frames away.
3. Errors flow through `GhlApiError` — do not add a new error type. If a caller needs to branch on
   something the existing `GhlErrorKind` cannot express, that is a real design change worth
   raising rather than a quiet addition.
4. A **mock handler in the same commit**, including the failure fixtures that matter for this
   endpoint: 401, 429, and whichever 4xx represents a business-rule rejection (a taken slot, a
   protected field). Evals run offline; an endpoint with no mock cannot be tested.

## Traces

Every call emits a `crm_call` event with method, path, status, and latency. This is what lets a
reviewer see that the agent claimed a booking because the API confirmed it, rather than because
the model said so.

## Check before you claim done

- The response schema is parsed, not cast.
- The mock covers at least one failure the caller must handle.
- No `any`, no `as`.
