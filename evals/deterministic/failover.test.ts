import { isWorthFailingOver } from "@harness/core";
import { APICallError } from "ai";
import { describe, expect, it } from "vitest";

/**
 * What counts as worth trying the next provider for. Tested directly rather than through
 * `callModel`: `APICallError.isInstance` matches a symbol a dual-resolved package would break.
 */

const apiError = (statusCode: number, message: string) =>
  new APICallError({
    message,
    url: "https://example.test",
    requestBodyValues: {},
    statusCode,
    responseHeaders: {},
    responseBody: message,
  });

describe("isWorthFailingOver", () => {
  it("fails over when the Anthropic balance is spent", () => {
    // Reported as a 400, which the status rule alone would call permanent — and it is not: our
    // request was fine, this vendor cannot serve it, and the next one can.
    expect(
      isWorthFailingOver(
        apiError(400, "Your credit balance is too low to access the Anthropic API."),
      ),
    ).toBe(true);
  });

  it("fails over on an OpenAI quota error", () => {
    expect(
      isWorthFailingOver(apiError(400, "You exceeded your current quota, please check your plan.")),
    ).toBe(true);
  });

  it("fails over when rate limited or the provider is down", () => {
    expect(isWorthFailingOver(apiError(429, "rate limited"))).toBe(true);
    expect(isWorthFailingOver(apiError(503, "upstream unavailable"))).toBe(true);
    expect(isWorthFailingOver(apiError(408, "timeout"))).toBe(true);
  });

  it("fails over when a vendor retires the model", () => {
    // A 404, and permanent for this entry — but the next entry names a different model entirely.
    expect(
      isWorthFailingOver(
        apiError(404, "This model models/gemini-2.0-flash is no longer available."),
      ),
    ).toBe(true);
  });

  it("does not fail over when our own request was malformed", () => {
    // Every provider rejects a bad request identically; failing over turns one error into three.
    expect(isWorthFailingOver(apiError(400, "messages: expected an array"))).toBe(false);
    expect(isWorthFailingOver(apiError(401, "invalid api key"))).toBe(false);
  });

  it("fails over on a transport error, which carries no status", () => {
    expect(isWorthFailingOver(new Error("socket hang up"))).toBe(true);
  });
});
