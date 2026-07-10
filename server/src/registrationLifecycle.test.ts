import prismaClientPkg from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  assertRegistrationTransition,
  canTransitionRegistration,
  initialRegistrationState,
  registrationMustBeDeleted,
  registrationReservesCapacity,
} from "./lib/registrationLifecycle.js";

const { RegistrationPaymentMethod, RegistrationState } = prismaClientPkg;

describe("registration lifecycle", () => {
  it("confirms cash-at-camp registrations and waits for Stripe payment", () => {
    expect(initialRegistrationState(RegistrationPaymentMethod.cash)).toBe(
      RegistrationState.confirmed,
    );
    expect(initialRegistrationState(RegistrationPaymentMethod.stripe)).toBe(
      RegistrationState.pending_payment,
    );
  });

  it("allows only the defined Stripe and cancellation transitions", () => {
    expect(
      canTransitionRegistration(RegistrationState.pending_payment, RegistrationState.confirmed),
    ).toBe(true);
    expect(
      canTransitionRegistration(RegistrationState.pending_payment, RegistrationState.expired),
    ).toBe(true);
    expect(
      canTransitionRegistration(RegistrationState.confirmed, RegistrationState.cancelled),
    ).toBe(true);
    expect(
      canTransitionRegistration(RegistrationState.confirmed, RegistrationState.pending_payment),
    ).toBe(false);
    expect(() =>
      assertRegistrationTransition(RegistrationState.cancelled, RegistrationState.confirmed),
    ).toThrow("Registration cannot transition");
  });

  it("counts every live registration toward capacity", () => {
    expect(registrationReservesCapacity(RegistrationState.pending_payment)).toBe(true);
    expect(registrationReservesCapacity(RegistrationState.confirmed)).toBe(true);
    expect(registrationReservesCapacity(RegistrationState.expired)).toBe(false);
    expect(registrationReservesCapacity(RegistrationState.cancelled)).toBe(false);
  });

  it("requires expired and cancelled records to be deleted", () => {
    expect(registrationMustBeDeleted(RegistrationState.expired)).toBe(true);
    expect(registrationMustBeDeleted(RegistrationState.cancelled)).toBe(true);
    expect(registrationMustBeDeleted(RegistrationState.confirmed)).toBe(false);
  });
});
