# BYC Camp Manager - Master Specification

**Believer's Youth Camp** - A summer church camp where youth from churches across the country come together to attend. This software manages camper registration and on-site camp operations.

Node.js + React Web Application | PostgreSQL Database | AWS Deployment

---

> ## Outstanding Items & TBD Questions
>
> The following items still need to be decided before development of the relevant features. Camp admins and stakeholders - please review and provide input.
>
> 1. **Worker T-Shirt Checkout** - The legacy worker form captures shirt size intent only. Should the in-app worker flow collect payment for worker shirts via Stripe, or remain informational with purchase handled elsewhere (online store / at camp), matching current practice?
> 2. **Report Requirements** - What specific summary reports do camp admins need beyond dorm rosters? See the [Reports](#reports) section for proposed examples.
> 3. **Merchandise Pricing** - What merch items will be available for pre-order (t-shirts, hats, etc.)? What are the prices and available sizes/options? Merch pricing can be configured in the admin interface and may also be adjustable through Stripe.
> 4. **Check-in Confirmation Email** - What information should be included in the email sent to parents after check-in? (e.g., dorm assignment, dorm leader name, emergency contact info?)

---

## Table of Contents

- [1. Overview](#1-overview)
- [2. Technical Architecture](#2-technical-architecture)
- [3. User Roles & Authentication](#3-user-roles--authentication)
- [4. Registration System](#4-registration-system) (includes [Worker Registration Flow](#worker-registration-flow))
- [5. Payment](#5-payment)
- [6. Camp Management](#6-camp-management)
- [7. Check-In](#7-check-in)
- [8. Dorm Management](#8-dorm-management)
- [9. Reports](#9-reports)
- [10. Email Notifications](#10-email-notifications)
- [11. CSV / Spreadsheet Import](#11-csv--spreadsheet-import)
- [12. Data Model Overview](#12-data-model-overview)
- [13. Future / Wish-List Items](#13-future--wish-list-items)

---

## 1. Overview

BYC Camp Manager is a web application for managing summer camp registration and on-site camp operations. The system has two major functional areas:

1. **Public Registration** - Three separate unauthenticated flows, each gated by its own open date/time: **family (camper) registration** for parents/guardians, **worker registration** for adult volunteers/staff, and **leader registration** for dorm leaders. Campers use medical release and camper fees; workers and leaders use their respective legacy intake field sets. Stripe applies only where payment is required.
2. **Admin Management** - A protected admin interface for managing camper and worker records, dorm assignments, assisted check-in, payment tracking, and generating printable reports. At the physical check-in location, attendees can scan a posted camp self-check-in QR code and complete the public self-check-in flow.

The registration system may not be used in the first year of operation. The admin/management side must be fully functional independently, supporting bulk CSV import of camper (and optionally worker) data so that camp operations can proceed even if registration was handled externally.

---

## 2. Technical Architecture

### Stack

| Layer    | Technology                                            |
| -------- | ----------------------------------------------------- |
| Frontend | React (SPA)                                           |
| Backend  | Node.js (Express or similar)                          |
| Database | PostgreSQL                                            |
| Payments | Stripe                                                |
| Hosting  | AWS (specific services TBD)                           |
| QR Codes | Camp self-check-in QR generated server-side and posted at the physical check-in location; not emailed to registrants |
| Email    | Transactional email service (e.g., AWS SES, SendGrid) |

### Key Technical Considerations

- The public self-check-in experience and the admin-assisted check-in interface must be **mobile-friendly / responsive**. Attendees scan the camp's posted QR code with their own device; staff can assist by searching for a person by name.
- The public **camper (family)**, **worker**, and **leader** registration experiences should each be a clean, accessible form (multi-step or single page) optimized for both mobile and desktop.
- The API should be RESTful with proper authentication middleware protecting admin routes.
- Public registration routes are accessible without login but each is gated by its own configurable **open date/time** until the scheduled opening (see [Registration Form Availability](#registration-form-availability)).

---

## 3. User Roles & Authentication

### Roles

| Role            | Description                                                                                     |
| --------------- | ----------------------------------------------------------------------------------------------- |
| **Super Admin** | Full system access. Can manage all settings, users, camp configuration (dates, registration windows, fees, camper capacity, age group definitions), dorm inventory (create/edit all dorms and capacities), and camper data. |
| **Camp Admin**  | Operational access. Can perform check-in, view/manage camper data, manage dorms, run reports.   |

There are no login-based roles for parents, campers, dorm leaders, or workers. **Parents** use the public **family (camper) registration** form. **Workers** use the public **worker registration** form. **Dorm leaders** use the public **leader registration** form. Workers and leaders may also be entered by admins or import.

### Authentication

- Username/password authentication for admin users.
- Super admins can create, deactivate, delete, and reset passwords for any admin user.
- Session or token-based auth (JWT) for API access.
- No self-service registration for admin accounts - they must be created by a super admin.
- No public-facing "forgot password" flow - super admins handle password resets.

---

## 4. Registration System

### Registration Form Availability

Super admins configure **separate** open dates/times for each public flow (they may be identical for a given year if desired):

- **Family (camper) registration** - open date/time, optional countdown until zero, then live form (same behavior as previously specified for the parent/camper flow). If a **camp capacity** is configured for the year (see [Camp Configuration (Super Admin)](#camp-configuration-super-admin)), the camper form must also refuse new registrations once camper headcount reaches that cap, even when the open window is still active.
- **Worker registration** - its own open date/time and optional countdown; when closed, the worker registration route is not available; when open, no login or account is required.
- **Leader registration** - its own open date/time and optional countdown; when closed, the leader registration route is not available; when open, no login or account is required.

For each flow, before the open time the public page may display a **countdown timer**; after zero, the live form is shown (no page refresh required for countdown transition, if implemented).

### Family Registration Flow

The flow begins by asking whether the registrant is an adult camper registering themselves or a parent/guardian registering campers. Adult self-registration is limited to one camper who is at least 18 on the submission date. Parent/guardian registration supports one or more campers.

For storage and downstream operational compatibility, an adult self-registrant's own contact details are used as the registration and camper contact, with the relationship recorded as **Self**.

#### Entry Choice - Registration Type

- **I am 18 or older and registering myself** - collect the adult camper's own email, phone, mailing address, and camper information; do not request parent/guardian information.
- **The camper is under 18, or I am a parent/guardian** - use the family flow below for minors, children, or multiple campers; a parent or legal guardian completes this branch.

#### Step 1 - Parent / Guardian Information

- Parent/guardian full name
- Email address
- Phone number
- Mailing address
- Relationship to camper(s)

#### Step 2 - Camper Information (repeatable for each child)

The parent adds one or more campers. For each camper, collect at least the fields required for **legacy parity** with [Camper Registration - BYC 2026](https://docs.google.com/forms/d/e/1FAIpQLSeIEgbd-w0vlTgxnMCbNaKxks82kb28FRWQEl9sRRfK9tIOGw/viewform) (see [Camper fields (legacy parity)](#camper-fields-legacy-parity)). The family flow may still collect parent email and relationship in Step 1; align per-camper vs. family-level fields so nothing required on the legacy form is missing.

**Baseline per camper (legacy + existing spec where still applicable):**

- Legal first name, last name, optional middle name or initial
- Date of birth, gender
- Mailing address (street, city, state/province/territory, zip, country) — legacy form asks that multi-camper addresses stay **congruent**; the app should allow one shared address with optional per-camper override if needed
- Camper cell number (digits only, optional if not applicable)
- Parent/guardian name and phone (required on legacy form; may default from Step 1)
- Faith/church: whether the camper identifies as a Christian (yes/no), whether they have received the **gift of the Holy Ghost** since they believed (yes/no), church presently attending, pastor full name
- T-shirt size intent (required on legacy form; options match legacy list — see parity table)
- **Medical / dietary / allergies / medications / special needs** — collect as today if not on the public Google Form pages (may be covered by separate emergency medical form for minors, waiver step, or later pages); do not drop fields the camp still needs for operations and rosters

#### Step 3 - Medical Release & Legal Agreement

- Display the medical release / liability waiver text.
- Parent/guardian provides a **digital legal signature** (typed full name + checkbox acknowledgment, or drawn signature via signature pad).
- Adult self-registrants receive and sign an adult-specific authorization that identifies them as the camper and does not assert that they are a parent or legal guardian.
- Timestamp and IP address recorded for legal purposes.

#### Step 4 - Merchandise Pre-Order (Optional)

- After the medical release, the parent is presented with available camp merchandise for pre-order (e.g., t-shirts, hats).
- Each merch item displays its name, price, and available options (size, color, etc.).
- The parent can select items and quantities per camper or per family as appropriate.
- Pre-ordering is optional - the parent can skip this step entirely.
- **Purpose:** Pre-orders allow the camp to order only the exact quantities and sizes needed, eliminating excess inventory carried over between years.
- **TBD: Specific merch items and pricing.** Super admins can configure available merchandise, options, and prices through the admin interface.

#### Step 5 - Payment

> **UX Priority:** Pricing clarity is critical. Parents have historically been confused about how much they owe. The payment step must make the total unmistakably clear regardless of payment method.

- Display a prominent, **itemized pricing breakdown** styled as a receipt/invoice:
  - Each camper listed by name with their individual fee (e.g., "Sarah Smith - $165")
  - If a multi-child discount applies, show the full price struck through next to the discounted price for the 3rd+ child (e.g., "~~$165~~ $90") with a label like "Family discount"
  - Merchandise pre-order line items (if any), each with item name, options, quantity, and price
  - A clear **subtotal** for registration fees and merchandise separately
  - A bold, large-font **total amount due**
- The total amount due should remain **persistently visible** on screen as the parent selects a payment method - it should not scroll out of view.
- Parent selects payment method:
  - **Pay now via Stripe** - Processes the payment immediately (registration fee + merch). Registration is confirmed upon successful payment.
  - **Pay at camp with cash** - Registration is confirmed but marked as unpaid. The confirmation screen and email must **clearly restate the total amount that will be due in cash at check-in** so the parent knows exactly how much to bring.
- Reaching this review/payment screen saves only a temporary registration draft and capacity reservation. It must not create camper/person records or expose campers in admin management until Stripe payment succeeds or the parent explicitly selects pay at camp.
- After successful submission, a confirmation page is displayed that repeats the full pricing breakdown and payment status.

#### Post-Registration

- A confirmation email is sent to the parent/guardian email address containing:
  - Registration confirmation details
  - Merchandise pre-order summary (if any items were ordered)
  - Instructions that attendees will scan the posted self-check-in QR code after arriving at the physical check-in location
  - Any relevant camp information (dates, what to bring, etc.)
- Do not email individual camper QR codes or the camp self-check-in QR code/URL. The posted camp QR is intended to be available at the physical check-in location.

#### Camper fields (legacy parity)

The **family (camper)** registration UI should expose configurable **camp header** content equivalent to the top of the legacy Google Form (dates, **check-in after 4:00 p.m.** on arrival day, ages **10–25**, venue name and address, fee summary, Square / payment links, contact phone and email, and notices: e.g. campers under 18 must submit the **emergency medical form** from [Believersyouthcamp.com/registrationforms](https://Believersyouthcamp.com/registrationforms); youth **over 25** should use the **worker** form).

**Authoritative checklist** (same semantics as [Camper Registration - BYC 2026](https://docs.google.com/forms/d/e/1FAIpQLSeIEgbd-w0vlTgxnMCbNaKxks82kb28FRWQEl9sRRfK9tIOGw/viewform); cross-check all pages of the live form before release):

| Field | Required on legacy form | Notes |
| ----- | ------------------------- | ----- |
| Email | Yes | In a **family** flow, typically one parent email for the registration; ensure every required legacy answer is captured somewhere. |
| First name (legal) | Yes | |
| Last name | Yes | |
| Middle name or initial | No | |
| Gender | Yes | **Male**, **Female** (same as legacy). |
| Date of birth | Yes | |
| Street address | Yes | Legacy asks that multiple campers in one family use **congruent** addresses. |
| City | Yes | |
| State/Province/Territory | Yes | Dropdown must match legacy: US states, **DC**, **GU**, **PR**, Canadian provinces/territories (**NL**, **PE**, **NS**, **NB**, **QC**, **ON**, **MB**, **SK**, **AB**, **BC**, **YT**, **NT**, **NU**) — verify against live form for any additions (e.g. **Other**). |
| Zip code | Yes | |
| Country | Yes | Free text (e.g. USA, CAN). |
| Cell number | No | Legacy: **numerical only** (e.g. 8881234567). |
| Parent/Guardian contact number | Yes | Numerical only on legacy form. |
| Parent/Guardian name | Yes | |
| Are you a Christian? | Yes | **Yes** / **No**. |
| Have you received the gift of the Holy Ghost since you believed? | Yes | **Yes** / **No**. |
| Church presently attending | Yes | |
| Pastor name (first and last) | Yes | |
| T-shirt size | Yes | Legacy options: **Not interested**, **Adult XS** … **Adult XXL**, **Youth S** … **Youth XL**, **Other**. Legacy note: unisex shirts, sold online and in person; may run large — copy can be admin-edited. |

**Fees shown on legacy form (2026 copy)** — must be configurable per year; implement the same **structure** in the app and in Stripe/receipt copy:

- **Before June 10:** **$165** each for 1st–2nd sibling, **$90** each for 3rd and additional siblings.
- **On or after June 10:** **$180** each for 1st–2nd sibling, **$90** each for 3rd and additional siblings.

Online pre-payment link on legacy materials: [believersyouthcamp.square.site](https://believersyouthcamp.square.site/) (Square).

### Worker Registration Flow

Adult workers (volunteers/staff) complete a **dedicated worker registration** in the application. Field names, option lists, and required flags must match the current production intake, which is documented in the legacy Google Form: [Worker Registration - BYC 2026](https://docs.google.com/forms/d/1zPJxB8K0RTSgX8inXz31n1qGvTppUQ8p9efKQLCNVmU/viewform) (use this as the authoritative checklist for parity during implementation and QA).

The worker-facing page should display configurable **camp header** content (dates, check-in instructions, physical address, contact phone/email) equivalent to the information shown at the top of the Google Form.

#### Collected fields (same semantics as the Google Form)

| Field | Required | Notes |
| ----- | -------- | ----- |
| Email | Yes | |
| First name | Yes | |
| Last name | Yes | |
| Date of birth | No | Optional on legacy form; collect when present for age verification or reporting. |
| Gender | Yes | Options: **Male**, **Female** (same as legacy). |
| Cell number | Yes | |
| Alt. number | No | |
| Street address | Yes | |
| City | Yes | |
| State or province | Yes | Option list must match legacy: US states, **DC**, **PR**, Canadian provinces (**ON**, **QC**, **NS**, **NB**, **MB**, **BC**, **PE**, **SK**, **AB**, **NL**), and **Other** (same set and labels as Google Form). |
| Zip code | Yes | |
| Country | Yes | Free text (e.g., USA, CAN) as on legacy form. |
| How long have you been faithfully serving the Lord? | Yes | Long text. |
| Church presently attending | Yes | |
| Pastor name | Yes | |
| Pastor's phone number | Yes | |
| Preferred tasks (top 3) | Yes | Worker must rank **three** distinct choices from the fixed list below. UI copy should reflect legacy text: assignments are based on camp need, not strictly preferences; hair clinic, crafts, and serving lines are not full-time duties and volunteers selecting those may receive additional jobs. **Night Watch** and **Administrative duties** must be labeled **(pre-approval required)** in the UI. |
| Worker T-shirt size | No | Same options as legacy: **Not interested**, **XS**, **S**, **M**, **L**, **XL**, **XXL**, **XXXL or larger**. Display the legacy note that shirts are unisex, may run large on smaller frames, and are sold online and in person (wording can be admin-edited). |

**Task preference choices** (exact labels):

1. Kitchen  
2. Snack Bar  
3. Serving Lines  
4. Cleaning Crew  
5. Sports and Recreation  
6. Hair Clinic  
7. Crafts  
8. Medical Nurse  
9. Night Watch (pre-approval required)  
10. Administrative duties (pre-approval required)  

#### Informational content (not form fields)

Replicate the legacy form’s static guidance on the confirmation step and/or confirmation email:

- Written **testimony** and **pastor’s letter of recommendation** are required for all workers; submit to the camp email or have the pastor call the designated camp contact for a verbal recommendation (contact details admin-configurable).
- Workers and leaders are expected to follow the same rules as campers (e.g., camp rules summary admin-configurable, including legacy copy such as expectations around appearance standards if still policy).

#### Post–worker registration

- A **confirmation email** is sent to the worker’s email with a copy of their submitted answers (equivalent to Google Forms “get a copy of your responses”).
- Workers do **not** pay a camp registration fee through this flow. Optional paid worker merchandise (e.g., t-shirt) is covered in [Payment](#payment) and **TBD** in Outstanding Items.
- The worker confirmation explains that workers scan the posted self-check-in QR code after arriving at the physical check-in location; it does not contain the QR code or its URL.
- Each submitted worker registration creates or updates a **Worker** record for the camp year (see [Data Model](#12-data-model-overview)). Admins may still add workers manually or via CSV; import rules should avoid duplicate persons where possible (**TBD** matching strategy: email + name + year).

### Leader Registration Flow

Adult dorm leaders complete a dedicated public registration form. The field contract is based on the prior-year leader response CSV and remains distinct from worker task registration.

| Field | Required | Notes |
| ----- | -------- | ----- |
| Email, first name, last name | Yes | |
| Date of birth | Yes | Date only; future dates are invalid. |
| Gender | Yes | Male or Female. |
| Cell number | Yes | 10–15 digits. |
| Alt. number | No | |
| Street address, city, state or province, zip code, country | Yes | State/province options match the worker form. |
| Marital status | Yes | Free text with Single and Married suggested from the historical responses. |
| How long faithfully serving the Lord | Yes | Long text. |
| Church presently attending | Yes | |
| Pastor name and pastor phone | Yes | |
| Preferred age group | Yes | Suggested from active camp-year age groups while allowing the leader to enter the historical label used by camp. |
| T-shirt size | No | Same size options and separate-purchase guidance as worker registration. |

Each successful submission creates a **Dorm Leader** record with online-registration provenance so the leader is immediately available to admin people, dorm assignment, and check-in workflows. Submission keys make safe retries idempotent. A likely duplicate email or matching name and phone is rejected without overwriting the existing leader.

---

## 5. Payment

### Stripe Integration

- Stripe is used for online credit/debit card payments during **family (camper) registration** where the parent elects to pay now.
- The system creates a single Stripe charge per family registration (total of all camper fees minus discounts, plus any merchandise pre-orders).
- Payment status is tracked per family registration: **Paid (Stripe)**, **Paid (Cash)**, or **Unpaid**.

### Worker registration and money

- There is **no** worker “camp tuition” charge in the worker registration flow (workers are volunteers).
- **Worker t-shirt** selection is captured as on the legacy form; whether the app charges for shirts via Stripe in the same session is **TBD** (see Outstanding Items). Until implemented, shirt rows may be informational only and fulfilled through existing online/in-person sales processes.

### Cash Payments

- If a family elects to pay at camp, their registration is recorded with a status of **Unpaid**.
- During check-in, camp admins can mark the family registration as **Paid (Cash)**.
- The system should display unpaid registrations prominently so admins can collect payment.

### Offline Church Payments

- Admins may record an in-person church **check** or **cash** payment and allocate it to selected campers at that church for one camp year.
- Church payments apply only to camper registration-fee balances. They never pay family merchandise and never create Stripe objects.
- Checks require a check/reference number. Every payment records its tender, amount, received date, entering admin, idempotency key, camper allocations, and any later void reason/actor.
- Allocations must be positive, may not exceed a camper's numeric remaining registration-fee balance, and must equal the amount received. Unallocated overpayments are blocked.
- Payment eligibility and the displayed `unpaid` / `partially paid` / `paid` state are derived from `feeDueCents - feePaidCents`; the payment ledger retains the source.
- Voids preserve the original ledger row and reverse allocations transactionally. A payment with a later dependent allocation must be voided in reverse order.

### Multi-Child Discounts and Early / Late Pricing

Legacy 2026 camper materials use a **June 10** cutover for the first-two-sibling rate (see [Camper fields (legacy parity)](#camper-fields-legacy-parity)). The app should support configurable **early** and **late** base rates for the 1st–2nd child tier, plus a separate rate for the **3rd+** child tier (unchanged across cutover in current practice).

**Default amounts matching current Google Form / Square copy:**

- **Before the early-registration deadline (e.g. June 10):** **$165** per camper for the **first two** children; **$90** per camper for the **third and each additional** child.
- **On or after that deadline:** **$180** per camper for the **first two** children; **$90** per camper for the **third and each additional** child.

Examples (early pricing):

- 1 camper: $165
- 2 campers: $330 ($165 + $165)
- 3 campers: $420 ($165 + $165 + $90)
- 4 campers: $510 ($165 + $165 + $90 + $90)
- 5 campers: $600 ($165 + $165 + $90 + $90 + $90)

Examples (late pricing for 1st–2nd tier only):

- 1 camper: $180
- 2 campers: $360 ($180 + $180)
- 3 campers: $450 ($180 + $180 + $90)

Super admins configure the deadline date/time, early base fee, late base fee, and 3rd+ child fee through the admin interface.

---

## 6. Camp Management

### Camp Configuration (Super Admin)

Super admins can configure the following camp-wide settings:

- **Camp name and year**
- **Camp dates** (start and end date)
- **Family (camper) registration open date/time** - controls when the parent/camper public form becomes accessible  
- **Worker registration open date/time** - controls when the worker public form becomes accessible
- **Leader registration open date/time** - controls when the leader public form becomes accessible
- **Camp capacity (camper maximum)** - optional hard cap on the number of campers for the year. When configured, the **family (camper) registration** flow must block new camper submissions once the cap is reached (with a clear message to the parent). CSV import and admin-created campers should respect the same cap or surface warnings—exact enforcement rules can be tightened during implementation so operations are never surprised.
- **Registration fee schedule** - early vs. late **base** rate for 1st–2nd camper (e.g. $165 / $180), **cutover date/time** (e.g. June 10), and **3rd+ child** rate (e.g. $90); see [Multi-Child Discounts and Early / Late Pricing](#multi-child-discounts-and-early--late-pricing)
- **Discount tiers** - legacy model is “2 full tiers + reduced 3rd+”; amounts are configurable
- **Merchandise catalog** - items available for pre-order, with names, prices, and options (sizes, colors, etc.). **TBD: Specific items and pricing.**
- **Age group definitions** - named age brackets (each with min/max age or equivalent rules) used for **camper** dorm assignment and reporting (e.g., "Juniors: 7-9", "Teens: 13-15"). Super admins create, edit, reorder, and deactivate brackets per camp year; the product may ship with **sensible defaults** in seed data or migrations, but the live list is always admin-owned—no stakeholder sign-off is required to “freeze” age bands before build.

### People in the System

The system tracks three categories of people:

| Category         | Description                                                                 |
| ---------------- | --------------------------------------------------------------------------- |
| **Campers**      | Children attending camp. Registered via form or CSV import.                 |
| **Workers**      | Adult volunteers/staff helping at camp. Registered via the **worker registration** form, and/or entered via admin interface or CSV. |
| **Dorm Leaders** | Adults assigned to lead specific dorms. Registered via the **leader registration** form, and/or entered via admin interface or CSV. |

Workers and dorm leaders share a similar data profile (name, gender, contact info) but are distinguished by their role. Workers are assigned only to **worker dorms** (dorms whose purpose is worker housing). Dorm leaders are assigned to **camper dorms**. The system treats camper dorms and worker dorms as distinct types so assignments and rules stay correct. Workers and dorm leaders do not pay a camp registration fee.

### Church Directory and Cleanup

- Churches are global first-class records shared by camp years. Their exact identity is the conservatively normalized pair of church name and pastor name; identical church names with different pastors remain separate.
- Public camper, worker, and leader forms suggest canonical churches while the registrant types. The church field remains editable, and free typing never requires an "add church" action.
- A complete free-typed pair is silently reused or created only when the attendee is confirmed. Pending/abandoned family drafts and unresolved duplicate worker submissions do not create attendee mappings.
- Original submitted church and pastor text remains on the person record. Canonical display comes from the related church.
- Admins can review incomplete mappings and likely duplicates, rename a canonical identity, remap selected attendees, and merge records after an affected-record preview.
- Fuzzy similarity is an explainable review signal only. It never merges or remaps data automatically.
- Merged churches remain redirect records, and prior approved identities remain aliases so future registration/import values resolve to the survivor.
- Rename, remap, and merge mutations record actor, timestamp, source/target, and affected record identifiers in the audit log.

---

## 7. Check-In

Check-in is performed on the day(s) campers arrive through the posted public self-check-in flow, with camp admins available to assist.

### Posted QR Self Check-In

1. Camp staff display the camp-specific self-check-in QR code at the physical check-in location.
2. The attendee or parent scans the posted QR code with their own phone and opens the public self-check-in page.
3. The attendee searches for and selects the appropriate camper, worker, or dorm leader record.
4. For campers, the system displays the relevant check-in context, including:
   - Camper name
   - Dorm assignment (building/room name)
   - Payment status and remaining balance, if any
   - Available online or staff-assisted payment path
5. The attendee confirms check-in after resolving any required payment step. The person is marked as **Checked In**.
6. The page displays the dorm assignment or next arrival instructions.

The posted QR identifies the camp-year self-check-in entry point, not an individual camper. Do not require registrants to retain or present a personal QR code.

### Staff-Assisted Check-In

- If an attendee does not have a suitable device or needs help, an admin can search by **camper name** in the protected check-in interface.
- Search results display matching campers. Admin selects the correct camper and proceeds with the assisted payment and check-in flow.
- Remove the obsolete individual camper QR tokens and staff camera-scanning path. The posted camp-level self-check-in QR and staff-assisted name search are the supported arrival workflows.

### Worker & Dorm Leader Check-In

- Workers and dorm leaders can be checked in through the same interface using name search.
- Upon check-in, they are shown their dorm assignment.

### Check-In Dashboard

- The check-in screen should display a running summary:
  - Total registered campers vs. total checked in
  - Total workers/dorm leaders registered vs. checked in
  - Count of unpaid registrations remaining
- This gives admins a real-time snapshot of arrival progress.

---

## 8. Dorm Management

### Dorm Configuration

The **full dorm inventory** for a camp year—how many dorms exist, and each dorm’s name, bed capacity, **purpose (camper vs worker)**, and (where applicable) gender designation—is defined only in the system by **super admins** (create, edit, archive). There is no dependency on an external “starting list” from stakeholders before development; initial-year data is entered through the admin UI (or optional bulk tools if added later).

Super admins can create and configure dorms with the following properties:

- **Dorm purpose** - **Camper dorm** or **Worker dorm**. This is the primary way the system distinguishes housing for youth from housing for staff/volunteers; it drives which people can be assigned, which fields apply, and which validation rules run.
- **Dorm name** (e.g., "Cabin A", "Building 3 Room 201", "Staff Lodge")
- **Gender designation**
  - **Camper dorms** - Always **single gender**: **Boys** or **Girls** only. Co-ed is not available for camper dorms.
  - **Worker dorms** - Configurable per dorm: **Boys**, **Girls**, or **Co-ed**. Co-ed supports married couples, families with young children, or any camp policy that allows mixed-gender worker housing; single-gender worker dorms are available when the camp prefers to separate by gender.
- **Age group** - One of the configured age group brackets (**camper dorms only**; worker dorms do not use camper age brackets for assignment logic)
- **Bed count / capacity** - Every assigned person consumes one bed, including each dorm leader assigned to a camper dorm.
- **Assigned dorm leader(s)** (**camper dorms**; worker dorms do not need assigned leaders)

### Auto-Assignment

- When camper data is available (via registration or CSV import), the system can **auto-assign campers to camper dorms** based on:
  - Gender (must match the dorm's single-gender designation)
  - Age group (calculated from date of birth)
- Auto-assignment fills dorms up to their bed capacity.
- Workers are auto-assigned only to dorms with **purpose = Worker**. Workers are never auto-assigned into camper dorms, and campers are never auto-assigned into worker dorms.

### Manual Assignment (Drag and Drop)

- After auto-assignment (or at any time), camp admins can **manually reassign** people between dorms using a **drag-and-drop interface**.
- The interface should display:
  - **Camper dorms** and **worker dorms** in clearly separated sections (or with explicit labels), each further grouped by gender designation as appropriate
  - Each dorm showing its current occupants and remaining capacity
  - An "unassigned" area for people not yet assigned to a dorm
- Drag a person from one dorm to another, or from unassigned to a dorm. Valid targets depend on role: **campers** and **dorm leaders** only in **camper dorms**; **workers** only in **worker dorms**. The UI should block or strongly discourage invalid combinations (e.g., a camper or dorm leader in a worker dorm, or a worker in a camper dorm).
- The system should warn (but not prevent) if an assignment violates gender or age group rules **for camper dorms**, in case an admin needs to make an exception.
- **Worker dorms:** If the dorm is **co-ed**, gender mismatch warnings do not apply. If the dorm is **single gender** (Boys or Girls), the same style of gender warning as for camper dorms applies when assigning someone of a different gender.

### Dorm Roster View

- For any dorm, admins can view a detailed roster showing:
  - All assigned people (name, age, check-in status)
  - Dorm leader(s)
  - Capacity used vs. total
  - Medical notes summary (allergies, medications) for the dorm leader's reference

---

## 9. Reports

All reports should be viewable on screen and available as **printable / PDF-exportable** documents.

### Dorm Report (Required)

- **Per-dorm roster** listing all assigned campers with:
  - Camper name
  - Age
  - Check-in status (checked in or not yet arrived)
  - Parent/guardian name and phone number
  - Medical notes (allergies, medications)
- Intended to be printed and given to dorm leaders for roll call and reference.

### Additional Reports (TBD - Examples for Consideration)

The following are proposed reports. **Camp admins should review and confirm which are needed:**

- **Registration Summary** - Total registrations, breakdown by age group, gender, payment status; include **worker registration** counts and optional breakdown by preferred tasks.
- **Financial Summary** - Total revenue collected (Stripe, direct cash, church check, and church cash), church payment/allocation count, voided church amount, outstanding numeric camper registration-fee balances, and discount amounts applied.
- Church payment exports include canonical church/pastor, tender, reference, received date, camper allocation, and void status; admin-only notes are omitted.
- **Medical Summary** - All campers with allergies, medications, or special medical needs, grouped by dorm. Useful for camp nurse / medical staff.
- **Dietary Needs Report** - All campers with dietary restrictions, for kitchen staff.
- **Check-In Status Report** - Real-time list of who has and hasn't checked in, filterable by dorm.
- **Emergency Contact List** - All campers with their emergency contact info, organized by dorm.
- **Head Count Summary** - Total campers, workers, and dorm leaders on site (checked in) vs. expected.
- **Merchandise Order Summary** - Total quantities per merch item and option (e.g., 45 Medium t-shirts, 30 Large t-shirts, 12 hats). Used for placing bulk orders with suppliers so only the exact needed quantities are purchased.

---

## 10. Email Notifications

The system sends transactional emails at the points below.

### 1. Family (camper) registration confirmation

Sent immediately after a family completes **camper** registration. Contains:

- Confirmation that registration was received
- List of registered campers
- **Full itemized pricing breakdown** (same receipt-style format shown during registration)
- Merchandise pre-order summary (if any items were ordered)
- Payment status: if paid via Stripe, a confirmation of payment received; if paying cash, a **prominent reminder of the exact total amount due at check-in**
- Arrival instructions explaining that attendees scan the posted self-check-in QR code at the physical check-in location
- Camp dates and relevant information

The email must not contain an individual camper QR code or the camp self-check-in QR code/URL.

### 2. Worker registration confirmation

Sent immediately after a worker submits **worker registration**. Contains:

- Confirmation that the registration was received
- A **copy of submitted responses** (all fields), equivalent to Google Forms’ emailed response copy
- Reminders from the informational block (testimony, pastor recommendation, rules expectations) as appropriate
- Arrival instructions explaining that the worker scans the posted self-check-in QR code at the physical check-in location; do not include the QR code or its URL

### 3. Check-In Confirmation Email

Sent to the parent/guardian email after a **camper** is checked in at camp. Contains:

- Confirmation that the camper has been checked in
- Dorm assignment
- **TBD: Additional info to include (dorm leader name, emergency contact info, etc.)**

No other automated emails are required beyond the above and any future explicitly scoped notifications. If registrants need to update information, they contact the camp directly unless a future portal is added.

---

## 11. CSV / Spreadsheet Import

### Purpose

The software may not be ready for public registration before the first year's camp. In that case, registration will be handled externally and camper data will be imported into the system via CSV so that the admin/management features (dorm assignment, check-in, reports) can still be used.

### Import Behavior

- **One-time bulk import** - this is not intended for ongoing sync or repeated imports.
- No merging or deduplication with online registrations. The CSV import and the online registration system are treated as separate data sources for separate camp years.
- Super admins upload a CSV file through the admin interface.
- The system validates the file, previews the data, and shows any errors or warnings before committing the import.
- Imported campers are treated identically to online-registered campers for all management features.
- **Worker import (optional)** - A separate template or mode may import workers; column mapping should align with the [Worker Registration Flow](#worker-registration-flow) field list where applicable.

### Expected CSV Fields

The CSV should map to the camper data model. At minimum:

- Camper first name
- Camper last name
- Date of birth
- Gender
- Parent/guardian name
- Parent/guardian email
- Parent/guardian phone
- Allergies / medical info
- Payment status (paid / unpaid)

The system should handle reasonable variations in column naming and provide a column-mapping interface if headers don't match exactly.

### Worker CSV (optional)

If worker bulk import is supported, columns should map to worker registration fields (email, name, phones, address components, gender, church, pastor contact, serving response, ranked task preferences, t-shirt size, etc.) plus admin fields (dorm assignment, check-in) as needed.

---

## 12. Data Model Overview

### Church

- Permanent UUID, canonical and normalized church/pastor names, optional merge redirect, review timestamp, and timestamps.
- Alias identities resolve one normalized pair to one active canonical church.
- Campers, workers, worker registration submissions, and dorm leaders retain submitted name snapshots plus an optional canonical `churchId`.

### Church Payment

- Church, camp year, `check`/`cash` tender, amount, received date, reference, optional notes, entering admin, idempotency key, created timestamp, and reversible void metadata.
- One or more unique camper allocations contain positive applied registration-fee amounts. Payment and allocations are an immutable audit ledger rather than Stripe records.

This section outlines the core data entities. Exact schema will be defined during development.

### Family Registration

- Registration ID
- Parent/guardian name, email, phone, address
- Registration date
- Payment method (Stripe / Cash)
- Payment status (Paid / Unpaid)
- Stripe transaction ID (if applicable)
- Total amount charged
- Discount applied
- Merchandise order total

### Merchandise Order

- Order item ID
- Family registration ID (FK)
- Merch item name
- Selected options (size, color, etc.)
- Quantity
- Unit price
- Line total

### Merchandise Item (Admin-Configured)

- Item ID
- Name (e.g., "Camp T-Shirt", "Camp Hat")
- Available options (sizes, colors, etc.)
- Price
- Active status (whether it appears in the registration form)

### Camper

- Camper ID
- Family registration ID (FK)
- First name, last name, optional middle name or initial
- Date of birth
- Gender
- **Address:** street, city, state/province/territory, zip, country (per legacy form; often congruent across siblings)
- **Phones:** camper cell (optional), parent/guardian phone (required for parity)
- **Parent/guardian name** (required on legacy form; may mirror family record)
- **Faith (legacy parity):** Christian (yes/no), Holy Ghost since believed (yes/no)
- Church presently attending, pastor name (same semantics as legacy; merge with any “organization affiliation” field if a single column is preferred in CSV/API)
- Allergies / medical conditions
- Medications
- Dietary restrictions
- T-shirt size (legacy option set: not interested, adult/youth sizes, other — see [Camper fields (legacy parity)](#camper-fields-legacy-parity))
- Emergency contact name and phone
- Special needs / accommodations
- Dorm assignment (FK)
- Check-in status (not checked in / checked in)
- Check-in timestamp
- Medical release signed (boolean)
- Import source (online registration / CSV import)

### Worker (volunteer / staff)

Stores a worker for a camp year. May be created from **online worker registration**, **admin entry**, or **CSV import**.

- Worker ID
- Camp year / season (FK or label)
- **Identity & contact:** email (unique per year **TBD**), first name, last name, date of birth (optional), gender (`male` / `female`), cell phone, alt phone
- **Address:** street, city, state or province (enum matching Google Form options), zip, country (string)
- **Faith & church:** how long faithfully serving the Lord (long text), church presently attending, pastor name, pastor phone
- **Task preferences:** first choice, second choice, third choice (each FK or enum to the ten fixed task options; must be three distinct choices)
- **Worker t-shirt:** size selection (`not_interested`, `xs`, `s`, `m`, `l`, `xl`, `xxl`, `xxxl_or_larger`) — same semantics as legacy form
- **Provenance:** import source (online worker registration / admin / CSV); submission timestamp; optional IP for abuse prevention
- **Admin:** dorm assignment (FK to worker dorm), check-in status, check-in timestamp
- **Optional future flags:** testimony received, pastor recommendation received (if camp wants to track in-system; **TBD**)

### Dorm Leader

Dorm leaders are created through their own public leader registration flow, admin entry, or CSV import. They are not created through the worker registration flow.

- Person ID
- **Identity & contact:** email, first name, last name, date of birth, gender, cell phone, optional alternate phone
- **Address:** street, city, state or province, zip/postal code, country
- **Personal & faith:** marital status, how long faithfully serving the Lord, church, pastor name, pastor phone
- **Camp preference:** preferred camper age group, optional T-shirt size
- **Provenance:** import source, public submission timestamp, optional IP, idempotency key/digest
- Dorm assignment (FK to **camper** dorm)
- Check-in status
- Check-in timestamp

### Dorm

- Dorm ID
- **Purpose** - `camper` or `worker` (distinguishes camper dorms from worker dorms for assignment, UI grouping, and validation)
- Name
- **Gender designation** - For **camper** dorms: `boys` or `girls` only. For **worker** dorms: `boys`, `girls`, or `co_ed` (super-admin configurable per dorm)
- Age group (FK or label; **camper dorms only**; null or N/A for worker dorms)
- Bed count / capacity
- Assigned dorm leader(s) (typically **camper** dorms)

### Camp Configuration

- Camp year / name
- Camp start and end dates
- Optional **maximum camper count** (camp capacity) and behavior when at cap (block public registration; surface over-cap warnings for admin/CSV paths as agreed in build)
- Family (camper) registration open date/time
- Worker registration open date/time
- Early / late base registration fees, cutover date/time, 3rd+ child rate
- Discount tiers (JSON or related table)
- Age group definitions (super-admin-managed list per year)

### Admin User

- User ID
- Username
- Password hash
- Role (super_admin / camp_admin)
- Created by (FK)
- Active status

---

## 13. Future / Wish-List Items

These features are **not in scope** for the initial build but are noted for potential future development:

- **Multi-Year Support** - Retain historical data across camp years. Allow admins to view past years' data, carry forward dorm configurations, and compare year-over-year statistics.
- **Parent Portal** - Allow parents to log in, view their registration, update camper information, and see dorm assignments.
- **SMS Notifications** - Text message alerts for check-in confirmation or camp announcements.
- **Volunteer Management** - Extended application, approval, and credentialing workflow beyond self-service worker registration and admin edits.
- **Waitlist** - If camp reaches the configured maximum camper count, allow parents to join a waitlist with automatic notification when spots open.
Camper, worker, and dorm-leader imports may map church and pastor columns. Preview shows the submitted pair and whether commit will reuse an exact canonical identity, silently create a new identity, or retain an incomplete pair as unmapped. Import commit uses the same conservative resolver as public registration and admin entry; it never performs hidden fuzzy mapping.
