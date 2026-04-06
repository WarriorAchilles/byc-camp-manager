# BYC Camp Manager - Master Specification

**Believer's Youth Camp** - A summer church camp where youth from churches across the country come together to attend. This software manages camper registration and on-site camp operations.

Node.js + React Web Application | PostgreSQL Database | AWS Deployment

---

> ## Outstanding Items & TBD Questions
>
> The following items still need to be decided before development of the relevant features. Camp admins and stakeholders - please review and provide input.
>
> 1. **Age Groups** - What age groups should be used for dorm assignments? (e.g., 7-9, 10-12, 13-15). These will be configurable by super admins, but we need sensible defaults.
> 2. **Camp Capacity** - Is there a maximum number of campers? Should registration automatically close when capacity is reached?
> 3. **Camper Information Fields** - The registration form currently collects standard camp info (see [Camper Data Model](#camper-data-model)). Are there additional fields needed?
> 4. **Report Requirements** - What specific summary reports do camp admins need beyond dorm rosters? See the [Reports](#reports) section for proposed examples.
> 5. **Dorm Inventory** - How many dorms are there? What are their names, capacities, and gender designations? (These are configurable in the system, but knowing the starting set helps.)
> 6. **Merchandise Pricing** - What merch items will be available for pre-order (t-shirts, hats, etc.)? What are the prices and available sizes/options? Merch pricing can be configured in the admin interface and may also be adjustable through Stripe.
> 7. **Check-in Confirmation Email** - What information should be included in the email sent to parents after check-in? (e.g., dorm assignment, dorm leader name, emergency contact info?)

---

## Table of Contents

- [1. Overview](#1-overview)
- [2. Technical Architecture](#2-technical-architecture)
- [3. User Roles & Authentication](#3-user-roles--authentication)
- [4. Registration System](#4-registration-system)
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

1. **Public Registration** - A family registration form that opens at a scheduled date/time, allowing parents or campers to register one or more children, sign medical release forms, and pay via Stripe or elect to pay cash at camp.
2. **Admin Management** - A protected admin interface for managing camper records, dorm assignments, check-in (including QR code scanning), payment tracking, and generating printable reports.

The registration system may not be used in the first year of operation. The admin/management side must be fully functional independently, supporting bulk CSV import of camper data so that camp operations can proceed even if registration was handled externally.

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
| QR Codes | Generated server-side, sent via email                 |
| Email    | Transactional email service (e.g., AWS SES, SendGrid) |

### Key Technical Considerations

- The admin interface must be **mobile-friendly / responsive** so that camp staff can perform check-in from their phones using the device camera for QR scanning, or from a laptop with a webcam.
- The public registration form should be a clean, accessible, multi-step form optimized for both mobile and desktop.
- The API should be RESTful with proper authentication middleware protecting admin routes.
- The registration form route is publicly accessible but gated by a configurable open date/time - the form is not available before the scheduled opening.

---

## 3. User Roles & Authentication

### Roles

| Role            | Description                                                                                     |
| --------------- | ----------------------------------------------------------------------------------------------- |
| **Super Admin** | Full system access. Can manage all settings, users, camp configuration, dorms, and camper data. |
| **Camp Admin**  | Operational access. Can perform check-in, view/manage camper data, manage dorms, run reports.   |

There are no login-based roles for parents, campers, dorm leaders, or workers. Parents interact with the system solely through the public registration form. Dorm leaders receive printed reports from camp admins.

### Authentication

- Email/password authentication for admin users.
- Super admins can create, deactivate, and reset passwords for any admin user.
- Session or token-based auth (JWT) for API access.
- No self-service registration for admin accounts - they must be created by a super admin.
- No public-facing "forgot password" flow - super admins handle password resets.

---

## 4. Registration System

### Registration Form Availability

- Super admins can configure a **registration open date and time** through the admin interface.
- Before the open date, the public registration page displays a **countdown timer** showing the time remaining until registration opens. The registration form itself is not accessible until the countdown reaches zero.
- Once the countdown reaches zero, the page automatically transitions to the live registration form - no page refresh required.
- After the open date, the form is publicly accessible - no login or account required.

### Family Registration Flow

Registration is structured as a **single family registration**, where a parent/guardian fills out one form for their entire family.

#### Step 1 - Parent / Guardian Information

- Parent/guardian full name
- Email address
- Phone number
- Mailing address
- Relationship to camper(s)

#### Step 2 - Camper Information (repeatable for each child)

The parent adds one or more campers. For each camper, the following information is collected:

- Full name (first and last)
- Date of birth
- Gender
- Allergies / medical conditions
- Current medications
- Dietary restrictions
- T-shirt size
- Emergency contact name and phone (may default to parent info)
- Church / organization affiliation
- Any special needs or accommodations
- **TBD: Additional fields as determined by camp admins**

#### Step 3 - Medical Release & Legal Agreement

- Display the medical release / liability waiver text.
- Parent/guardian provides a **digital legal signature** (typed full name + checkbox acknowledgment, or drawn signature via signature pad).
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
- After successful submission, a confirmation page is displayed that repeats the full pricing breakdown and payment status.

#### Post-Registration

- Each registered camper receives a **unique QR code**.
- A confirmation email is sent to the parent/guardian email address containing:
  - Registration confirmation details
  - One QR code per registered camper (for use at check-in)
  - Merchandise pre-order summary (if any items were ordered)
  - Any relevant camp information (dates, what to bring, etc.)

---

## 5. Payment

### Stripe Integration

- Stripe is used for online credit/debit card payments during registration.
- The system creates a single Stripe charge per family registration (total of all camper fees minus discounts, plus any merchandise pre-orders).
- Payment status is tracked per family registration: **Paid (Stripe)**, **Paid (Cash)**, or **Unpaid**.

### Cash Payments

- If a family elects to pay at camp, their registration is recorded with a status of **Unpaid**.
- During check-in, camp admins can mark the family registration as **Paid (Cash)**.
- The system should display unpaid registrations prominently so admins can collect payment.

### Multi-Child Discounts

- The base registration fee is **$165 per camper** for the first two children in a family.
- Starting with the **3rd child**, the fee drops to **$90 per child**.
- Examples:
  - 1 camper: $165
  - 2 campers: $330 ($165 + $165)
  - 3 campers: $420 ($165 + $165 + $90)
  - 4 campers: $510 ($165 + $165 + $90 + $90)
  - 5 campers: $600 ($165 + $165 + $90 + $90 + $90)
- Super admins can adjust the base fee and discount tier amounts through the admin interface if pricing changes in future years.

---

## 6. Camp Management

### Camp Configuration (Super Admin)

Super admins can configure the following camp-wide settings:

- **Camp name and year**
- **Camp dates** (start and end date)
- **Registration open date/time** - controls when the public form becomes accessible
- **Base registration fee**
- **Discount tiers** - configurable multi-child discount amounts
- **Merchandise catalog** - items available for pre-order, with names, prices, and options (sizes, colors, etc.). **TBD: Specific items and pricing.**
- **Age group definitions** - named age brackets used for dorm assignment (e.g., "Juniors: 7-9", "Teens: 13-15"). **TBD: Specific age groups.**

### People in the System

The system tracks three categories of people:

| Category         | Description                                                                 |
| ---------------- | --------------------------------------------------------------------------- |
| **Campers**      | Children attending camp. Registered via form or CSV import.                 |
| **Workers**      | Adult volunteers/staff helping at camp. Entered via admin interface or CSV. |
| **Dorm Leaders** | Adults assigned to lead specific dorms. Entered via admin interface or CSV. |

Workers and dorm leaders share a similar data profile (name, gender, contact info) but are distinguished by their role. Workers have their own separate dorms. Dorm leaders are assigned to camper dorms. Workers and dorm leaders do not pay a registration fee - they are entered into the system by camp admins and are not part of the payment workflow.

---

## 7. Check-In

Check-in is performed by camp admins on the day(s) campers arrive.

### QR Code Check-In

1. Camp admin opens the check-in screen on their phone or laptop.
2. Admin activates the device camera (phone camera or laptop webcam).
3. Admin scans the camper's QR code.
4. The system looks up the camper and displays:
   - Camper name and photo (if available)
   - Dorm assignment (building/room name)
   - Payment status (paid or unpaid - if unpaid, prompt admin to collect cash and mark as paid)
   - Any medical notes or special needs flagged for attention
5. Admin confirms check-in. The camper is marked as **Checked In**.
6. Admin verbally directs the camper to their assigned dorm.

### Manual Check-In (No QR Code)

- If a camper does not have their QR code, the admin can search by **camper name**.
- Search results display matching campers. Admin selects the correct camper and proceeds with the same check-in flow as above.

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

Super admins can create and configure dorms with the following properties:

- **Dorm name** (e.g., "Cabin A", "Building 3 Room 201")
- **Gender** - Boys, Girls, or Co-ed (Workers). Worker dorms are co-ed to accommodate married couples and families with young children.
- **Age group** - One of the configured age group brackets (for camper dorms)
- **Bed count / capacity**
- **Assigned dorm leader(s)**

### Auto-Assignment

- When camper data is available (via registration or CSV import), the system can **auto-assign campers to dorms** based on:
  - Gender
  - Age group (calculated from date of birth)
- Auto-assignment fills dorms up to their bed capacity.
- Workers are auto-assigned to worker-designated dorms.

### Manual Assignment (Drag and Drop)

- After auto-assignment (or at any time), camp admins can **manually reassign** people between dorms using a **drag-and-drop interface**.
- The interface should display:
  - All dorms grouped by gender / type
  - Each dorm showing its current occupants and remaining capacity
  - An "unassigned" area for people not yet assigned to a dorm
- Drag a camper/worker/dorm leader from one dorm to another, or from unassigned to a dorm.
- The system should warn (but not prevent) if an assignment violates gender or age group rules for camper dorms, in case an admin needs to make an exception. Gender warnings do not apply to co-ed worker dorms.

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

- **Registration Summary** - Total registrations, breakdown by age group, gender, payment status.
- **Financial Summary** - Total revenue collected (Stripe vs. cash), outstanding unpaid registrations, discount amounts applied.
- **Medical Summary** - All campers with allergies, medications, or special medical needs, grouped by dorm. Useful for camp nurse / medical staff.
- **Dietary Needs Report** - All campers with dietary restrictions, for kitchen staff.
- **Check-In Status Report** - Real-time list of who has and hasn't checked in, filterable by dorm.
- **Emergency Contact List** - All campers with their emergency contact info, organized by dorm.
- **Head Count Summary** - Total campers, workers, and dorm leaders on site (checked in) vs. expected.
- **Merchandise Order Summary** - Total quantities per merch item and option (e.g., 45 Medium t-shirts, 30 Large t-shirts, 12 hats). Used for placing bulk orders with suppliers so only the exact needed quantities are purchased.

---

## 10. Email Notifications

The system sends emails at two points:

### 1. Registration Confirmation Email

Sent immediately after a family completes registration. Contains:

- Confirmation that registration was received
- List of registered campers
- **Full itemized pricing breakdown** (same receipt-style format shown during registration)
- **One QR code per camper** (embedded image or attached)
- Merchandise pre-order summary (if any items were ordered)
- Payment status: if paid via Stripe, a confirmation of payment received; if paying cash, a **prominent reminder of the exact total amount due at check-in**
- Camp dates and relevant information

### 2. Check-In Confirmation Email

Sent to the parent/guardian email after a camper is checked in at camp. Contains:

- Confirmation that the camper has been checked in
- Dorm assignment
- **TBD: Additional info to include (dorm leader name, emergency contact info, etc.)**

No other automated emails are sent. If parents need to update information, they contact the camp directly.

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

---

## 12. Data Model Overview

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
- First name, last name
- Date of birth
- Gender
- Allergies / medical conditions
- Medications
- Dietary restrictions
- T-shirt size
- Emergency contact name and phone
- Church / organization
- Special needs / accommodations
- QR code token (unique identifier encoded in QR)
- Dorm assignment (FK)
- Check-in status (not checked in / checked in)
- Check-in timestamp
- Medical release signed (boolean)
- Import source (online registration / CSV import)

### Worker / Dorm Leader

- Person ID
- First name, last name
- Gender
- Contact info (phone, email)
- Role (worker / dorm leader)
- Dorm assignment (FK)
- Check-in status
- Check-in timestamp

### Dorm

- Dorm ID
- Name
- Gender designation (boys / girls / co-ed workers)
- Age group (FK or label)
- Bed count / capacity
- Assigned dorm leader(s)

### Camp Configuration

- Camp year / name
- Camp start and end dates
- Registration open date/time
- Base registration fee
- Discount tiers (JSON or related table)
- Age group definitions

### Admin User

- User ID
- Email
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
- **Volunteer Management** - Application and approval workflow for workers and dorm leaders.
- **Waitlist** - If camp reaches capacity, allow parents to join a waitlist with automatic notification when spots open.
