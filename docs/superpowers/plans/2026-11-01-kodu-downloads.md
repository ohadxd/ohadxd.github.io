# Kodu downloads page implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task by task. Track progress with the checkboxes below.

**Goal:** Add a Hebrew downloads page with a matching Kodu illustration and the exact installer URL supplied by the user.

**Architecture:** Reuse the static site's existing header, robot hero, course cards, typography, colors, and download button styling. Add scoped download styles and a small shared mobile-navigation adjustment to accommodate the new link.

**Tech stack:** Static HTML, shared CSS, built-in image generation, GitHub Pages.

**Spec:** Design approved in chat: the same illustrated course UI, a custom soft 3D Kodu game-world illustration, Windows/version information, and a direct download button. User explicitly requested implementation on 2026-11-01.

## Constraints

- Reuse `lab-header`, `lab-hero`, `lesson-tile`, `lesson-copy`, and `lesson-cta`.
- Preserve Hebrew RTL, existing content, classroom behavior, and local `AGENTS.md`.
- Use exactly `https://kodugamelab.blob.core.windows.net/blob/Builds/KoduSetup_1.6.18.0.exe`.
- Keep the current GitHub Pages architecture. No Firebase changes. After local
  verification, the user explicitly authorized pushing the completed work.
- Work on `codex/downloads-kodu` in the current checkout.

## Review focus

- Added navigation must fit at 320px, 390px, and desktop widths.
- Downloading must use the supplied external URL, without executing the installer during verification.
- The new art must match the existing course-art style and remain readable when cropped.
- Existing course navigation and local download assets must remain accessible.
- Direct loading of `/downloads/` must render with working local images, CSS, and canonical metadata.

## Tasks

- [x] Generate Kodu art using `assets/prompt-lab/course-art.png` as a visual reference, inspect it, and save the selected asset under `assets/downloads/`.
- [x] Create `downloads/index.html` using the approved existing UI and exact installer link; add scoped CSS in `css/prompt-lab-design.css`.
- [x] Add the downloads link to student-facing navigation and the new route to `sitemap.xml`; preserve each page's existing links and active states.
- [x] Verify markup, local asset paths, installer headers, existing routing tests, desktop/mobile rendering, and navigation. Record results and leave changes ready for review.

## Execution notes

- This is a reversible static-content change. Verify it with browser inspection, route/asset checks, and existing tests; do not add tests that simply mirror the new markup.
- The design is approved and implementation is explicitly authorized. Proceed without another approval round.
- No worktree is needed for this bounded change; use a feature branch in the user's current checkout.
- Verification results and the final image generation prompt: `docs/design-review/downloads-verification.md`.
- After verification, commit the scoped changes, fast-forward `main`, push to
  `origin/main`, and check the published downloads route and homepage navigation.
