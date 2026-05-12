import { FormEvent, useCallback, useEffect, useState, type ReactElement } from "react";
import { Navigate } from "react-router-dom";
import { apiJson, type ApiHttpError } from "../api";
import { resolveCampYearSelection } from "../campYearSelection";
import { useAuth } from "../auth";

type CampYearOption = {
  id: string;
  name: string;
  yearLabel: string;
  activeCamperCount?: number;
};

type ImportKind = "camper" | "worker" | "dorm_leader";

type PreviewRow = {
  rowNumber: number;
  errors: string[];
  warnings: string[];
  rawSubset: Record<string, string>;
};

type PreviewResponse = {
  headers: string[];
  suggestedColumnMap: Record<string, string | null>;
  columnMap: Record<string, string | null>;
  mapError: string | null;
  previewRows: PreviewRow[];
  validRowCount: number;
  invalidRowCount: number;
  rowWarningsFlat: string[];
  globalWarnings: string[];
  capacity: {
    configuredCapacity: number;
    currentCamperCount: number;
    additionalValidCampers: number;
    wouldExceed: boolean;
  } | null;
  logicalFields: string[];
};

const KIND_LABELS: Record<ImportKind, string> = {
  camper: "Campers",
  worker: "Workers",
  dorm_leader: "Dorm leaders",
};

const FIELD_LABELS: Record<string, string> = {
  firstName: "First name",
  lastName: "Last name",
  middleName: "Middle name",
  dateOfBirth: "Date of birth",
  gender: "Gender",
  streetAddress: "Street address",
  city: "City",
  stateOrProvince: "State / province",
  postalCode: "Postal / ZIP code",
  country: "Country",
  camperCellPhone: "Camper cell phone",
  guardianName: "Parent / guardian name",
  guardianEmail: "Parent / guardian email",
  guardianPhone: "Parent / guardian phone",
  emergencyContactName: "Emergency contact name",
  emergencyContactPhone: "Emergency contact phone",
  medications: "Medications (merged into medical notes)",
  physicalLimitations: "Physical limitations (merged into medical notes)",
  medicalNotes: "Medical / allergies (combined field)",
  dietaryRestrictions: "Dietary restrictions",
  paymentStatus: "Payment status",
  email: "Email",
  cellPhone: "Cell phone",
  altPhone: "Alternate phone",
  taskPreferences: "Task preferences (workers only; comma-separated, top 3)",
  tShirtSize: "T-shirt size",
  roleLabel: "Age group to lead with (leader form; not worker task preferences)",
  feeDue: "Fees due (dollars or cents)",
  feePaid: "Fees paid (dollars or cents)",
};

function fieldLabel(key: string): string {
  return FIELD_LABELS[key] ?? key;
}

type FeePreviewRow = {
  rowNumber: number;
  errors: string[];
  warnings: string[];
  rawSubset: Record<string, string>;
  camperId: string | null;
  feeDueCents: number | null;
  feePaidCents: number | null;
};

type FeePreviewResponse = {
  headers: string[];
  suggestedColumnMap: Record<string, string | null>;
  columnMap: Record<string, string | null>;
  mapError: string | null;
  previewRows: FeePreviewRow[];
  validRowCount: number;
  invalidRowCount: number;
  rowWarningsFlat: string[];
  globalWarnings: string[];
  logicalFields: string[];
};

