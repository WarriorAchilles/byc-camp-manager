import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LeaderRegistrationConfirmation } from "./LeaderRegistrationForm";

describe("leader registration confirmation", () => {
  it("renders the saved registration reference", () => {
    const html = renderToStaticMarkup(
      <LeaderRegistrationConfirmation registrationId="leader-registration-reference" />,
    );
    expect(html).toContain("Leader registration received");
    expect(html).toContain("leader-registration-reference");
    expect(html).toContain("available to camp staff");
    expect(html).toContain('href="/register/family"');
    expect(html).toContain("Register another person");
  });
});
