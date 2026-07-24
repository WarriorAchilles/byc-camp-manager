import { describe, expect, it } from "vitest";
import { validFamilySubmission } from "./familyRegistrationTestData.js";
import {
  calculateRegistrationPricing,
  PricingError,
  type MerchandiseCatalogItem,
} from "./lib/registrationPricing.js";

const shirtId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const hatId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const merchandiseItems: MerchandiseCatalogItem[] = [
  {
    id: shirtId,
    name: "Camp Shirt",
    priceCents: 2000,
    availableOptions: ["Small", "Large"],
    ownership: "camper",
    isActive: true,
  },
  {
    id: hatId,
    name: "Family Hat",
    priceCents: 1500,
    availableOptions: [],
    ownership: "family",
    isActive: true,
  },
];

function campers(count: number) {
  const camper = validFamilySubmission().campers[0]!;
  return Array.from({ length: count }, (_, index) => ({
    ...camper,
    firstName: `Camper${index + 1}`,
  }));
}

const camp = {
  feeCutoverAt: new Date("2026-06-10T12:00:00.000Z"),
  earlyCamperFeeCents: 16500,
  lateCamperFeeCents: 18000,
  thirdPlusCamperFeeCents: 9000,
};

describe("calculateRegistrationPricing", () => {
  it.each([
    [1, [16500], 16500, 0],
    [2, [16500, 16500], 33000, 0],
    [3, [16500, 16500, 9000], 49500, 7500],
    [4, [16500, 16500, 9000, 9000], 66000, 15000],
  ])("prices %i campers before cutover", (count, fees, subtotal, discount) => {
    const result = calculateRegistrationPricing({
      camp,
      campers: campers(count),
      merchandiseSelections: [],
      merchandiseItems: [],
      now: new Date("2026-06-09T12:00:00.000Z"),
    });
    expect(result.camperFees).toEqual(fees);
    expect(result.registrationSubtotalCents).toBe(subtotal);
    expect(result.discountCents).toBe(discount);
    expect(result.totalDueCents).toBe(subtotal - discount);
  });

  it.each([
    [1, [18000], 18000, 0],
    [2, [18000, 18000], 36000, 0],
    [3, [18000, 18000, 9000], 54000, 9000],
    [4, [18000, 18000, 9000, 9000], 72000, 18000],
  ])("prices %i campers at or after cutover", (count, fees, subtotal, discount) => {
    const result = calculateRegistrationPricing({
      camp,
      campers: campers(count),
      merchandiseSelections: [],
      merchandiseItems: [],
      now: new Date("2026-06-10T12:00:00.000Z"),
    });
    expect(result.camperFees).toEqual(fees);
    expect(result.registrationSubtotalCents).toBe(subtotal);
    expect(result.discountCents).toBe(discount);
    expect(result.totalDueCents).toBe(subtotal - discount);
  });

  it("snapshots merchandise prices at the cutover", () => {
    const result = calculateRegistrationPricing({
      camp,
      campers: campers(3),
      merchandiseItems,
      merchandiseSelections: [
        { merchandiseItemId: shirtId, selectedOption: "Large", quantity: 2, camperIndex: 2 },
        { merchandiseItemId: hatId, selectedOption: null, quantity: 1, camperIndex: null },
      ],
      now: new Date("2026-06-10T12:00:00.000Z"),
    });
    expect(result.camperFees).toEqual([18000, 18000, 9000]);
    expect(result.discountCents).toBe(9000);
    expect(result.merchandiseSubtotalCents).toBe(5500);
    expect(result.totalDueCents).toBe(50500);
    expect(result.merchandiseLines).toEqual(expect.arrayContaining([
      expect.objectContaining({
        merchandiseItemId: shirtId,
        itemNameSnapshot: "Camp Shirt",
        selectedOptionsSnapshot: { option: "Large" },
        unitPriceCents: 2000,
        lineTotalCents: 4000,
      }),
    ]));
  });

  it("rejects inactive items, invalid options, and invalid ownership", () => {
    const base = {
      camp,
      campers: campers(1),
      merchandiseItems,
      now: new Date("2026-06-09T12:00:00.000Z"),
    };
    expect(() => calculateRegistrationPricing({
      ...base,
      merchandiseSelections: [{ merchandiseItemId: shirtId, selectedOption: "Medium", quantity: 1, camperIndex: 0 }],
    })).toThrow(new PricingError("merchandise_option_invalid"));
    expect(() => calculateRegistrationPricing({
      ...base,
      merchandiseSelections: [{ merchandiseItemId: hatId, selectedOption: null, quantity: 1, camperIndex: 0 }],
    })).toThrow(new PricingError("merchandise_owner_invalid"));
    expect(() => calculateRegistrationPricing({
      ...base,
      merchandiseItems: merchandiseItems.map((item) => ({ ...item, isActive: false })),
      merchandiseSelections: [{ merchandiseItemId: hatId, selectedOption: null, quantity: 1, camperIndex: null }],
    })).toThrow(new PricingError("merchandise_unavailable"));
  });
});
