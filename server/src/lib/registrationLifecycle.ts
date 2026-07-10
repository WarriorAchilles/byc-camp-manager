import prismaClientPkg from "@prisma/client";

const { RegistrationPaymentMethod, RegistrationState } = prismaClientPkg;

export type RegistrationLifecycleState =
  (typeof RegistrationState)[keyof typeof RegistrationState];
export type RegistrationLifecyclePaymentMethod =
  (typeof RegistrationPaymentMethod)[keyof typeof RegistrationPaymentMethod];

const transitions: Record<RegistrationLifecycleState, ReadonlySet<RegistrationLifecycleState>> = {
  [RegistrationState.pending_payment]: new Set([
    RegistrationState.confirmed,
    RegistrationState.expired,
    RegistrationState.cancelled,
  ]),
  [RegistrationState.confirmed]: new Set([RegistrationState.cancelled]),
  [RegistrationState.expired]: new Set(),
  [RegistrationState.cancelled]: new Set(),
};

/**
 * Cash-at-camp submissions are confirmed immediately and remain unpaid. Stripe
 * submissions wait for payment confirmation. A pending Stripe registration has
 * no implicit timeout: if a future flow supplies an expiresAt, expiration must
 * be explicit and the terminal row must then be deleted.
 */
export function initialRegistrationState(
  paymentMethod: RegistrationLifecyclePaymentMethod,
): RegistrationLifecycleState {
  return paymentMethod === RegistrationPaymentMethod.cash
    ? RegistrationState.confirmed
    : RegistrationState.pending_payment;
}

export function canTransitionRegistration(
  from: RegistrationLifecycleState,
  to: RegistrationLifecycleState,
): boolean {
  return transitions[from].has(to);
}

export function assertRegistrationTransition(
  from: RegistrationLifecycleState,
  to: RegistrationLifecycleState,
): void {
  if (!canTransitionRegistration(from, to)) {
    throw new Error(`Registration cannot transition from ${from} to ${to}`);
  }
}

/** Pending payment and confirmed submissions both reserve every camper place. */
export function registrationReservesCapacity(state: RegistrationLifecycleState): boolean {
  return state === RegistrationState.pending_payment || state === RegistrationState.confirmed;
}

/** Product policy: terminal registrations are removed instead of retained for admin audit. */
export function registrationMustBeDeleted(state: RegistrationLifecycleState): boolean {
  return state === RegistrationState.expired || state === RegistrationState.cancelled;
}

