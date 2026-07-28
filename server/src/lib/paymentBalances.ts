import prismaClientPkg, {
  type CamperPaymentStatus as CamperPaymentStatusType,
  type Prisma,
} from "@prisma/client";

const { CamperPaymentStatus } = prismaClientPkg;

type Db = Prisma.TransactionClient;

export function remainingRegistrationFeeCents(input: {
  feeDueCents: number | null;
  feePaidCents: number | null;
}): number {
  return Math.max((input.feeDueCents ?? 0) - (input.feePaidCents ?? 0), 0);
}

export function hasOutstandingRegistrationFee(input: {
  feeDueCents: number | null;
  feePaidCents: number | null;
  paymentStatus?: string;
}): boolean {
  if (input.feeDueCents === null) {
    return input.paymentStatus === CamperPaymentStatus.unpaid;
  }
  return remainingRegistrationFeeCents(input) > 0;
}

export function amountBalanceState(input: {
  feeDueCents: number | null;
  feePaidCents: number | null;
}): "unpaid" | "partially_paid" | "paid" {
  const due = Math.max(input.feeDueCents ?? 0, 0);
  const paid = Math.max(input.feePaidCents ?? 0, 0);
  if (due === 0 || paid >= due) return "paid";
  return paid === 0 ? "unpaid" : "partially_paid";
}

export async function syncFamilyRegistrationBalance(
  tx: Db,
  familyRegistrationId: string,
  completedBy?: "check" | "cash" | CamperPaymentStatusType,
): Promise<void> {
  const registration = await tx.familyRegistration.findUnique({
    where: { id: familyRegistrationId },
    select: {
      amountPaidCents: true,
      totalDueCents: true,
      merchandiseSubtotalCents: true,
      paymentStatus: true,
      campers: {
        select: { feeDueCents: true, feePaidCents: true },
      },
    },
  });
  if (!registration) return;
  const paidRegistrationFees = registration.campers.reduce(
    (sum, camper) => sum + Math.min(
      Math.max(camper.feePaidCents ?? 0, 0),
      Math.max(camper.feeDueCents ?? 0, 0),
    ),
    0,
  );
  // Family Stripe checkout is the only existing flow that pays merchandise.
  // Pay-at-camp and church allocations apply to registration fees only.
  const merchandisePaid = registration.paymentStatus === CamperPaymentStatus.paid_stripe
    ? registration.merchandiseSubtotalCents
    : 0;
  const amountPaidCents = Math.min(
    paidRegistrationFees + merchandisePaid,
    registration.totalDueCents,
  );
  const fullyPaid = amountPaidCents >= registration.totalDueCents;
  const paymentStatus = registration.paymentStatus === CamperPaymentStatus.paid_stripe
    ? CamperPaymentStatus.paid_stripe
    : fullyPaid && completedBy
      ? completedBy === "check"
        ? CamperPaymentStatus.paid_church_check
        : completedBy === "cash"
          ? CamperPaymentStatus.paid_church_cash
          : completedBy
      : fullyPaid && registration.paymentStatus === CamperPaymentStatus.paid_cash
        ? CamperPaymentStatus.paid_cash
        : CamperPaymentStatus.unpaid;
  await tx.familyRegistration.update({
    where: { id: familyRegistrationId },
    data: { amountPaidCents, paymentStatus },
  });
}
