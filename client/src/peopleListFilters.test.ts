import { describe, expect, it } from "vitest";
import { parsePeopleListFilters, peopleListUrl } from "./peopleListFilters";

describe("people list URL filters", () => {
  it("builds links for a selected camp year and arrival status", () => {
    expect(
      peopleListUrl({
        campYearId: "year 1",
        peopleListKind: "dorm_leader",
        checkInFilter: "checked_in",
      }),
    ).toBe("/admin/people?campYearId=year+1&type=dorm_leader&checkIn=checked_in");
  });

  it("reads supported filters and ignores invalid filter values", () => {
    expect(
      parsePeopleListFilters(
        new URLSearchParams(
          "campYearId=year-1&type=worker&checkIn=checked_in&payment=invalid",
        ),
      ),
    ).toEqual({
      campYearId: "year-1",
      peopleListKind: "worker",
      checkInFilter: "checked_in",
      paymentFilter: "",
    });
  });

  it("builds the unpaid camper link", () => {
    expect(
      peopleListUrl({
        campYearId: "year-1",
        peopleListKind: "camper",
        paymentFilter: "unpaid",
      }),
    ).toBe("/admin/people?campYearId=year-1&type=camper&payment=unpaid");
  });
});
