---
version: alpha
name: PractiScale Assistant
description: A focused conversational workspace with PractiScale green accents and quiet reading surfaces.
colors:
  primary: "#10A388"
  background: "#FFFFFF"
  dark-background: "#1A1A19"
  danger: "#DC2626"
typography:
  sans:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
  serif:
    fontFamily: "Source Serif 4, Georgia, serif"
rounded:
  control: "0.75rem"
  panel: "1rem"
omitted:
  - section: spacing
    reason: Existing component utilities own spacing; this authentication change introduces no new spacing system.
---

# PractiScale Assistant design context

## Overview

Product register for the existing English conversational assistant. Preserve
the focused chat workspace and its BrainOrb signature; authentication must
remain familiar rather than introducing a separate brand treatment.

## Colors

Runtime tokens in `src/app/globals.css` are canonical; `tailwind.config.ts`
maps them to semantic utilities. This file records representative light-theme
values and does not generate tokens. The existing `.dark` theme supplies its
own contrast-adjusted values. Authentication errors use the existing danger
callout, with text and `role="alert"` rather than color alone.

## Typography

Use the existing next/font Inter interface and Source Serif 4 answer typography.
Authentication uses the existing interface scale and sentence-case copy.

## Layout

Reuse the centered sign-in card, existing responsive widths and labeled fields.
Connection failures occupy the same inline error slot as password failures.

## Elevation & Depth

Reuse the existing `shadow-float` card and semantic surface tokens. No new
glass, glow, gradient or elevation treatment is introduced by direct sign-in.

## Shapes

Keep the existing rounded-xl fields and rounded-2xl card.

## Components

`src/components/Button.tsx` owns buttons; `src/app/login/page.tsx` owns the
sign-in form, pending spinner, error callout and authenticator step. Preserve
keyboard input, password-manager support, native labels and noValidate forms.
Two-step verification and account conflicts are authentication decisions, never
decorative states. The server contract is in `docs/CEO-PORTAL-LOGIN.md`.

## Do's and Don'ts

- Reuse the existing recovery message and sign-in flow.
- Keep secrets and internal diagnostics out of user-facing errors.
- Preserve enrolled MFA and other users' sessions.
- Do not redesign unrelated chat or administrative screens for this integration.

Report waiting states use AnswerProgress with actual source stages and elapsed time, never estimated percentages. Source report failures retain the question and offer an explicit Retry report action; they do not automatically retry or change models.

Hourly appointment reports show snapshot verification time and delayed-sync warnings. Refresh from GHL is an explicit full-scan action, does not change CRM records, and replaces the last answer only when complete.

Weekly Sales Review lives in the authenticated workspace. Use the native week-start date field, existing buttons and report progress component. Keep Payroll outcomes, CRM statuses, and transcript evidence in separate source sections. Partial failure preserves the other sections, and a failed GHL refresh can display the last verified snapshot for the same week.

New chats and follow-ups use the same composer controls. Attachments, source selection, and send stay visible. More options holds the advanced settings and, in a conversation, context and export controls.

Answers use a single reading column, with citations alongside the claims and source previews below the answer. Open live citations in the source preview. Resolve saved citations when clicked and check current source access before showing the excerpt. Show source dates when provided.

For scoped reports, show the team or audience, dates, and data source together above the answer. Follow-up shortcuts draft an editable message. Show both periods for a comparison and keep the report’s original date range visible.

During a reply, Stop & edit puts the active prompt in the composer. Focus moves to the text. Resend replaces the interrupted turn and reuses its attachments. Cancel restores the draft that was in the composer, and queued turns stay paused after stopping.

Learning suggestions may appear under the answer that prompted them while another turn is in progress. A completed answer releases the composer even when the suggestion is pending. Saving a suggestion still requires confirmation.
