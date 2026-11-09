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
