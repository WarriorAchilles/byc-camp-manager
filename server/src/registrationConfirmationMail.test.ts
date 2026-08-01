import { describe, expect, it } from "vitest";
import {
  buildFamilyRegistrationConfirmationContent,
  buildLeaderRegistrationConfirmationContent,
  buildWorkerRegistrationConfirmationContent,
} from "./lib/registrationConfirmationMail.js";

describe("registration confirmation templates", () => {
  it("renders an itemized cash family receipt, merchandise, camp dates, and posted-QR instructions", () => {
    const content = buildFamilyRegistrationConfirmationContent({
      campName: "BYC 2099",
      campStartDate: new Date("2099-07-01T12:00:00Z"),
      campEndDate: new Date("2099-07-07T12:00:00Z"),
      campInformation:
        "Check-in after 4:00 p.m. Bring bedding. Do not use https://admin.example.test/self-check-in/secret-token before arrival.",
      guardianName: "Jamie & Family",
      camperNames: ["Taylor Camper", "Jordan Camper"],
      receiptLines: [
        {
          description: "Taylor Camper registration",
          quantity: 1,
          unitPriceCents: 16500,
          originalUnitPriceCents: null,
          discountCents: 0,
          lineTotalCents: 16500,
        },
        {
          description: "Jordan Camper registration",
          quantity: 1,
          unitPriceCents: 9000,
          originalUnitPriceCents: 16500,
          discountCents: 7500,
          lineTotalCents: 9000,
        },
        {
          description: "Camp shirt (size M)",
          quantity: 2,
          unitPriceCents: 2000,
          originalUnitPriceCents: null,
          discountCents: 0,
          lineTotalCents: 4000,
        },
      ],
      merchandiseLines: [{
        itemName: "Camp shirt",
        selectedOptions: { size: "M" },
        quantity: 2,
        lineTotalCents: 4000,
      }],
      registrationSubtotalCents: 33000,
      merchandiseSubtotalCents: 4000,
      discountCents: 7500,
      totalDueCents: 29500,
      amountPaidCents: 0,
      paymentMethod: "cash",
    });

    expect(content.text).toContain("Taylor Camper registration: $165.00");
    expect(content.text).toContain("family discount $75.00");
    expect(content.text).toContain("Camp shirt (size: M) × 2: $40.00");
    expect(content.text).toContain("PAY AT CAMP WITH CASH: Bring exactly $295.00");
    expect(content.text).toContain("July 1, 2099 through July 7, 2099");
    expect(content.text).toContain("scan the posted self-check-in QR code");
    expect(content.text).not.toContain("secret-token");
    expect(content.html).not.toContain("https://admin.example.test/self-check-in/");
    expect(content.html).toContain("Jamie &amp; Family");
  });

  it("renders Stripe paid status without a cash balance reminder", () => {
    const content = buildFamilyRegistrationConfirmationContent({
      campName: "BYC",
      campStartDate: new Date("2099-07-01T12:00:00Z"),
      campEndDate: new Date("2099-07-07T12:00:00Z"),
      campInformation: "",
      guardianName: "Paid Guardian",
      camperNames: ["Paid Camper"],
      receiptLines: [{
        description: "Paid Camper registration",
        quantity: 1,
        unitPriceCents: 16500,
        originalUnitPriceCents: null,
        discountCents: 0,
        lineTotalCents: 16500,
      }],
      merchandiseLines: [],
      registrationSubtotalCents: 16500,
      merchandiseSubtotalCents: 0,
      discountCents: 0,
      totalDueCents: 16500,
      amountPaidCents: 16500,
      paymentMethod: "stripe",
    });

    expect(content.text).toContain("Payment received via Stripe: $165.00");
    expect(content.text).toContain("No merchandise was ordered");
    expect(content.text).not.toContain("PAY AT CAMP WITH CASH");
    expect(content.text).not.toContain("Merchandise subtotal:");
    expect(content.text).not.toContain("Discounts:");
    expect(content.html).not.toContain("Merchandise subtotal:");
    expect(content.html).not.toContain("Discounts:");
  });

  it("renders a complete worker response copy and required reminders without a self-check-in URL", () => {
    const content = buildWorkerRegistrationConfirmationContent({
      campName: "BYC Worker Camp",
      campStartDate: new Date("2099-07-01T12:00:00Z"),
      campEndDate: new Date("2099-07-07T12:00:00Z"),
      campInformation: "Camp address and contact. /self-check-in/private-token",
      responses: {
        email: "alex.worker@example.test",
        firstName: "Alex",
        lastName: "Worker",
        dateOfBirth: new Date("1988-04-12T12:00:00Z"),
        gender: "female",
        cellPhone: "5551234567",
        altPhone: null,
        streetAddress: "100 Camp Road",
        city: "Indianapolis",
        stateOrProvince: "IN",
        postalCode: "46201",
        country: "United States",
        faithServingResponse: "I have faithfully served the Lord.",
        churchName: "Believers Church",
        pastorName: "Pastor Example",
        pastorPhone: "5552223333",
        taskPreferenceFirst: "Kitchen",
        taskPreferenceSecond: "Crafts",
        taskPreferenceThird: "Snack Bar",
        tShirtSize: "M",
      },
    });

    expect(content.text).toContain("Email: alex.worker@example.test");
    expect(content.text).toContain("Faith and serving response: I have faithfully served the Lord.");
    expect(content.text).toContain("First task preference: Kitchen");
    expect(content.text).toContain("T-shirt size: M");
    expect(content.text).toContain("written testimony");
    expect(content.text).toContain("pastor's letter of recommendation");
    expect(content.text).toContain("same camp rules as campers");
    expect(content.text).toContain("scan the posted self-check-in QR code");
    expect(content.text).not.toContain("private-token");
    expect(content.html).not.toContain("/self-check-in/private-token");
  });

  it("renders a complete leader response copy and arrival guidance without a self-check-in URL", () => {
    const content = buildLeaderRegistrationConfirmationContent({
      campName: "BYC Leader Camp",
      campStartDate: new Date("2099-07-01T12:00:00Z"),
      campEndDate: new Date("2099-07-07T12:00:00Z"),
      campInformation: "Camp address and contact. /self-check-in/private-leader-token",
      responses: {
        email: "taylor.leader@example.test",
        firstName: "Taylor",
        lastName: "Leader",
        dateOfBirth: new Date("1980-01-02T12:00:00Z"),
        gender: "female",
        phone: "5551234567",
        altPhone: null,
        streetAddress: "1 Camp Road",
        city: "Lebanon",
        stateOrProvince: "PA",
        postalCode: "17042",
        country: "United States",
        maritalStatus: "Married",
        faithServingResponse: "Faithfully serving for twenty years.",
        churchName: "Bible Church",
        pastorName: "Pastor Example",
        pastorPhone: "5559876543",
        roleLabel: "10-13",
        tShirtSize: "L",
      },
    });

    expect(content.subject).toContain("Leader registration received");
    expect(content.text).toContain("Email: taylor.leader@example.test");
    expect(content.text).toContain("Marital status: Married");
    expect(content.text).toContain("Faith and serving response: Faithfully serving for twenty years.");
    expect(content.text).toContain("Preferred age group: 10-13");
    expect(content.text).toContain("T-shirt size: L");
    expect(content.text).toContain("scan the posted self-check-in QR code");
    expect(content.text).not.toContain("private-leader-token");
    expect(content.html).not.toContain("/self-check-in/private-leader-token");
  });
});
