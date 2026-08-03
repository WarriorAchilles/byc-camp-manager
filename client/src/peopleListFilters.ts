export type PeopleListKind = "camper" | "worker" | "dorm_leader";

export type PeopleCheckInFilter = "" | "checked_in" | "not_checked_in";

export type PeoplePaymentFilter = "" | "paid" | "unpaid";

export type PeopleListFilters = {
  campYearId: string;
  peopleListKind: PeopleListKind;
  checkInFilter: PeopleCheckInFilter;
  paymentFilter: PeoplePaymentFilter;
};

function peopleListKind(value: string | null): PeopleListKind {
  return value === "worker" || value === "dorm_leader" ? value : "camper";
}

function checkInFilter(value: string | null): PeopleCheckInFilter {
  return value === "checked_in" || value === "not_checked_in" ? value : "";
}

function paymentFilter(value: string | null): PeoplePaymentFilter {
  return value === "paid" || value === "unpaid" ? value : "";
}

export function parsePeopleListFilters(searchParams: URLSearchParams): PeopleListFilters {
  return {
    campYearId: searchParams.get("campYearId") ?? "",
    peopleListKind: peopleListKind(searchParams.get("type")),
    checkInFilter: checkInFilter(searchParams.get("checkIn")),
    paymentFilter: paymentFilter(searchParams.get("payment")),
  };
}

export function peopleListUrl(filters: Partial<PeopleListFilters>): string {
  const searchParams = new URLSearchParams();
  if (filters.campYearId) searchParams.set("campYearId", filters.campYearId);
  if (filters.peopleListKind) searchParams.set("type", filters.peopleListKind);
  if (filters.checkInFilter) searchParams.set("checkIn", filters.checkInFilter);
  if (filters.paymentFilter) searchParams.set("payment", filters.paymentFilter);
  const query = searchParams.toString();
  return `/admin/people${query ? `?${query}` : ""}`;
}