export function ImportsPage(): ReactElement {
  const { user } = useAuth();
  const [campYears, setCampYears] = useState<CampYearOption[]>([]);
  const [campYearId, setCampYearId] = useState<string>("");
  const [kind, setKind] = useState<ImportKind>("camper");
  const [csvText, setCsvText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [columnMap, setColumnMap] = useState<Record<string, string | null>>({});
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmCapacityOverride, setConfirmCapacityOverride] = useState(false);
  const [commitMessage, setCommitMessage] = useState<string | null>(null);
  const [skipInvalidRows, setSkipInvalidRows] = useState(false);

  const [feeCsvText, setFeeCsvText] = useState("");
  const [feeFileName, setFeeFileName] = useState<string | null>(null);
  const [feeColumnMap, setFeeColumnMap] = useState<Record<string, string | null>>({});
  const [feePreview, setFeePreview] = useState<FeePreviewResponse | null>(null);
  const [feeLoading, setFeeLoading] = useState(false);
  const [feeError, setFeeError] = useState<string | null>(null);
  const [feeCommitMessage, setFeeCommitMessage] = useState<string | null>(null);
  const [feeSkipInvalidRows, setFeeSkipInvalidRows] = useState(false);

  const loadCampYears = useCallback(async () => {
    try {
      const data = await apiJson<{
        campYears: CampYearOption[];
        activeCampYearId: string | null;
      }>("/api/admin/camp-years");
      setCampYears(data.campYears);
      setCampYearId((previous) =>
        resolveCampYearSelection(data.campYears, data.activeCampYearId, previous),
      );
    } catch {
      setError("Could not load camp years.");
    }
  }, []);

  useEffect(() => {
    void loadCampYears();
  }, [loadCampYears]);

  const runPreview = useCallback(
    async (mapOverride: Record<string, string | null> | undefined) => {
      if (!campYearId || !csvText.trim()) {
        setError("Choose a camp year and CSV file first.");
        return;
      }
      setLoading(true);
      setError(null);
      setCommitMessage(null);
      try {
        const body = {
          kind,
          csvText,
          ...(mapOverride ? { columnMap: mapOverride } : {}),
        };
        const response = await apiJson<PreviewResponse>(
          `/api/admin/camp-years/${campYearId}/csv-import/preview`,
          {
            method: "POST",
            body: JSON.stringify(body),
          },
        );
        setPreview(response);
        setColumnMap(response.columnMap);
        setSkipInvalidRows(false);
      } catch (caught) {
        setPreview(null);
        setError(caught instanceof Error ? caught.message : "Preview failed");
      } finally {
        setLoading(false);
      }
    },
    [campYearId, csvText, kind],
  );

  useEffect(() => {
    setConfirmCapacityOverride(false);
    setPreview(null);
    setCommitMessage(null);
    setColumnMap({});
    setError(null);
    setSkipInvalidRows(false);
  }, [kind, campYearId]);

  useEffect(() => {
    setFeePreview(null);
    setFeeCommitMessage(null);
    setFeeColumnMap({});
    setFeeError(null);
    setFeeCsvText("");
    setFeeFileName(null);
    setFeeSkipInvalidRows(false);
  }, [campYearId]);

  async function onFileSelected(file: File | null): Promise<void> {
    setError(null);
    setCommitMessage(null);
    setPreview(null);
    setSkipInvalidRows(false);
    if (!file) {
      setCsvText("");
      setFileName(null);
      return;
    }
    const text = await file.text();
    setCsvText(text);
    setFileName(file.name);
  }

  async function onRefreshPreview(event: FormEvent): Promise<void> {
    event.preventDefault();
    await runPreview(columnMap);
  }

  async function onCommit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!campYearId || !csvText.trim()) {
      setError("Choose a camp year and CSV file first.");
      return;
    }
    setLoading(true);
    setError(null);
    setCommitMessage(null);
    try {
      const result = await apiJson<{ imported: number; kind: string; skippedInvalidRows?: number }>(
        `/api/admin/camp-years/${campYearId}/csv-import/commit`,
        {
          method: "POST",
          body: JSON.stringify({
            kind,
            csvText,
            columnMap,
            ...(kind === "camper" && confirmCapacityOverride
              ? { confirmCapacityOverride: true }
              : {}),
            ...(skipInvalidRows ? { skipInvalidRows: true } : {}),
          }),
        },
      );
      const skipped = result.skippedInvalidRows ?? 0;
      setCommitMessage(
        skipped > 0
          ? `Imported ${result.imported} ${KIND_LABELS[kind].toLowerCase()} (${skipped} row(s) with errors skipped).`
          : `Imported ${result.imported} ${KIND_LABELS[kind].toLowerCase()}.`,
      );
      setSkipInvalidRows(false);
      setCsvText("");
      setFileName(null);
      setPreview(null);
      setColumnMap({});
      await loadCampYears();
    } catch (caught) {
      const httpErr = caught as ApiHttpError;
      if (httpErr.status === 409 && typeof httpErr.body === "object" && httpErr.body !== null) {
        const body = httpErr.body as { error?: string; message?: string };
        if (body.error === "capacity_exceeded") {
          setError(
            `${body.message ?? "Camper capacity exceeded."} Check “Confirm capacity override” and try again.`,
          );
        } else {
          setError(body.message ?? httpErr.message);
        }
      } else if (
        httpErr.status === 400 &&
        typeof httpErr.body === "object" &&
        httpErr.body !== null &&
        (httpErr.body as { error?: string }).error === "no_valid_rows_to_commit"
      ) {
        const body = httpErr.body as { message?: string };
        setError(body.message ?? "No valid rows to import.");
      } else if (
        httpErr.status === 400 &&
        typeof httpErr.body === "object" &&
        httpErr.body !== null &&
        (httpErr.body as { error?: string }).error === "commit_blocked_row_errors"
      ) {
        const rowErrors = (httpErr.body as { rowErrors?: { rowNumber: number; errors: string[] }[] })
          .rowErrors;
        const detail =
          rowErrors?.map((row) => `Row ${row.rowNumber}: ${row.errors.join("; ")}`).join(" ") ??
          "Fix row errors before committing, or enable “Skip rows with errors”.";
        setError(detail);
      } else {
        setError(httpErr instanceof Error ? httpErr.message : "Commit failed");
      }
      setLoading(false);
    }
  }

  function updateColumnMap(logicalKey: string, headerValue: string): void {
    const next =
      headerValue === "__none__" ? { ...columnMap, [logicalKey]: null } : { ...columnMap, [logicalKey]: headerValue };
    setColumnMap(next);
  }

  const runFeePreview = useCallback(
    async (mapOverride: Record<string, string | null> | undefined) => {
      if (!campYearId || !feeCsvText.trim()) {
        setFeeError("Choose a camp year and fee CSV file first.");
        return;
      }
      setFeeLoading(true);
      setFeeError(null);
      setFeeCommitMessage(null);
      try {
        const response = await apiJson<FeePreviewResponse>(
          `/api/admin/camp-years/${campYearId}/camper-fee-csv/preview`,
          {
            method: "POST",
            body: JSON.stringify({
              csvText: feeCsvText,
              ...(mapOverride ? { columnMap: mapOverride } : {}),
            }),
          },
        );
        setFeePreview(response);
        setFeeColumnMap(response.columnMap);
        setFeeSkipInvalidRows(false);
      } catch (caught) {
        setFeePreview(null);
        setFeeError(caught instanceof Error ? caught.message : "Fee preview failed");
      } finally {
        setFeeLoading(false);
      }
    },
    [campYearId, feeCsvText],
  );

  async function onFeeFileSelected(file: File | null): Promise<void> {
    setFeeError(null);
    setFeeCommitMessage(null);
    setFeePreview(null);
    setFeeSkipInvalidRows(false);
    if (!file) {
      setFeeCsvText("");
      setFeeFileName(null);
      return;
    }
    const text = await file.text();
    setFeeCsvText(text);
    setFeeFileName(file.name);
  }

  async function onFeeRefreshPreview(event: FormEvent): Promise<void> {
    event.preventDefault();
    await runFeePreview(feeColumnMap);
  }

  async function onFeeCommit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!campYearId || !feeCsvText.trim()) {
      setFeeError("Choose a camp year and fee CSV file first.");
      return;
    }
    setFeeLoading(true);
    setFeeError(null);
    setFeeCommitMessage(null);
    try {
      const result = await apiJson<{ updated: number; skippedInvalidRows?: number }>(
        `/api/admin/camp-years/${campYearId}/camper-fee-csv/commit`,
        {
          method: "POST",
          body: JSON.stringify({
            csvText: feeCsvText,
            columnMap: feeColumnMap,
            ...(feeSkipInvalidRows ? { skipInvalidRows: true } : {}),
          }),
        },
      );
      const skipped = result.skippedInvalidRows ?? 0;
      setFeeCommitMessage(
        skipped > 0
          ? `Updated fees for ${result.updated} camper(s) (${skipped} row(s) with errors skipped).`
          : `Updated fees for ${result.updated} camper(s).`,
      );
      setFeeSkipInvalidRows(false);
      setFeeCsvText("");
      setFeeFileName(null);
      setFeePreview(null);
      setFeeColumnMap({});
      await loadCampYears();
    } catch (caught) {
      const httpErr = caught as ApiHttpError;
      if (
        httpErr.status === 400 &&
        typeof httpErr.body === "object" &&
        httpErr.body !== null &&
        (httpErr.body as { error?: string }).error === "commit_blocked_row_errors"
      ) {
        const rowErrors = (httpErr.body as { rowErrors?: { rowNumber: number; errors: string[] }[] }).rowErrors;
        const detail =
          rowErrors?.map((row) => `Row ${row.rowNumber}: ${row.errors.join("; ")}`).join(" ") ??
          "Fix row errors before committing, or enable “Skip rows with errors”.";
        setFeeError(detail);
      } else if (
        httpErr.status === 400 &&
        typeof httpErr.body === "object" &&
        httpErr.body !== null &&
        (httpErr.body as { error?: string }).error === "no_valid_rows_to_commit"
      ) {
        const body = httpErr.body as { message?: string };
        setFeeError(body.message ?? "No valid rows to import.");
      } else {
        setFeeError(httpErr instanceof Error ? httpErr.message : "Fee commit failed");
      }
    } finally {
      setFeeLoading(false);
    }
  }

  function updateFeeColumnMap(logicalKey: string, headerValue: string): void {
    const next =
      headerValue === "__none__"
        ? { ...feeColumnMap, [logicalKey]: null }
        : { ...feeColumnMap, [logicalKey]: headerValue };
    setFeeColumnMap(next);
  }

  function formatCentsForPreview(cents: number | null): string {
    if (cents === null) {
      return "—";
    }
    return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(cents / 100);
  }

  if (user?.role !== "super_admin") {
    return <Navigate to="/admin/people" replace />;
  }

  const canCommit =
    preview !== null &&
    !preview.mapError &&
    preview.previewRows.length > 0 &&
    preview.validRowCount > 0 &&
    (preview.invalidRowCount === 0 || skipInvalidRows) &&
    !loading;

  const canFeeCommit =
    feePreview !== null &&
    !feePreview.mapError &&
    feePreview.previewRows.length > 0 &&
    feePreview.validRowCount > 0 &&
    (feePreview.invalidRowCount === 0 || feeSkipInvalidRows) &&
    !feeLoading;

  return (
    <div className="stack" style={{ gap: "1.25rem", maxWidth: "960px" }}>
      <div>
        <h1 style={{ marginTop: 0 }}>CSV import</h1>
        <p className="muted">
          One-time bulk import for campers, workers, and dorm leaders. Preview and fix column mappings before
          committing. By default, any row with errors blocks the commit; you can opt in to skip error rows and import
          only valid rows.
        </p>
      </div>

      <form className="stack" style={{ gap: "0.75rem" }} onSubmit={onRefreshPreview}>
        <label className="stack" style={{ gap: "0.25rem" }}>
          <span>Camp year</span>
          <select
            value={campYearId}
            onChange={(event) => {
              setCampYearId(event.target.value);
            }}
            required
          >
            <option value="" disabled>
              Select year
            </option>
            {campYears.map((year) => (
              <option key={year.id} value={year.id}>
                {year.name} ({year.yearLabel})
              </option>
            ))}
          </select>
        </label>

        <label className="stack" style={{ gap: "0.25rem" }}>
          <span>Import type</span>
          <select
            value={kind}
            onChange={(event) => {
              setKind(event.target.value as ImportKind);
            }}
          >
            <option value="camper">Campers</option>
            <option value="worker">Workers</option>
            <option value="dorm_leader">Dorm leaders</option>
          </select>
          {kind === "dorm_leader" ? (
            <span className="muted" style={{ marginTop: "0.15rem" }}>
              Dorm leader CSVs do not include worker task-preference columns; only map identity, phones, and optional
              age-group / role text.
            </span>
          ) : null}
        </label>

        <label className="stack" style={{ gap: "0.25rem" }}>
          <span>CSV file</span>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => void onFileSelected(event.target.files?.[0] ?? null)}
          />
        </label>
        {fileName ? <span className="muted">Selected: {fileName}</span> : null}

        <div className="row" style={{ gap: "0.5rem", flexWrap: "wrap" }}>
          <button type="button" className="btn secondary" disabled={!csvText.trim() || loading} onClick={() => void runPreview(undefined)}>
            Auto-map &amp; preview
          </button>
          <button type="submit" className="btn" disabled={!csvText.trim() || loading}>
            Apply column mapping &amp; preview
          </button>
        </div>
      </form>

      {error ? (
        <div className="card error" role="alert">
          {error}
        </div>
      ) : null}
      {commitMessage ? (
        <div className="card" role="status">
          {commitMessage}
        </div>
      ) : null}

      {preview?.mapError ? (
        <div className="card error" role="alert">
          {preview.mapError}
        </div>
      ) : null}

      {preview && preview.headers.length > 0 ? (
        <div className="stack" style={{ gap: "0.75rem" }}>
          <h2 style={{ margin: 0, fontSize: "1.1rem" }}>Column mapping</h2>
          <p className="muted" style={{ margin: 0 }}>
            Match each field to a CSV column. Unmapped optional fields are left blank; required fields show errors in
            the preview table.
          </p>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Field</th>
                  <th>CSV column</th>
                </tr>
              </thead>
              <tbody>
                {preview.logicalFields.map((logicalKey) => (
                  <tr key={logicalKey}>
                    <td>{fieldLabel(logicalKey)}</td>
                    <td>
                      <select
                        value={columnMap[logicalKey] ?? "__none__"}
                        onChange={(event) => {
                          updateColumnMap(logicalKey, event.target.value);
                        }}
                      >
                        <option value="__none__">— Unmapped —</option>
                        {preview.headers.map((header) => (
                          <option key={header} value={header}>
                            {header}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {preview.globalWarnings.length > 0 ? (
            <div className="card">
              <strong>Warnings</strong>
              <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1.25rem" }}>
                {preview.globalWarnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {preview.capacity ? (
            <div className="card">
              <strong>Camper capacity</strong>
              <p style={{ margin: "0.35rem 0 0" }} className="muted">
                Current campers: {preview.capacity.currentCamperCount}. Configured cap:{" "}
                {preview.capacity.configuredCapacity}. Valid rows in file: {preview.capacity.additionalValidCampers}.
                {preview.capacity.wouldExceed ? (
                  <span style={{ color: "var(--danger)" }}> This import would exceed capacity.</span>
                ) : (
                  " Within capacity."
                )}
              </p>
              {kind === "camper" && preview.capacity.wouldExceed ? (
                <label className="row" style={{ marginTop: "0.75rem", gap: "0.5rem", alignItems: "center" }}>
                  <input
                    type="checkbox"
                    checked={confirmCapacityOverride}
                    onChange={(event) => {
                      setConfirmCapacityOverride(event.target.checked);
                    }}
                  />
                  Confirm capacity override
                </label>
              ) : null}
            </div>
          ) : null}

          <div className="stack" style={{ gap: "0.5rem" }}>
            <h2 style={{ margin: 0, fontSize: "1.1rem" }}>Row preview</h2>
            <p className="muted" style={{ margin: 0 }}>
              {preview.validRowCount} valid row(s), {preview.invalidRowCount} row(s) with errors.
            </p>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Row</th>
                    <th>Status</th>
                    <th>Extracted values</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.previewRows.map((row) => (
                    <tr key={row.rowNumber}>
                      <td>{row.rowNumber}</td>
                      <td>
                        {row.errors.length > 0 ? (
                          <span style={{ color: "var(--danger)" }}>{row.errors.join(" ")}</span>
                        ) : (
                          <span style={{ color: "var(--muted)" }}>OK</span>
                        )}
                        {row.warnings.length > 0 ? (
                          <div className="muted" style={{ fontSize: "0.85rem", marginTop: "0.25rem" }}>
                            {row.warnings.join(" ")}
                          </div>
                        ) : null}
                      </td>
                      <td style={{ fontSize: "0.85rem", maxWidth: "28rem", wordBreak: "break-word" }}>
                        {Object.entries(row.rawSubset)
                          .map(([columnHeader, value]) => `${columnHeader}: ${value}`)
                          .join(" · ") || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {preview.invalidRowCount > 0 ? (
            <label className="row" style={{ gap: "0.5rem", alignItems: "flex-start", maxWidth: "40rem" }}>
              <input
                type="checkbox"
                checked={skipInvalidRows}
                onChange={(event) => {
                  setSkipInvalidRows(event.target.checked);
                }}
              />
              <span>
                Skip {preview.invalidRowCount} row(s) with errors and import only the {preview.validRowCount} valid
                row(s).
              </span>
            </label>
          ) : null}

          <form onSubmit={onCommit}>
            <button
              type="submit"
              className="btn"
              disabled={
                !canCommit ||
                (kind === "camper" && preview.capacity?.wouldExceed && !confirmCapacityOverride)
              }
            >
              Commit import
            </button>
          </form>
        </div>
      ) : null}

      {loading ? <p className="muted">Working…</p> : null}

      <div className="card stack" style={{ gap: "1rem", marginTop: "2rem" }}>
        <div>
          <h2 style={{ marginTop: 0 }}>Camper fees (update existing)</h2>
          <p className="muted" style={{ margin: 0 }}>
            Import a short CSV with first name, last name, fees due, and fees paid. Rows must match exactly one
            non-archived camper in the selected camp year (case-insensitive name match). Amounts may include $ and
            commas. Payment status is updated from the amounts when appropriate (Stripe-paid campers are never
            downgraded to unpaid by this import). Rows with errors block commit unless you choose to skip them.
          </p>
        </div>

        <form className="stack" style={{ gap: "0.75rem" }} onSubmit={onFeeRefreshPreview}>
          <label className="stack" style={{ gap: "0.25rem" }}>
            <span>Fee CSV file</span>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => void onFeeFileSelected(event.target.files?.[0] ?? null)}
            />
          </label>
          {feeFileName ? <span className="muted">Selected: {feeFileName}</span> : null}

          <div className="row" style={{ gap: "0.5rem", flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn secondary"
              disabled={!feeCsvText.trim() || feeLoading}
              onClick={() => void runFeePreview(undefined)}
            >
              Auto-map &amp; preview
            </button>
            <button type="submit" className="btn" disabled={!feeCsvText.trim() || feeLoading}>
              Apply column mapping &amp; preview
            </button>
          </div>
        </form>

        {feeError ? (
          <div className="card error" role="alert">
            {feeError}
          </div>
        ) : null}
        {feeCommitMessage ? (
          <div className="card" role="status">
            {feeCommitMessage}
          </div>
        ) : null}

        {feePreview?.mapError ? (
          <div className="card error" role="alert">
            {feePreview.mapError}
          </div>
        ) : null}

        {feePreview && feePreview.headers.length > 0 ? (
          <div className="stack" style={{ gap: "0.75rem" }}>
            <h3 style={{ margin: 0, fontSize: "1.05rem" }}>Fee column mapping</h3>
            <p className="muted" style={{ margin: 0 }}>
              All four fields must be mapped to CSV columns.
            </p>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Field</th>
                    <th>CSV column</th>
                  </tr>
                </thead>
                <tbody>
                  {feePreview.logicalFields.map((logicalKey) => (
                    <tr key={logicalKey}>
                      <td>{fieldLabel(logicalKey)}</td>
                      <td>
                        <select
                          value={feeColumnMap[logicalKey] ?? "__none__"}
                          onChange={(event) => {
                            updateFeeColumnMap(logicalKey, event.target.value);
                          }}
                        >
                          <option value="__none__">— Unmapped —</option>
                          {feePreview.headers.map((header) => (
                            <option key={header} value={header}>
                              {header}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {feePreview.globalWarnings.length > 0 ? (
              <div className="card">
                <strong>Warnings</strong>
                <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1.25rem" }}>
                  {feePreview.globalWarnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="stack" style={{ gap: "0.5rem" }}>
              <h3 style={{ margin: 0, fontSize: "1.05rem" }}>Fee row preview</h3>
              <p className="muted" style={{ margin: 0 }}>
                {feePreview.validRowCount} valid row(s), {feePreview.invalidRowCount} row(s) with errors.
              </p>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Row</th>
                      <th>Status</th>
                      <th>Match / amounts</th>
                    </tr>
                  </thead>
                  <tbody>
                    {feePreview.previewRows.map((row) => (
                      <tr key={row.rowNumber}>
                        <td>{row.rowNumber}</td>
                        <td>
                          {row.errors.length > 0 ? (
                            <span style={{ color: "var(--danger)" }}>{row.errors.join(" ")}</span>
                          ) : (
                            <span style={{ color: "var(--muted)" }}>OK</span>
                          )}
                          {row.warnings.length > 0 ? (
                            <div className="muted" style={{ fontSize: "0.85rem", marginTop: "0.25rem" }}>
                              {row.warnings.join(" ")}
                            </div>
                          ) : null}
                        </td>
                        <td style={{ fontSize: "0.85rem", maxWidth: "28rem", wordBreak: "break-word" }}>
                          {row.camperId ? <span>Camper ID: {row.camperId} · </span> : null}
                          Due {formatCentsForPreview(row.feeDueCents)} · Paid {formatCentsForPreview(row.feePaidCents)}
                          {Object.keys(row.rawSubset).length > 0 ? (
                            <div className="muted" style={{ marginTop: "0.25rem" }}>
                              {Object.entries(row.rawSubset)
                                .map(([columnHeader, value]) => `${columnHeader}: ${value}`)
                                .join(" · ")}
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {feePreview.invalidRowCount > 0 ? (
              <label className="row" style={{ gap: "0.5rem", alignItems: "flex-start", maxWidth: "40rem" }}>
                <input
                  type="checkbox"
                  checked={feeSkipInvalidRows}
                  onChange={(event) => {
                    setFeeSkipInvalidRows(event.target.checked);
                  }}
                />
                <span>
                  Skip {feePreview.invalidRowCount} row(s) with errors and update fees for only the{" "}
                  {feePreview.validRowCount} valid row(s).
                </span>
              </label>
            ) : null}

            <form onSubmit={onFeeCommit}>
              <button type="submit" className="btn" disabled={!canFeeCommit}>
                Commit fee updates
              </button>
            </form>
          </div>
        ) : null}

        {feeLoading ? <p className="muted">Working…</p> : null}
      </div>
    </div>
  );
}
