import type { ReceiptLineType, MerchandiseOwnership } from "@prisma/client";
import type { FamilySubmission } from "./familyRegistration.js";

export type CampPricingConfiguration = {
  feeCutoverAt: Date | null;
  earlyCamperFeeCents: number | null;
  lateCamperFeeCents: number | null;
  thirdPlusCamperFeeCents: number | null;
};

export type MerchandiseCatalogItem = {
  id: string;
  name: string;
  priceCents: number;
  availableOptions: unknown;
  ownership: MerchandiseOwnership;
  isActive: boolean;
};

export type CalculatedReceiptLine = {
  lineType: ReceiptLineType;
  description: string;
  quantity: number;
  unitPriceCents: number;
  originalUnitPriceCents: number | null;
  discountCents: number;
  lineTotalCents: number;
  pricingSnapshot: Record<string, unknown>;
  sortOrder: number;
};

export type CalculatedMerchandiseLine = {
  merchandiseItemId: string;
  camperIndex: number | null;
  ownership: MerchandiseOwnership;
  itemNameSnapshot: string;
  selectedOptionsSnapshot: { option: string } | null;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
};

export class PricingError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

function optionsFromJson(value: unknown): string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string") ? value : [];
}

export function calculateRegistrationPricing(input: {
  camp: CampPricingConfiguration;
  campers: FamilySubmission["campers"];
  merchandiseSelections: FamilySubmission["merchandiseSelections"];
  merchandiseItems: MerchandiseCatalogItem[];
  now: Date;
}) {
  const early = input.camp.feeCutoverAt === null || input.now < input.camp.feeCutoverAt;
  const baseRateCents = early
    ? (input.camp.earlyCamperFeeCents ?? 0)
    : (input.camp.lateCamperFeeCents ?? input.camp.earlyCamperFeeCents ?? 0);
  const thirdPlusRateCents = input.camp.thirdPlusCamperFeeCents ?? baseRateCents;
  const camperFees = input.campers.map((_, index) => index < 2 ? baseRateCents : thirdPlusRateCents);
  const registrationSubtotalCents = baseRateCents * input.campers.length;
  const discountCents = camperFees.reduce((sum, fee) => sum + Math.max(baseRateCents - fee, 0), 0);
  const receiptLines: CalculatedReceiptLine[] = input.campers.map((camper, index) => ({
    lineType: "registration",
    description: `Registration - ${camper.firstName} ${camper.lastName}`.trim(),
    quantity: 1,
    unitPriceCents: baseRateCents,
    originalUnitPriceCents: null,
    discountCents: 0,
    lineTotalCents: baseRateCents,
    pricingSnapshot: { camperIndex: index, appliedFeeCents: camperFees[index] },
    sortOrder: index * 2,
  }));
  input.campers.forEach((camper, index) => {
    const camperDiscount = Math.max(baseRateCents - (camperFees[index] ?? baseRateCents), 0);
    if (camperDiscount > 0) {
      receiptLines.push({
        lineType: "discount",
        description: `Third-and-additional camper discount - ${camper.firstName} ${camper.lastName}`.trim(),
        quantity: 1,
        unitPriceCents: -camperDiscount,
        originalUnitPriceCents: baseRateCents,
        discountCents: camperDiscount,
        lineTotalCents: -camperDiscount,
        pricingSnapshot: { camperIndex: index, appliedFeeCents: camperFees[index] },
        sortOrder: index * 2 + 1,
      });
    }
  });

  const itemById = new Map(input.merchandiseItems.map((item) => [item.id, item]));
  const merchandiseLines: CalculatedMerchandiseLine[] = input.merchandiseSelections.map((selection, index) => {
    const item = itemById.get(selection.merchandiseItemId);
    if (!item || !item.isActive) throw new PricingError("merchandise_unavailable");
    const options = optionsFromJson(item.availableOptions);
    if ((options.length === 0 && selection.selectedOption !== null) ||
        (options.length > 0 && (!selection.selectedOption || !options.includes(selection.selectedOption)))) {
      throw new PricingError("merchandise_option_invalid");
    }
    if ((item.ownership === "family" && selection.camperIndex !== null) ||
        (item.ownership === "camper" &&
          (selection.camperIndex === null || selection.camperIndex >= input.campers.length))) {
      throw new PricingError("merchandise_owner_invalid");
    }
    const lineTotalCents = item.priceCents * selection.quantity;
    const ownerName = selection.camperIndex === null
      ? null
      : `${input.campers[selection.camperIndex]!.firstName} ${input.campers[selection.camperIndex]!.lastName}`.trim();
    const description = [item.name, selection.selectedOption, ownerName].filter(Boolean).join(" - ");
    receiptLines.push({
      lineType: "merchandise",
      description,
      quantity: selection.quantity,
      unitPriceCents: item.priceCents,
      originalUnitPriceCents: null,
      discountCents: 0,
      lineTotalCents,
      pricingSnapshot: {
        merchandiseItemId: item.id,
        ownership: item.ownership,
        selectedOption: selection.selectedOption,
        camperIndex: selection.camperIndex,
      },
      sortOrder: 1_000 + index,
    });
    return {
      merchandiseItemId: item.id,
      camperIndex: selection.camperIndex,
      ownership: item.ownership,
      itemNameSnapshot: item.name,
      selectedOptionsSnapshot: selection.selectedOption ? { option: selection.selectedOption } : null,
      quantity: selection.quantity,
      unitPriceCents: item.priceCents,
      lineTotalCents,
    };
  });
  const merchandiseSubtotalCents = merchandiseLines.reduce((sum, line) => sum + line.lineTotalCents, 0);
  return {
    camperFees,
    registrationSubtotalCents,
    merchandiseSubtotalCents,
    discountCents,
    totalDueCents: registrationSubtotalCents - discountCents + merchandiseSubtotalCents,
    receiptLines: receiptLines.sort((a, b) => a.sortOrder - b.sortOrder),
    merchandiseLines,
    pricingSnapshot: {
      calculatedAt: input.now.toISOString(),
      feeSchedule: early ? "early" : "late",
      feeCutoverAt: input.camp.feeCutoverAt?.toISOString() ?? null,
      earlyCamperFeeCents: input.camp.earlyCamperFeeCents,
      lateCamperFeeCents: input.camp.lateCamperFeeCents,
      thirdPlusCamperFeeCents: input.camp.thirdPlusCamperFeeCents,
      baseRateCents,
      camperFees,
    },
  };
}
