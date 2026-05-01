import { describe, expect, it } from "vitest";
import {
  buildCamperImportPreview,
  buildWorkerImportPreview,
  mergeColumnMap,
  normalizePhoneDigits,
  parseFlexibleDate,
  parseGender,
  parsePaymentStatus,
  parseCsvRows,
  runImportPreview,
  suggestColumnMap,
  validateColumnMapHeaders,
} from "./lib/csvImportCore.js";

describe("csvImportCore", () => {
  it("parses slash dates and ISO dates", () => {
    expect(parseFlexibleDate("2/12/2010")).toEqual({ ok: true, iso: "2010-02-12" });
    expect(parseFlexibleDate("2010-02-12")).toEqual({ ok: true, iso: "2010-02-12" });
    expect(parseFlexibleDate("").ok).toBe(false);
  });

  it("normalizes North American phone numbers", () => {
    expect(normalizePhoneDigits("123-456-7890")).toEqual({ ok: true, value: "1234567890" });
    expect(normalizePhoneDigits("11234567890")).toEqual({ ok: true, value: "1234567890" });
    expect(normalizePhoneDigits("123").ok).toBe(false);
  });

  it("parses gender and payment aliases", () => {
    expect(parseGender("Male")).toEqual({ ok: true, value: "male" });
    expect(parseGender("Female")).toEqual({ ok: true, value: "female" });
    expect(parseGender("").ok).toBe(false);
    expect(parsePaymentStatus("")).toMatchObject({ value: "unpaid" });
    expect(parsePaymentStatus("cash")).toMatchObject({ value: "paid_cash" });
    expect(parsePaymentStatus("stripe")).toMatchObject({ value: "paid_stripe" });
  });

  it("parses CSV with quoted headers containing commas", () => {
    const csv = `Name,Notes,"Country (USA, CAN, etc.)"\nJane,Docs,USA\n`;
    const { headers, rows } = parseCsvRows(csv);
    expect(headers.some((header) => header.includes("Country"))).toBe(true);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["Name"]).toBe("Jane");
  });

  it("matches BYC camper dummy headers and validates every data row", () => {
    const headers = [
      "Timestamp",
      "Email Address",
      "First name (given legal name:)",
      "Last Name",
      "Middle Name or Initial",
      "Gender",
      "Date of Birth",
      "Street Address (Please make address entries for multiple campers congruent.)",
      "City",
      "State/Province/Territory",
      "Zip code",
      'Country (Example: USA, CAN, etc.)',
      "Cell Number (numercial only, ex.: 8881234567)",
      "Parent/Guardian Contact Number (numerical only)",
      "Parent Guardian Name",
      "Are you a Christian?",
      "Have you received the gift of the Holy Ghost since you believed?",
      "Church Presently Attending",
      "Pastor Name (First and Last)",
      "T-Shirts will be available for sale ONLINE and in person this year! If you plan to purchase a shirt, please provide your desired size below. (Note: these are unisex sizes and may run a bit large on those with smaller frames.)",
      "List any physical limitations.",
      "List any medications. Minors must check medication in with the camp nurse upon arrival.",
      "Do you, the camper, agree to abide by the rules and dress code of BYC? Please type your name below as an E-signature.",
      " As a parent or guardian of the person listed above, do you have any objection for the camper to participate in these activities or other Bible activities? If yes, please explain below.",
      "Parent/Guardian E-signature:",
    ];
    const suggested = suggestColumnMap("camper", headers);
    expect(suggested.firstName).toBeTruthy();
    expect(suggested.guardianEmail).toBeTruthy();

    const rows = [
      Object.fromEntries(headers.map((header, index) => [header, index === 0 ? "4/6/2026" : ""])) as Record<
        string,
        string
      >,
    ];
    rows[0]["First name (given legal name:)"] = "Joe";
    rows[0]["Last Name"] = "Test";
    rows[0]["Gender"] = "Male";
    rows[0]["Date of Birth"] = "2/12/2010";
    rows[0]["Parent Guardian Name"] = "Steve Test";
    rows[0]["Email Address"] = "test@test.com";
    rows[0]["Parent/Guardian Contact Number (numerical only)"] = "1234567890";
    rows[0]["List any medications. Minors must check medication in with the camp nurse upon arrival."] = "N/A";
    rows[0]["List any physical limitations."] = "N/A";

    const merged = mergeColumnMap(suggested, {});
    expect(validateColumnMapHeaders(headers, merged)).toBeNull();

    const built = buildCamperImportPreview(rows, merged);
    expect(built.previewRows[0]?.errors ?? []).toEqual([]);
    expect(built.payloads).toHaveLength(1);
    expect(built.payloads[0]?.guardianEmail).toBe("test@test.com");
    expect(built.payloads[0]?.paymentStatus).toBe("unpaid");
  });

  it("surfaces camper row errors when medical columns are blank", () => {
    const headers = ["First name", "Last Name", "Gender", "Date of Birth", "Parent Guardian Name", "Email Address", "Parent Phone"];
    const suggested = suggestColumnMap("camper", headers);
    const row: Record<string, string> = {
      "First name": "A",
      "Last Name": "B",
      Gender: "Female",
      "Date of Birth": "2015-01-02",
      "Parent Guardian Name": "P",
      "Email Address": "p@example.com",
      "Parent Phone": "5551234567",
    };
    const built = buildCamperImportPreview([row], mergeColumnMap(suggested, {}));
    expect(built.previewRows[0]?.errors.some((message) => message.includes("Allergies"))).toBe(true);
    expect(built.payloads).toHaveLength(0);
  });

  it("returns capacity-style counts for worker imports", () => {
    const csv = [
      "Email Address,First Name,Last Name,Date of Birth,Gender,Cell Number,Alt. Number,Street Address,City,State or Province,Zip code,Country (USA, CAN, etc.)",
      "w@example.com,Wolf,Taylor,1/1/1980,Male,5551234567,,1 Main St,X,Y,12345,USA",
    ].join("\n");
    const preview = runImportPreview("worker", csv, undefined);
    expect(preview.mapError).toBeNull();
    expect(preview.validRowCount).toBe(1);
    expect(preview.payloads).toHaveLength(1);
  });

  it("splits worker task preferences into three slots", () => {
    const columnMap = mergeColumnMap(
      {
        email: "Email Address",
        firstName: "First Name",
        lastName: "Last Name",
        dateOfBirth: null,
        gender: "Gender",
        cellPhone: "Cell Number",
        altPhone: null,
        streetAddress: "Street Address",
        city: "City",
        stateOrProvince: "State or Province",
        postalCode: "Zip code",
        country: "Country",
        taskPreferences: "Tasks",
        tShirtSize: "T-Shirts",
      },
      {},
    );
    const row: Record<string, string> = {
      "Email Address": "w2@example.com",
      "First Name": "A",
      "Last Name": "B",
      Gender: "Male",
      "Cell Number": "5551234567",
      "Street Address": "1 Main",
      City: "X",
      "State or Province": "Y",
      "Zip code": "12345",
      Country: "USA",
      Tasks: "Kitchen, Sports and Recreation, Night Watch",
      "T-Shirts": "M",
    };
    const built = buildWorkerImportPreview([row], columnMap);
    expect(built.previewRows[0]?.errors ?? []).toEqual([]);
    expect(built.payloads).toHaveLength(1);
    const payload = built.payloads[0] as { taskPreferenceFirst: string | null };
    expect(payload.taskPreferenceFirst).toBe("Kitchen");
  });

  it("maps dorm leader CSV cells with alternate phone fallback", () => {
    const csv = [
      "Email Address,First Name,Last Name,Gender,Cell Number,Alt. Number,Preference",
      "ld@example.com,L,D,Male,,5559876543,10-13",
    ].join("\n");
    const preview = runImportPreview("dorm_leader", csv, { roleLabel: "Preference" });
    expect(preview.validRowCount).toBe(1);
    const payload = preview.payloads[0] as { phone: string; roleLabel: string | null };
    expect(payload.phone).toBe("5559876543");
    expect(payload.roleLabel).toBe("10-13");
  });

  it("rejects invalid column map references", () => {
    const csv = "a,b\n1,2\n";
    const preview = runImportPreview("worker", csv, { email: "missing" });
    expect(preview.mapError).toContain("unknown header");
  });

  it("ignores worker-only column map keys when importing dorm leaders", () => {
    const csv = "Email Address,First Name,Last Name,Gender,Cell Number\na@b.com,A,B,Male,5551234567\n";
    const preview = runImportPreview("dorm_leader", csv, {
      email: "Email Address",
      taskPreferences: "Email Address",
    });
    expect(preview.mapError).toBeNull();
    expect(preview.columnMap.taskPreferences).toBeUndefined();
    expect(preview.validRowCount).toBe(1);
  });
});
