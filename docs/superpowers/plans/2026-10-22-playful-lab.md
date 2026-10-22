# Funlab Playful Lab Implementation Plan

> **For agentic workers:** Use executing-plans to implement these tasks in order.

**Goal:** Implement the approved visual with functioning separate lesson routes.
**Architecture:** Static catalog, scoped stylesheet and shared unchanged activity markup. Bind each activity page to its lesson key; isolate draft/session storage by lesson while reading matching legacy data.
**Tech Stack:** HTML, CSS, browser ES modules; Playwright for verification.
**Spec:** docs/superpowers/specs/2026-10-22-playful-lab-design.md

## Global Constraints
- Preserve all existing activity element IDs and backend contracts.
- No push, deployment, backend changes, or edits to untracked user files.
- Use approved illustration atlas; keep text and controls semantic and responsive.

## Review Focus
- Previously saved session must not silently select another lesson.
- Class code for another lesson must not switch the route invisibly.
- Mobile overflow, Hebrew direction and keyboard navigation.
- All existing forms/results/gallery IDs preserved.
- Catalog has no student-network calls; production mutations not tested.

### Task 1: Catalog
- [x] Copy approved atlas and implement scoped catalog CSS and HTML.
- [x] Verify three primary lesson links, Vibe Coding and retained comic entry.

### Task 2: Separate lessons
- [x] Preserve original activity markup on image/free/comic routes with current lesson heading.
- [x] Bind lesson from body data; scope storage with legacy migration; block invisible alternate lesson fallback.
- [x] Verify routes retain form IDs and resolve assets.

### Task 3: Visual and behavior checks
- [x] Render desktop 1435x1096 and mobile 390x844.
- [x] Compare reference to desktop, inspect mobile and correct obvious differences.
- [x] Test all route links, lesson identity, draft isolation, legacy migration and keyboard focus.
- [x] Run JS syntax, existing function tests and design detector. Report remaining differences.