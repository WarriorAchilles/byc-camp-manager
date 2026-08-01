import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createTransportMock } = vi.hoisted(() => ({
  createTransportMock: vi.fn(),
}));

vi.mock("nodemailer", () => ({
  default: { createTransport: createTransportMock },
}));

import { deliverEmail } from "./lib/emailDelivery.js";

const originalEnv = {
  EMAIL_TRANSPORT: process.env.EMAIL_TRANSPORT,
  SMTP_HOST: process.env.SMTP_HOST,
  SMTP_PORT: process.env.SMTP_PORT,
  SMTP_USER: process.env.SMTP_USER,
  SMTP_PASS: process.env.SMTP_PASS,
  EMAIL_FROM: process.env.EMAIL_FROM,
};

function restoreEnv(): void {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

describe("shared email delivery", () => {
  beforeEach(() => {
    createTransportMock.mockReset();
  });

  afterEach(() => {
    restoreEnv();
    vi.restoreAllMocks();
  });

  it("uses a non-network log transport and redacts recipient, subject, and body", async () => {
    process.env.EMAIL_TRANSPORT = "log";
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);

    const result = await deliverEmail({
      to: "private-recipient@example.test",
      templateKey: "worker_registration_confirmation",
      content: {
        subject: "Private worker subject",
        text: "Medical and legal response body",
        html: "<p>Medical and legal response body</p>",
      },
    });

    expect(result).toEqual({ status: "skipped_log" });
    expect(createTransportMock).not.toHaveBeenCalled();
    const logs = infoSpy.mock.calls.flat().join("\n");
    expect(logs).toContain("worker_registration_confirmation");
    expect(logs).toContain("skipped_log");
    expect(logs).not.toContain("private-recipient@example.test");
    expect(logs).not.toContain("Private worker subject");
    expect(logs).not.toContain("Medical and legal response body");
  });

  it("captures a provider message identifier when SMTP succeeds", async () => {
    process.env.EMAIL_TRANSPORT = "smtp";
    process.env.SMTP_HOST = "smtp.sendgrid.net";
    process.env.SMTP_PORT = "587";
    process.env.SMTP_USER = "apikey";
    process.env.SMTP_PASS = "test-only-secret";
    process.env.EMAIL_FROM = "verified@example.test";
    const sendMailMock = vi.fn().mockResolvedValue({ messageId: "provider-message-123" });
    createTransportMock.mockReturnValue({ sendMail: sendMailMock });
    vi.spyOn(console, "info").mockImplementation(() => undefined);

    const result = await deliverEmail({
      to: "recipient@example.test",
      templateKey: "family_registration_confirmation",
      content: { subject: "Confirmed", text: "Text", html: "<p>Text</p>" },
    });

    expect(result).toEqual({ status: "sent", providerMessageId: "provider-message-123" });
    expect(sendMailMock).toHaveBeenCalledWith(expect.objectContaining({
      attachments: [expect.objectContaining({
        filename: "byc-logo.jpg",
        cid: "byc-logo@believersyouthcamp.com",
        contentType: "image/jpeg",
        contentDisposition: "inline",
      })],
    }));
  });

  it("returns and logs only a safe code when the provider fails", async () => {
    process.env.EMAIL_TRANSPORT = "smtp";
    process.env.SMTP_HOST = "smtp.sendgrid.net";
    process.env.SMTP_PORT = "587";
    process.env.SMTP_USER = "apikey";
    process.env.SMTP_PASS = "test-only-secret";
    process.env.EMAIL_FROM = "verified@example.test";
    createTransportMock.mockReturnValue({
      sendMail: vi.fn().mockRejectedValue(
        Object.assign(
          new Error("Rejected private-recipient@example.test with full private body"),
          { code: "ETIMEDOUT" },
        ),
      ),
    });
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);

    const result = await deliverEmail({
      to: "private-recipient@example.test",
      templateKey: "family_registration_confirmation",
      content: {
        subject: "Private subject",
        text: "Full private body",
        html: "<p>Full private body</p>",
      },
    });

    expect(result).toEqual({ status: "failed", errorCode: "ETIMEDOUT" });
    const logs = infoSpy.mock.calls.flat().join("\n");
    expect(logs).toContain("ETIMEDOUT");
    expect(logs).not.toContain("private-recipient@example.test");
    expect(logs).not.toContain("Full private body");
  });
});
