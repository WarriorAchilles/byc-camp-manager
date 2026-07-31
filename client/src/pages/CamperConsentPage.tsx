import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiJson } from "../api";

type ConsentResponse = {
  camper: {
    id: string;
    firstName: string;
    lastName: string;
    dateOfBirth: string;
  };
  campYear: {
    id: string;
    name: string;
    yearLabel: string;
    startDate: string;
    endDate: string;
  };
  consent: {
    registrationId: string;
    signerName: string;
    signerRelationship: string | null;
    contactName: string;
    contactEmail: string;
    contactPhone: string;
    signatureMethod: "typed" | "drawn";
    legalAcknowledged: boolean;
    signedAt: string;
    requestIp: string | null;
    agreementVersion: string | null;
    agreementText: string;
    coveredCampers: Array<{
      id: string;
      firstName: string;
      lastName: string;
      dateOfBirth: string;
    }>;
  };
};

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "long",
    timeStyle: "long",
  }).format(new Date(value));
}

function signatureMethodLabel(method: ConsentResponse["consent"]["signatureMethod"]): string {
  return method === "typed" ? "Typed electronic signature" : "Drawn electronic signature";
}

export function CamperConsentPage(): React.ReactElement {
  const { campYearId = "", camperId = "" } = useParams<{
    campYearId: string;
    camperId: string;
  }>();
  const [data, setData] = useState<ConsentResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void apiJson<ConsentResponse>(
      `/api/admin/camp-years/${campYearId}/campers/${camperId}/consent`,
    )
      .then((response) => {
        if (active) {
          setData(response);
        }
      })
      .catch((caught: unknown) => {
        if (active) {
          setError(
            caught instanceof Error
              ? caught.message
              : "The e-signature confirmation could not be loaded.",
          );
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [campYearId, camperId]);

  if (loading) {
    return <p aria-live="polite">Loading e-signature confirmation…</p>;
  }

  if (error || !data) {
    return (
      <section className="card stack">
        <h1 style={{ margin: 0 }}>E-signature confirmation</h1>
        <p className="error" role="alert">
          {error ?? "No e-signature confirmation is available for this camper."}
        </p>
        <div>
          <Link className="btn secondary" to="/admin/people">
            Back to campers
          </Link>
        </div>
      </section>
    );
  }

  const camperName = `${data.camper.firstName} ${data.camper.lastName}`;

  return (
    <div className="consent-print-root">
      <header className="consent-screen-header print-hidden">
        <div>
          <p className="page-header-eyebrow">Camper records</p>
          <h1>E-signature confirmation</h1>
          <p className="muted">View or print the stored consent record for {camperName}.</p>
        </div>
        <div className="row">
          <Link className="btn secondary" to="/admin/people">
            Back to campers
          </Link>
          <button className="btn" type="button" onClick={() => window.print()}>
            Print confirmation
          </button>
        </div>
      </header>

      <article className="card consent-document" aria-labelledby="consent-document-title">
        <header className="consent-document-header">
          <img src="/byc-logo.png" alt="Believers Youth Camp" />
          <div>
            <p>Official registration record</p>
            <h2 id="consent-document-title">Electronic Signature Confirmation</h2>
            <p>
              {data.campYear.name} · {data.campYear.yearLabel}
            </p>
          </div>
        </header>

        <p className="consent-document-intro">
          This document confirms that the medical release and liability agreement below was
          accepted electronically for <strong>{camperName}</strong>.
        </p>

        <section className="consent-section" aria-labelledby="camper-consent-heading">
          <h3 id="camper-consent-heading">Camper and registration</h3>
          <dl className="consent-details">
            <div>
              <dt>Camper</dt>
              <dd>{camperName}</dd>
            </div>
            <div>
              <dt>Date of birth</dt>
              <dd>{formatDate(data.camper.dateOfBirth)}</dd>
            </div>
            <div>
              <dt>Camp dates</dt>
              <dd>
                {formatDate(data.campYear.startDate)} – {formatDate(data.campYear.endDate)}
              </dd>
            </div>
            <div>
              <dt>Registration ID</dt>
              <dd className="consent-identifier">{data.consent.registrationId}</dd>
            </div>
          </dl>
          {data.consent.coveredCampers.length > 1 ? (
            <div className="consent-covered-campers">
              <strong>All campers covered by this signed registration:</strong>
              <ul>
                {data.consent.coveredCampers.map((camper) => (
                  <li key={camper.id}>
                    {camper.firstName} {camper.lastName} (born {formatDate(camper.dateOfBirth)})
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>

        <section className="consent-section" aria-labelledby="agreement-heading">
          <h3 id="agreement-heading">Accepted agreement</h3>
          <div className="consent-agreement-copy">{data.consent.agreementText}</div>
        </section>

        <section className="consent-section consent-signature-block" aria-labelledby="signature-heading">
          <h3 id="signature-heading">Electronic signature</h3>
          <p className="consent-signature-name">{data.consent.signerName}</p>
          <dl className="consent-details">
            <div>
              <dt>Signature method</dt>
              <dd>{signatureMethodLabel(data.consent.signatureMethod)}</dd>
            </div>
            <div>
              <dt>Signed</dt>
              <dd>{formatDateTime(data.consent.signedAt)}</dd>
            </div>
            <div>
              <dt>Relationship</dt>
              <dd>{data.consent.signerRelationship || "Not provided"}</dd>
            </div>
            <div>
              <dt>Electronic acknowledgment</dt>
              <dd>{data.consent.legalAcknowledged ? "Accepted" : "Not accepted"}</dd>
            </div>
            <div>
              <dt>Agreement version</dt>
              <dd>{data.consent.agreementVersion || "Not recorded"}</dd>
            </div>
            <div>
              <dt>Recorded request IP</dt>
              <dd>{data.consent.requestIp || "Not recorded"}</dd>
            </div>
          </dl>
        </section>

        <section className="consent-section consent-contact" aria-labelledby="contact-heading">
          <h3 id="contact-heading">Registration contact</h3>
          <p>
            <strong>{data.consent.contactName}</strong>
            <br />
            {data.consent.contactPhone}
            <br />
            {data.consent.contactEmail}
          </p>
        </section>

        <footer className="consent-document-footer">
          Stored by BYC Camp Manager as part of the confirmed family registration record.
        </footer>
      </article>
    </div>
  );
}
