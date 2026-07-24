import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WorkerRegistrationConfirmation } from "./WorkerRegistrationForm";

describe("worker registration confirmation", () => {
  it("renders testimony, recommendation, rules, arrival, and no-tuition information", () => {
    const html = renderToStaticMarkup(
      <WorkerRegistrationConfirmation
        registrationId="worker-registration-reference"
        guidance={{
          testimony: "Provide a written testimony and pastor's letter of recommendation.",
          rules: "Workers follow the same camp rules as campers.",
          arrival: "Scan the posted self-check-in QR code after arriving.",
          payment: "Workers do not pay camp tuition through registration.",
        }}
      />,
    );

    expect(html).toContain("Worker registration received");
    expect(html).toContain("worker-registration-reference");
    expect(html).toContain("pastor&#x27;s letter of recommendation");
    expect(html).toContain("same camp rules as campers");
    expect(html).toContain("self-check-in QR code");
    expect(html).toContain("do not pay camp tuition");
  });
});
