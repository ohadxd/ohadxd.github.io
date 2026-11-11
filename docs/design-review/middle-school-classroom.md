# Middle-school classroom card — 2026-11-11

Added `מחשבים חט״ב` as the first card on the homepage and course directory.
It links directly, in the same tab, to `https://idan-python.duckdns.org/`.
The destination returns HTTP 200 and presents the classroom portal login.
All four existing course cards and their destinations are preserved.

Reuses the existing card, typography, palette, and responsive four/two/one-column
grid. A standalone cover rule shows the complete new 3:2 illustration instead
of cropping it as an artwork atlas. The two changed pages request a new CSS
version to avoid reusing an older browser-cached stylesheet.

Verified both pages' five card links, local artwork paths, the stylesheet
version, and the six existing lesson-routing tests. No local server or
listening port was opened for this change. Browser layout was not inspected.

## Artwork

Workspace asset: `assets/prompt-lab/middle-school-computers.png`.
Generated using the built-in image generation tool with the existing
`assets/prompt-lab/course-art.png` as its visual reference. The original
generated file is preserved in the Codex generated-images directory.

Final prompt:

> Create one landscape 3:2 illustration for a new middle-school computer science class card on Funlab, matching the attached course-art reference sheet exactly in visual family. Output ONE scene, not a grid. Soft polished 3D clay/toy materials, rounded shapes, rich cobalt blue, mint, coral and warm yellow accents, soft clouds and plants, joyful professional finish. Main subject: an open laptop showing colorful abstract visual code blocks, with a friendly small blue-and-yellow snake curled beside it to suggest Python programming, a mouse, a notebook and pencil, a few floating geometric code blocks. A compact imaginative learning world on a rounded grassy platform. Suitable for students aged 12–15: smart, inviting and playful. Background bright mint/turquoise, clearly distinct from the existing blue AI and yellow Roblox illustrations. Strong clean composition readable as a small course card. No text, no letters, no numbers, no Hebrew or English, no logos, no watermarks, no browser mockup, no border. Match the existing reference lighting, tactile material and detail level; make a new computer-science scene.
