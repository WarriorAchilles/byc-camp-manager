import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { apiJson } from "../api";
import { useAuth } from "../auth";
import { resolveCampYearSelection } from "../campYearSelection";
import { CampYearReadOnly } from "../components/CampYearReadOnly";

type CampYearOption = {
  id: string;
  name: string;
  yearLabel: string;
  selfCheckInToken?: string | null;
};

export function SelfCheckInQrPage(): React.ReactElement {
  const { user } = useAuth();
  const superAdmin = user?.role === "super_admin";

  const qrCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const printQrImageRef = useRef<HTMLImageElement | null>(null);

  const [campYears, setCampYears] = useState<CampYearOption[]>([]);
  const [campYearId, setCampYearId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedCampYear = campYears.find((campYear) => campYear.id === campYearId);
  const selfCheckInToken = selectedCampYear?.selfCheckInToken ?? null;
  const selfCheckInPublicUrl =
    typeof globalThis.window !== "undefined" && selfCheckInToken
      ? `${globalThis.window.location.origin}/self-check-in/${selfCheckInToken}`
      : null;

  const loadCampYears = useCallback(async (): Promise<void> => {
    const data = await apiJson<{
      campYears: CampYearOption[];
      activeCampYearId: string | null;
    }>("/api/admin/camp-years");
    setCampYears(data.campYears);
    setCampYearId((previousCampYearId) =>
      resolveCampYearSelection(data.campYears, data.activeCampYearId, previousCampYearId),
    );
  }, []);

  useEffect(() => {
    void loadCampYears().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "Could not load camp years.");
    });
  }, [loadCampYears]);

  useEffect(() => {
    setError(null);
  }, [campYearId]);

  useEffect(() => {
    const canvas = qrCanvasRef.current;
    if (!selfCheckInPublicUrl || !canvas) {
      return;
    }
    void QRCode.toCanvas(canvas, selfCheckInPublicUrl, { width: 240, margin: 2 }).catch(() => {
      setError("Could not render the QR preview.");
    });
  }, [selfCheckInPublicUrl]);

  useEffect(() => {
    const printImage = printQrImageRef.current;
    if (!selfCheckInPublicUrl || !printImage) {
      return;
    }
    void QRCode.toDataURL(selfCheckInPublicUrl, { width: 560, margin: 2 })
      .then((dataUrl) => {
        printImage.src = dataUrl;
      })
      .catch(() => {
        setError("Could not prepare the printable QR code.");
      });
  }, [selfCheckInPublicUrl]);

  const issueSelfCheckInToken = async (): Promise<void> => {
    if (!campYearId || !superAdmin) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiJson(`/api/admin/camp-years/${campYearId}/self-check-in/token`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      await loadCampYears();
    } catch (issueError) {
      setError(issueError instanceof Error ? issueError.message : "Could not create self check-in link.");
    } finally {
      setBusy(false);
    }
  };

  const regenerateSelfCheckInToken = async (): Promise<void> => {
    if (!campYearId || !superAdmin) {
      return;
    }
    const confirmed = globalThis.confirm(
      "Replace this self check-in link? Printed QR codes and shared links will stop working.",
    );
    if (!confirmed) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiJson(`/api/admin/camp-years/${campYearId}/self-check-in/token/regenerate`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      await loadCampYears();
    } catch (regenerateError) {
      setError(
        regenerateError instanceof Error
          ? regenerateError.message
          : "Could not replace self check-in link.",
      );
    } finally {
      setBusy(false);
    }
  };

  const copySelfCheckInUrl = async (): Promise<void> => {
    if (!selfCheckInPublicUrl || !globalThis.navigator?.clipboard?.writeText) {
      setError("Clipboard is not available in this browser.");
      return;
    }
    try {
      await globalThis.navigator.clipboard.writeText(selfCheckInPublicUrl);
    } catch {
      setError("Could not copy to clipboard.");
    }
  };

  return (
    <div className="self-check-in-qr-page">
      <header className="page-header">
        <p className="page-header-eyebrow">Arrival</p>
        <h1>Self check-in QR</h1>
        <p className="page-header-lead">
          Print or share the camper self check-in link for arrival day. Campers use it to search
          their own name and check in.
        </p>
      </header>

      <div className="card check-in-toolbar no-print">
        {superAdmin ? (
          <>
            <label className="field-label" htmlFor="self-check-in-year">
              Camp year
            </label>
            <select
              id="self-check-in-year"
              className="field-control"
              value={campYearId}
              onChange={(event) => setCampYearId(event.target.value)}
            >
              {campYears.map((campYear) => (
                <option key={campYear.id} value={campYear.id}>
                  {campYear.name} ({campYear.yearLabel})
                </option>
              ))}
            </select>
          </>
        ) : (
          <CampYearReadOnly campYears={campYears} campYearId={campYearId} />
        )}
      </div>

      {error ? (
        <p className="form-error no-print" role="alert">
          {error}
        </p>
      ) : null}

      <section className="card check-in-kiosk-card no-print">
        <h2>Camper self check-in link</h2>
        <p className="muted check-in-kiosk-lead">
          Regenerating the link invalidates old QR prints. Only super admins can generate or replace
          it.
        </p>

        <div className="check-in-kiosk-actions">
          {!selfCheckInToken ? (
            superAdmin ? (
              <button
                type="button"
                className="btn primary"
                disabled={!campYearId || busy}
                onClick={() => void issueSelfCheckInToken()}
              >
                Generate QR
              </button>
            ) : null
          ) : (
            <>
              <button
                type="button"
                className="btn secondary"
                disabled={busy}
                onClick={() => void copySelfCheckInUrl()}
              >
                Copy link
              </button>
              <button type="button" className="btn secondary" disabled={busy} onClick={() => window.print()}>
                Print QR
              </button>
              {superAdmin ? (
                <button
                  type="button"
                  className="btn secondary"
                  disabled={busy}
                  onClick={() => void regenerateSelfCheckInToken()}
                >
                  Replace link...
                </button>
              ) : null}
            </>
          )}
        </div>

        {!selfCheckInToken ? (
          <p className="muted">A super admin needs to generate the self check-in QR before it can be printed.</p>
        ) : null}

        {selfCheckInToken && selfCheckInPublicUrl ? (
          <div className="check-in-kiosk-body">
            <label className="field-label" htmlFor="self-check-in-url">
              Self check-in URL
            </label>
            <input
              id="self-check-in-url"
              className="field-control check-in-kiosk-url-input"
              readOnly
              value={selfCheckInPublicUrl}
            />
            <div className="check-in-kiosk-qr-preview">
              <canvas ref={qrCanvasRef} className="check-in-kiosk-canvas" width={240} height={240} />
            </div>
          </div>
        ) : null}
      </section>

      {selfCheckInToken ? (
        <div className="kiosk-print-root">
          <div className="kiosk-print-sheet">
            <img
              className="kiosk-print-logo"
              src="/byc-logo.png"
              alt="Believers Youth Camp"
            />
            <h2 className="kiosk-print-title">BYC Self Check-In</h2>
            <p className="kiosk-print-lead">
              Scan with your phone, search for your name, then tap Check in for your dorm assignment.
            </p>
            <img
              ref={printQrImageRef}
              className="kiosk-print-qr-img"
              alt="QR code linking to the camper self check-in page"
              width={560}
              height={560}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
