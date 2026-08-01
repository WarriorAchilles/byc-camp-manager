import { describe, expect, it } from "vitest";
import { buildCheckInConfirmationContent } from "./lib/checkInConfirmationMail.js";

describe("buildCheckInConfirmationContent", () => {
  it("includes camper name, dorm label, and formatted check-in time", () => {
    const checkedInAt = new Date("2099-07-02T15:30:00.000Z");
    const { text, subject, html } = buildCheckInConfirmationContent({
      to: "parent@example.com",
      camperFullName: "Jamie Lee Camper",
      dormLabel: "Cabin North",
      checkedInAt,
    });
    expect(subject).toContain("Jamie Lee Camper");
    expect(text).toContain("Jamie Lee Camper");
    expect(text).toContain("Cabin North");
    expect(text).toContain("July");
    expect(text).toContain("2099");
    expect(html).toContain('<img src="cid:byc-logo@believersyouthcamp.com"');
    expect(html).toContain("Check-in complete");
    expect(html).toContain("Cabin North");
  });

  it("uses explicit unassigned dorm wording in body", () => {
    const { text } = buildCheckInConfirmationContent({
      to: "p@example.com",
      camperFullName: "Pat Doe",
      dormLabel: "unassigned",
      checkedInAt: new Date("2099-07-01T12:00:00.000Z"),
    });
    expect(text).toContain("unassigned");
  });
});
