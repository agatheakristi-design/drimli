import assert from "node:assert/strict";
import test from "node:test";
import {
  GOOGLE_REVIEW_DELAY_MS,
  isGoogleReviewAutomationEnabled,
  processGoogleReviewRequest,
} from "./googleReviewRequests.ts";

const now = new Date("2026-08-11T12:00:00.000Z");

test("automatic mode is disabled unless explicitly enabled", () => {
  assert.equal(isGoogleReviewAutomationEnabled(undefined), false);
  assert.equal(isGoogleReviewAutomationEnabled("false"), false);
  assert.equal(isGoogleReviewAutomationEnabled("true"), true);
  assert.equal(isGoogleReviewAutomationEnabled(" TRUE "), true);
});

function candidate(overrides = {}) {
  return {
    appointmentId: "appointment-1",
    status: "confirmed",
    endDateTime: new Date(
      now.getTime() - GOOGLE_REVIEW_DELAY_MS
    ).toISOString(),
    clientEmail: "client@example.com",
    sentAt: null,
    providerName: "Florence Dhuy",
    googlePlaceId: "ChIJ1234567890",
    ...overrides,
  };
}

function dependencies() {
  const calls = { urls: [], emails: [], marks: [] };
  return {
    calls,
    value: {
      async getReviewUrl(placeId) {
        calls.urls.push(placeId);
        return "https://www.google.com/maps/place/example";
      },
      async sendEmail(payload) {
        calls.emails.push(payload);
      },
      async markSent(appointmentId, sentAt) {
        calls.marks.push({ appointmentId, sentAt });
      },
    },
  };
}

test("confirmed appointment with Google profile and email is sent once", async () => {
  const deps = dependencies();
  assert.equal(await processGoogleReviewRequest(candidate(), deps.value, now), "sent");
  assert.equal(deps.calls.emails.length, 1);
  assert.equal(deps.calls.marks.length, 1);
  assert.equal(deps.calls.emails[0].providerName, "Florence Dhuy");
  assert.equal(
    deps.calls.emails[0].reviewUrl,
    "https://www.google.com/maps/place/example"
  );
});

for (const [name, overrides] of [
  ["missing Google profile", { googlePlaceId: null }],
  ["cancelled appointment", { status: "cancelled" }],
  ["already sent appointment", { sentAt: "2026-08-11T11:59:00.000Z" }],
  ["missing client email", { clientEmail: null }],
  [
    "appointment before end plus five minutes",
    { endDateTime: new Date(now.getTime() - GOOGLE_REVIEW_DELAY_MS + 1).toISOString() },
  ],
]) {
  test(`${name} is skipped`, async () => {
    const deps = dependencies();
    assert.equal(
      await processGoogleReviewRequest(candidate(overrides), deps.value, now),
      "skipped"
    );
    assert.equal(deps.calls.emails.length, 0);
    assert.equal(deps.calls.marks.length, 0);
  });
}

test("appointment after the five-minute delay is sent", async () => {
  const deps = dependencies();
  const overdue = candidate({
    endDateTime: new Date(
      now.getTime() - GOOGLE_REVIEW_DELAY_MS - 1
    ).toISOString(),
  });
  assert.equal(await processGoogleReviewRequest(overdue, deps.value, now), "sent");
});

test("email failure never marks the appointment as sent", async () => {
  const deps = dependencies();
  deps.value.sendEmail = async () => {
    throw new Error("send failed");
  };
  await assert.rejects(
    processGoogleReviewRequest(candidate(), deps.value, now),
    /send failed/
  );
  assert.equal(deps.calls.marks.length, 0);
});

test("Google Places write-a-review URL is used", async () => {
  const originalFetch = globalThis.fetch;
  process.env.GOOGLE_PLACES_API_KEY = "test-key";
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        googleMapsLinks: {
          writeAReviewUri: "https://www.google.com/maps/place/example",
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );

  try {
    const { fetchGoogleReviewUrl } = await import("./googlePlaces.ts");
    assert.equal(
      await fetchGoogleReviewUrl("ChIJ1234567890"),
      "https://www.google.com/maps/place/example"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
