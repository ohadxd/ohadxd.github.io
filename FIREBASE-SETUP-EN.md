# Quick Firebase Setup and Local Testing Guide

This project adds a small Firebase backend for the "Prompt Lab" activity for grades 5-6.

## What is included

- `joinActivity`: lets a student join the activity with a class code
- `validatePromptSteps`: checks that all 5 required prompt steps are filled
- `generateImage`: only creates an image after all required steps are complete
- The Gemini API key stays in Firebase Functions secrets only
- Student-facing explanations stay in simple Hebrew

## Firestore schema

### collection: `classAccessCodes`

Use the class code as the document ID, for example: `FUNLAB100`

Recommended fields:

- `label`: short class label, for example `Grade 5A`
- `isActive`: `true`
- `activitySlug`: `ai-prompt-lab`
- `allowedGenerationsPerStudent`: `3`
- `teacherName`: for example `Ohad`
- `expiresAt`: optional timestamp
- `participantsCount`: optional number, auto-updated
- `totalSessions`: optional number, auto-updated
- `totalGenerations`: optional number, auto-updated

### collection: `studentSessions`

Created automatically when a student joins.

Main fields:

- `classCode`
- `studentName`
- `activitySlug`
- `promptSteps`
- `missingStepKeys`
- `isPromptComplete`
- `generationsCount`
- `generationLimit`
- `status`
- `createdAt`
- `updatedAt`

### collection: `generationUsage`

Created automatically for each generated image.

Main fields:

- `sessionId`
- `classCode`
- `studentName`
- `finalPromptEnglish`
- `stepSnapshot`
- `generationIndex`
- `model`
- `createdAt`

## Firebase tasks you need to do

1. Make sure the Firebase project `groovetech-9a3fb` exists and has billing enabled.
2. Enable Firestore in Production mode.
3. Create at least one document in `classAccessCodes`.
4. Set a Firebase Functions secret named `GEMINI_API_KEY`.

## Local install commands

Run from the repo root:

```powershell
cd c:\Users\מנהל\Documents\repos\funlab.co.il\ohadxd.github.io
cd functions
npm install
cd ..
npx firebase-tools login
npx firebase-tools use groovetech-9a3fb
npx firebase-tools functions:secrets:set GEMINI_API_KEY
```

## Local emulator commands

First terminal:

```powershell
cd c:\Users\מנהל\Documents\repos\funlab.co.il\ohadxd.github.io
npx firebase-tools emulators:start --only functions,firestore
```

Second terminal:

```powershell
cd c:\Users\מנהל\Documents\repos\funlab.co.il\ohadxd.github.io
npx serve . -l 8085
```

Then open:

- Activity page: `http://127.0.0.1:8085/courses/prompt-engineering/`
- Emulator UI: `http://127.0.0.1:4000/`

## Manual local test flow

1. In Firestore, create `classAccessCodes/FUNLAB100`.
2. Add these fields:
   - `label`: `Grade 5A`
   - `isActive`: `true`
   - `activitySlug`: `ai-prompt-lab`
   - `allowedGenerationsPerStudent`: `3`
3. Open the activity page locally.
4. Enter class code `FUNLAB100`.
5. Enter a student name.
6. Leave one required step empty and click `בדיקת שלבים`.
7. Confirm the system returns a short Hebrew educational message that explains what is missing.
8. Fill all 5 required steps:
   - main character / subject
   - place / environment
   - action
   - visual style
   - special detail
9. Click `יצירת תמונה`.
10. Confirm that:
   - an image is returned
   - the final English prompt is shown
   - a usage record is created in `generationUsage`
   - the remaining generation count goes down

## Deploy commands

Deploy backend:

```powershell
cd c:\Users\מנהל\Documents\repos\funlab.co.il\ohadxd.github.io
npx firebase-tools deploy --only functions,firestore
```

Deploy frontend:

The frontend is still a static GitHub Pages site, so frontend changes are published with `git push`.
