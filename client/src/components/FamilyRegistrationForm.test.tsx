import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  CashConfirmation,
  ReceiptBreakdown,
  type RegistrationReceipt,
} from "./FamilyRegistrationForm";

describe("family registration payment summary", () => {
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
  });
});
