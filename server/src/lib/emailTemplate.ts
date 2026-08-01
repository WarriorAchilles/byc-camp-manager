import { BYC_LOGO_CID, escapeHtml } from "./emailDelivery.js";

type BrandedEmailInput = {
  previewText: string;
  eyebrow: string;
  title: string;
  campName?: string;
  bodyHtml: string;
};

/**
 * Wraps transactional email content in a conservative, table-based layout.
 * Styles are inline so the design survives clients that strip style blocks.
 */
export function renderBrandedEmail(input: BrandedEmailInput): string {
  const campName = input.campName?.trim() || "Believers Youth Camp";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(input.title)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f3f0e8;color:#1f2b36;font-family:Arial,Helvetica,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(input.previewText)}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background-color:#f3f0e8;">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:640px;background-color:#fffdf9;border:1px solid #d8d3c8;border-radius:14px;overflow:hidden;box-shadow:0 8px 28px rgba(30,42,53,0.10);">
          <tr><td style="height:6px;background-color:#db3a24;font-size:0;line-height:0;">&nbsp;</td></tr>
          <tr>
            <td align="center" style="padding:26px 28px 20px;background-color:#ffffff;border-bottom:1px solid #e5e0d7;">
              <img src="cid:${BYC_LOGO_CID}" width="310" alt="Believers Youth Camp" style="display:block;width:100%;max-width:310px;height:auto;border:0;outline:none;text-decoration:none;">
            </td>
          </tr>
          <tr>
            <td style="padding:28px 36px 8px;">
              <p style="margin:0 0 8px;color:#c93420;font-size:12px;font-weight:700;letter-spacing:1.6px;line-height:1.4;text-transform:uppercase;">${escapeHtml(input.eyebrow)}</p>
              <h1 style="margin:0;color:#1e2a35;font-family:Georgia,'Times New Roman',serif;font-size:30px;font-weight:600;line-height:1.25;">${escapeHtml(input.title)}</h1>
              <p style="margin:8px 0 0;color:#657484;font-size:14px;line-height:1.5;">${escapeHtml(campName)}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:12px 36px 34px;color:#1f2b36;font-size:16px;line-height:1.65;">
              ${input.bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:20px 36px;background-color:#2c3d4d;color:#eef2f5;font-size:12px;line-height:1.6;text-align:center;">
              <strong style="color:#ffffff;">Believers Youth Camp</strong><br>
              This is an automated confirmation from the BYC camp management system.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function renderEmailSection(title: string, bodyHtml: string): string {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;margin:24px 0 0;border-collapse:separate;">
  <tr>
    <td style="padding:0 0 9px;border-bottom:2px solid #d8d3c8;">
      <h2 style="margin:0;color:#2c3d4d;font-family:Georgia,'Times New Roman',serif;font-size:20px;font-weight:600;line-height:1.35;">${escapeHtml(title)}</h2>
    </td>
  </tr>
  <tr><td style="padding:14px 0 0;">${bodyHtml}</td></tr>
</table>`;
}

export function renderNotice(bodyHtml: string, tone: "accent" | "success" | "neutral" = "neutral"): string {
  const tones = {
    accent: { background: "#fff4ed", border: "#db3a24", color: "#7c2d12" },
    success: { background: "#edf7f1", border: "#2d6b4e", color: "#24543f" },
    neutral: { background: "#f3f5f7", border: "#4c657c", color: "#2c3d4d" },
  } as const;
  const selected = tones[tone];
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;margin:20px 0 0;background-color:${selected.background};border-left:4px solid ${selected.border};border-radius:8px;">
  <tr><td style="padding:15px 17px;color:${selected.color};font-size:15px;line-height:1.55;">${bodyHtml}</td></tr>
</table>`;
}

export function renderResponseTable(rows: Array<[string, string]>): string {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border:1px solid #d8d3c8;border-radius:8px;border-collapse:separate;border-spacing:0;overflow:hidden;">
${rows.map(([label, value], index) => `<tr style="background-color:${index % 2 === 0 ? "#f8f7f3" : "#ffffff"};">
  <th align="left" valign="top" width="38%" style="padding:10px 12px;border-bottom:${index === rows.length - 1 ? "0" : "1px solid #e5e0d7"};color:#3d5468;font-size:13px;font-weight:700;line-height:1.45;">${escapeHtml(label)}</th>
  <td valign="top" style="padding:10px 12px;border-bottom:${index === rows.length - 1 ? "0" : "1px solid #e5e0d7"};color:#1f2b36;font-size:14px;line-height:1.45;overflow-wrap:anywhere;">${escapeHtml(value)}</td>
</tr>`).join("\n")}
</table>`;
}

export function renderFinePrint(value: string): string {
  return `<p style="margin:24px 0 0;padding-top:16px;border-top:1px solid #e5e0d7;color:#657484;font-size:12px;line-height:1.55;text-align:center;">${escapeHtml(value)}</p>`;
}
