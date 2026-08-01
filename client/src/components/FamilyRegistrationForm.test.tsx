import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  CashConfirmation,
  ReceiptBreakdown,
  type RegistrationReceipt,
} from "./FamilyRegistrationForm";
import {
  camperRequiresMedicalConsent,
  createAdditionalCamper,
  type CamperDraft,
} from "./familyRegistrationCamper";
import { RegistrationHomeLink } from "./RegistrationHomeLink";
import { registrationProgressLabels } from "./familyRegistrationProgress";

describe("family registration campers", () => {
  it("copies shared details from the first camper and resets camper-specific fields", () => {
    const firstCamper: CamperDraft = {
      firstName: "Taylor",
      middleName: "A",
      lastName: "Camper",
      dateOfBirth: "2012-04-05",
      gender: "female",
      useFamilyAddress: false,
      address: {
        streetAddress: "123 Camp Road",
        city: "Campville",
        stateOrProvince: "Ohio",
        postalCode: "43000",
        country: "United States",
      },
      camperCellPhone: "5551112222",
      guardianName: "Pat Guardian",
      guardianPhone: "5553334444",
      identifiesAsChristian: true,
      receivedHolyGhost: true,
      churchName: "Camp Church",
      pastorName: "Pastor Example",
      tShirtIntent: "Adult M",
      medicalNotes: "Shared note",
      allergies: "Peanuts",
      medications: "Daily medication",
      dietaryRestrictions: "Vegetarian",
      emergencyContactName: "Emergency Contact",
      emergencyContactPhone: "5557778888",
      specialNeeds: "Accessibility accommodation",
    };

    const additionalCamper = createAdditionalCamper(firstCamper);

    expect(additionalCamper).toEqual({
      ...firstCamper,
      firstName: "",
      middleName: "",
      lastName: "",
      dateOfBirth: "",
      gender: "",
      camperCellPhone: "",
      tShirtIntent: "",
      identifiesAsChristian: null,
      receivedHolyGhost: null,
      medicalNotes: "",
      allergies: "",
      medications: "",
      dietaryRestrictions: "",
      specialNeeds: "",
    });
    expect(additionalCamper.address).not.toBe(firstCamper.address);
  });
});

describe("family registration payment summary", () => {
  it("offers a return to the registration start after confirmation", () => {
    const html = renderToStaticMarkup(<RegistrationHomeLink />);

    expect(html).toContain('href="/register/family"');
    expect(html).toContain("Register another person");
  });

  it("renders the exact cash amount due after cash-at-camp confirmation", () => {
    const html = renderToStaticMarkup(<CashConfirmation totalDueCents={51000} />);

    expect(html).toContain("Registration is confirmed and remains unpaid.");
    expect(html).toContain("Bring exactly $510.00 to camp.");
  });

  it("renders merchandise lines and totals from the stored receipt summary", () => {
    const receipt: RegistrationReceipt = {
      registrationSubtotalCents: 16500,
      merchandiseSubtotalCents: 4000,
      discountCents: 0,
      totalDueCents: 20500,
      receiptLineItems: [
        {
          description: "Camp Shirt - Large - Taylor Camper",
          quantity: 2,
          unitPriceCents: 2000,
          discountCents: 0,
          lineTotalCents: 4000,
          lineType: "merchandise",
        },
      ],
    };

    const html = renderToStaticMarkup(<ReceiptBreakdown receipt={receipt} />);

    expect(html).toContain("Camp Shirt - Large - Taylor Camper");
    expect(html).toContain("Merchandise subtotal");
    expect(html).toContain("$40.00");
    expect(html).toContain("$205.00");
    expect(html).not.toContain("Multi-camper discounts");
  });

  it("omits empty merchandise and discount totals from the final receipt", () => {
    const receipt: RegistrationReceipt = {
      registrationSubtotalCents: 16500,
      merchandiseSubtotalCents: 0,
      discountCents: 0,
      totalDueCents: 16500,
      receiptLineItems: [{
        description: "Taylor Camper registration",
        quantity: 1,
        unitPriceCents: 16500,
        discountCents: 0,
        lineTotalCents: 16500,
        lineType: "registration",
      }],
    };

    const html = renderToStaticMarkup(<ReceiptBreakdown receipt={receipt} />);

    expect(html).not.toContain("Merchandise subtotal");
    expect(html).not.toContain("Multi-camper discounts");
    expect(html).toContain("Registration subtotal");
    expect(html).toContain("$165.00");
  });
});

describe("family registration progress", () => {
  it("omits merchandise when the active catalog is empty", () => {
    expect(registrationProgressLabels("family", false, true)).toEqual([
      "Parent or guardian",
      "Campers",
      "Medical authorization",
      "Payment",
    ]);
  });

  it("includes merchandise when an active item is available", () => {
    expect(registrationProgressLabels("self", true, false)).toEqual([
      "Your contact information",
      "Camper information",
      "Merchandise",
      "Payment",
    ]);
  });

  it("uses age on the first day of camp and exempts campers on their eighteenth birthday", () => {
    const campStartDate = new Date("2026-08-01T12:00:00.000Z");
    expect(camperRequiresMedicalConsent("2008-08-02", campStartDate)).toBe(true);
    expect(camperRequiresMedicalConsent("2008-08-01", campStartDate)).toBe(false);
    expect(camperRequiresMedicalConsent("1999-05-04", campStartDate)).toBe(false);
  });
});
