import { describe, expect, it } from "vitest";
import { CamperPaymentStatus, Gender } from "@prisma/client";
import { adminCamperCreateBodySchema } from "./adminCampYearCampers.js";

const requiredCamperFields = {
  firstName: "Taylor",
  lastName: "Camper",
  dateOfBirth: "2012-05-01",
  gender: Gender.male,
  paymentStatus: CamperPaymentStatus.unpaid,
};

describe("admin camper create validation", () => {
  it("allows guardian information to be omitted for manual entry", () => {
    expect(adminCamperCreateBodySchema.parse(requiredCamperFields)).toMatchObject({
      guardianName: "",
      guardianEmail: "",
      guardianPhone: "",
    });
  });

  it("allows blank guardian information but validates a provided email", () => {
    expect(adminCamperCreateBodySchema.safeParse({
      ...requiredCamperFields,
      guardianName: "",
      guardianEmail: "",
      guardianPhone: "",
    }).success).toBe(true);

    expect(adminCamperCreateBodySchema.safeParse({
      ...requiredCamperFields,
      guardianEmail: "not-an-email",
    }).success).toBe(false);
  });
});
