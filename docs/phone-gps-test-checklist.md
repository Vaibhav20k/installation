# Phone GPS test checklist

Purpose: confirm that site punches record a usable location on real phones. This cannot be tested on a laptop. Use a throwaway test: the live demo data is fictional and resets.

## Before you start

The revised process must be published, because location is only recorded on Site Plan punches.

1. Open https://installation-beryl.vercel.app on a laptop and sign in as **Anil P. (EMP-004)**.
2. Go to **Setup → Operations policy**, enter test limits and publish the revised workflows.
3. Sign in as **Vikas S. (EMP-001)**, create a Site Plan with today's date and one crew member, then get it approved.

**The demo data can reset whenever Vercel restarts.** If the plan disappears mid-test, repeat these steps. The Postgres work removes this problem.

## Phones

Test at least one Android phone and one iPhone. Include an older phone if your crew uses them. Use the normal browser (Chrome on Android, Safari on iPhone).

## Tests

Sign in on the phone as the assigned crew member, then record the result of each test.

| # | Do this | Expected | Result (phone, pass/fail, note) |
|---|---|---|---|
| 1 | Punch in outdoors, and tap **Allow** on the location prompt | The punch saves | |
| 2 | On a laptop, open **Reports → Punch locations** and tap **Open map** on that punch | The map point is where you stood, and the row shows distance from site and accuracy | |
| 3 | Punch out from the same place, then refresh the report | The row shows a clock-out time and map link | |
| 4 | Clear the site's location permission, punch in, and tap **Block** | The punch is refused with a clear message saying to allow location or ask the supervisor | |
| 5 | Allow location in the phone's settings and try again | The punch now works | |
| 6 | Turn the phone's GPS off completely and punch | A clear message appears within about 15 seconds; the app does not freeze | |
| 7 | Punch inside a building or basement | The punch saves or gives a clear message; note the accuracy shown and how far off the point is | |
| 8 | Punch with weak mobile data | Note the time taken and any error | |
| 9 | As a supervisor, record a correction for a person who could not punch | It saves only with a reason | |

## What to send back

- Pass or fail for each test, with the phone model.
- Screenshots of any failure.
- Tests 2 and 7: how many metres off the point was, by your own estimate on the map.

Decide from the results: is the location accurate enough for your report? If indoor points are often far off, the punch may need to show its accuracy to the manager.
