# מדריך הפעלה מהיר ל-Firebase

המערכת החדשה מוסיפה Backend קטן ל"מעבדת פרומפטים" עבור תלמידי כיתות ה-ו.

## מה יש בפנים

- `joinActivity` מחבר תלמיד לפעילות לפי קוד כיתה.
- `validatePromptSteps` בודק שחמשת שלבי הפרומפט מולאו.
- `generateImage` מייצר תמונה רק אם כל השלבים הושלמו.
- מפתח Gemini נשמר רק כ-Secret ב-Firebase Functions.
- כל ההסברים לתלמידים נשארים בעברית פשוטה.

## סכמת Firestore

### collection: `classAccessCodes`

מזהה המסמך הוא קוד הכיתה, למשל `FUNLAB100`.

שדות מומלצים:

- `label`: שם קצר לכיתה, למשל `כיתה ה1`
- `isActive`: ערך `true`
- `activitySlug`: הערך `ai-prompt-lab`
- `allowedGenerationsPerStudent`: למשל `6`
- `teacherName`: למשל `אוהד`
- `expiresAt`: שדה תאריך אופציונלי
- `participantsCount`: מספר אופציונלי, מתעדכן אוטומטית
- `totalSessions`: מספר אופציונלי, מתעדכן אוטומטית
- `totalGenerations`: מספר אופציונלי, מתעדכן אוטומטית

### collection: `studentSessions`

נוצר אוטומטית לכל תלמיד שנכנס לפעילות.

שדות מרכזיים:

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

נוצר אוטומטית לכל יצירת תמונה.

שדות מרכזיים:

- `sessionId`
- `classCode`
- `studentName`
- `finalPromptHebrew`
- `stepSnapshot`
- `generationIndex`
- `model`
- `createdAt`

## צעדים שצריך לעשות ב-Firebase

1. לוודא שהפרויקט `groovetech-9a3fb` קיים ומחובר ל-Billing.
2. לפתוח Firestore במצב Production.
3. ליצור לפחות מסמך אחד ב-`classAccessCodes`.
4. להגדיר Secret בשם `GEMINI_API_KEY`.

## פקודות התקנה מקומית

להריץ מתוך שורש הריפו:

```powershell
npm install --prefix functions
npx firebase-tools login
npx firebase-tools use groovetech-9a3fb
npx firebase-tools functions:secrets:set GEMINI_API_KEY
```

## הרצת אמולטורים

חלון ראשון:

```powershell
npx firebase-tools emulators:start --only functions,firestore
```

חלון שני, כדי להגיש את האתר המקומי:

```powershell
npx serve . -l 8085
```

ואז לפתוח:

- `http://127.0.0.1:8085/courses/prompt-engineering/`
- ממשק האמולטורים: `http://127.0.0.1:4000/`

## פריסה

### פריסת backend ל-Firebase

```powershell
npx firebase-tools deploy --only functions,firestore
```

### פריסת האתר עצמו

האתר נשאר סטטי ב-GitHub Pages, לכן את השינויים בצד האתר מעלים עם `git push`.

## בדיקה ידנית מומלצת

1. לפתוח את עמוד הפעילות.
2. להיכנס עם קוד כיתה קיים.
3. להשאיר שלב אחד ריק וללחוץ על "בדיקת שלבים".
4. לוודא שמתקבלת הודעה בעברית שמסבירה מה חסר.
5. להשלים את כל חמשת השלבים.
6. ללחוץ על "יצירת תמונה".
7. לוודא שמתקבלת תמונה ושנשמר רישום ב-`generationUsage`.

## קודי כיתה מוכנים

נוצרו בפרויקט גם 5 קודים פעילים מוכנים לשימוש:

- `FUNLAB100`
- `FUNLAB200`
- `FUNLAB300`
- `FUNLAB400`
- `FUNLAB500`

לכל אחד מהם:

- `25` מקומות
- `6` יצירות לכל מקום
- `activitySlug = ai-prompt-lab`
