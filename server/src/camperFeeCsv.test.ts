import { CamperPaymentStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { runCamperFeeImportPreview } from "./lib/camperFeeCsv.js";

const adaCamper = {
  id: "camper-ada",
  firstName: "Ada",
  lastName: "Lovelace",
  paymentStatus: CamperPaymentStatus.unpaid,
};

describe("camperFeeCsv", () => {
  it("assumes empty fees paid is zero", () => {
    const csvText = "First Name,Last Name,Fees Due,Fees Paid\nAda,Lovelace,165,\n";

    const preview = runCamperFeeImportPreview(csvText, undefined, [adaCamper]);

    expect(preview.invalidRowCount).toBe(0);
    expect(preview.previewRows[0]?.feeDueCents).toBe(16500);
    expect(preview.previewRows[0]?.feePaidCents).toBe(0);
    expect(preview.previewRows[0]?.warnings).toEqual([]);
    expect(preview.payloads[0]).toMatchObject({
      camperId: "camper-ada",
      feeDueCents: 16500,
      feePaidCents: 0,
      paymentStatus: CamperPaymentStatus.unpaid,
    });
  });

  it("warns and assumes empty fees due is zero", () => {
    const csvText = "First Name,Last Name,Fees Due,Fees Paid\nAda,Lovelace,,\n";

    const preview = runCamperFeeImportPreview(csvText, undefined, [adaCamper]);

    expect(preview.invalidRowCount).toBe(0);
    expect(preview.previewRows[0]?.feeDueCents).toBe(0);
    expect(preview.previewRows[0]?.feePaidCents).toBe(0);
    expect(preview.previewRows[0]?.warnings).toContain(
      "Fees due is empty; importing will assume fees due is $0.00.",
    );
    expect(preview.rowWarningsFlat).toContain(
      "Row 2: Fees due is empty; importing will assume fees due is $0.00.",
    );
    expect(preview.payloads[0]).toMatchObject({
      camperId: "camper-ada",
      feeDueCents: 0,
      feePaidCents: 0,
      paymentStatus: CamperPaymentStatus.unpaid,
    });
  });
});
