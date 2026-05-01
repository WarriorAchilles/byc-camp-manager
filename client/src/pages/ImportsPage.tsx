import { FormEvent, useCallback, useEffect, useState, type ReactElement } from "react";
import { Navigate } from "react-router-dom";
import { apiJson, type ApiHttpError } from "../api";
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
};

function fieldLabel(key: string): string {
  return FIELD_LABELS[key] ?? key;
}

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

  const loadCampYears = useCallback(async () => {
    try {
      const data = await apiJson<{ campYears: CampYearOption[] }>("/api/admin/camp-years");
      setCampYears(data.campYears);
      setCampYearId((previous) => {
        if (previous) {
          return previous;
        }
        return data.campYears[0]?.id ?? "";
      });
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
  }, [kind, campYearId]);

  async function onFileSelected(file: File | null): Promise<void> {
    setError(null);
    setCommitMessage(null);
    setPreview(null);
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
      await apiJson<{ imported: number; kind: string }>(
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
          }),
        },
      );
      setCommitMessage(`Imported ${KIND_LABELS[kind].toLowerCase()} successfully.`);
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
        (httpErr.body as { error?: string }).error === "commit_blocked_row_errors"
      ) {
        const rowErrors = (httpErr.body as { rowErrors?: { rowNumber: number; errors: string[] }[] })
          .rowErrors;
        const detail =
          rowErrors?.map((row) => `Row ${row.rowNumber}: ${row.errors.join("; ")}`).join(" ") ??
          "Fix row errors before committing.";
        setError(detail);
      } else {
        setError(httpErr instanceof Error ? httpErr.message : "Commit failed");
      }
    } finally {
      setLoading(false);
    }
  }

  function updateColumnMap(logicalKey: string, headerValue: string): void {
    const next =
      headerValue === "__none__" ? { ...columnMap, [logicalKey]: null } : { ...columnMap, [logicalKey]: headerValue };
    setColumnMap(next);
  }

  if (user?.role !== "super_admin") {
    return <Navigate to="/admin" replace />;
  }

  const canCommit =
    preview &&
    !preview.mapError &&
    preview.previewRows.length > 0 &&
    preview.invalidRowCount === 0 &&
    !loading;

  return (
    <div className="stack" style={{ gap: "1.25rem", maxWidth: "960px" }}>
      <div>
        <h1 style={{ marginTop: 0 }}>CSV import</h1>
        <p className="muted">
          One-time bulk import for campers, workers, and dorm leaders. Preview and fix column mappings before
          committing. Invalid rows block the entire commit.
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
    </div>
  );
}
