# Classroom and admin prompt monitor — 2026-10-22

Scope: refinements to three student classroom screens and the admin workspace. Existing form IDs, schedule controls, class management, provider settings and billing remain.

Student pages: illustrated lesson header, clear forms and controls, collapsible instructions, responsive classroom styles.

Admin: select a class or click its prompt button; show up to the 100 most recently active student sessions, submitted/saved prompt steps, latest generated prompt, latest API error with its timestamp and failed prompt. Error detail includes provider/stage/model, status/code, request ID and original response when supplied.

Data implementation:
- adminGetClassActivity checks existing admin session before a class-scoped bounded Firestore query.
- Explicit allowlist excludes student session IDs and session credentials.
- API failures in assessment, preparation/generation and storage are persisted to the student session.
- Explicit mergeFields replace the whole last-error map so older error fields do not survive a newer error.
- Firestore composite index: studentSessions classCode ascending, lastSeenAt descending.
- Failures before deployment cannot be reconstructed by this feature. Provider fields appear only when the provider supplied them.
- This is the latest error per student session, not a full event history. Data updates on refresh, not live keystroke monitoring.

Validation:
- Functions suite 46/46 pass (including unauthenticated rejection, class scoping, diagnostics, legacy sessions and selector update).
- Six existing lesson-route regression tests pass.
- Browser mocks: admin login, correct authenticated class request, rendered exact diagnostics, prompt HTML treated as text, logout clears data, four widths without overflow.
- Student mocked join flows continue to pass.
- Visual desktop/mobile screenshots reviewed.
- Independent review found newly created class missing from selector; fixed and regression verified RED then GREEN.
- Backend syntax, browser script syntax and diff whitespace checked.
- No deployment or production mutations performed.

Deployment required: Functions (new adminGetClassActivity and modified evaluateFreePrompt/generateImage), Firestore index, and static frontend. Existing Firestore rules deny direct reads of private sessions.