# Oracles - how you know something is wrong without a spec to compare against

An **oracle** is whatever lets you call a behaviour wrong. A regression suite has
the easiest one there is: it seeded the data, so it knows the answer. Exploration
has no seeded answer, so it borrows other people's - and every heuristic below is
one of those, plus the class of bug it catches.

Half of these are automated in `smells()` (`test/support/explore.ts`) because the
tree alone can answer them. The rest need a person or a model looking, and they
are the ones that find the interesting things.

---

## Automated - `smells()` runs these over every snapshot

| oracle | catches | known false positives here |
|---|---|---|
| `placeholder-text` | `undefined`, `NaN`, `null`, `[object Object]`, `{{`, `%s` reaching the screen | none. This is never intentional |
| `repeated-phrase` | a word or phrase repeated back-to-back in user-facing copy ("Are you sure you sure you want to logout?") | rare, and almost always real. Checks PHRASES, not adjacent identical words - see `utils/copy.ts` |
| `duplicate-id` | one testID matching two elements - the second is unaddressable and the first's assertions are ambiguous | list rows are keyed by runtime id, so genuine duplicates are rare and worth reading |
| `untagged-text` | visible text with no id-bearing ancestor - rendered, and permanently uncheckable | plenty. Most apps have real untagged text; it belongs in `TESTID_IMPROVEMENTS.md`, not `APP_ISSUES.md` |
| `unlabelled-control` | an interactive element with neither testID nor accessible label - fails a screen reader too | iOS wraps controls in `Other` nodes; read the screenshot |
| `currency-format` | whitespace between the symbol and the figure; the same screen mixing minor units and none | a real class - one app used an EN space in exactly one place. Check the whole screen before filing |
| `inconsistent-placeholder` | two different dash characters meaning "no value" on one screen | real, and cosmetic-looking until you try to assert on either |
| `truncated-text` | text elided with `…` | only a bug when the elided thing is the only copy of the information |
| `zero-size-content` | an element carrying text at 0 width or height | `*.screen` wrappers are legitimately zero-size **and carry no text**, so they do not fire |
| `clipped-horizontally` | laid out past the window edge | iOS keeps off-screen scroll content in the tree; vertical is expected, horizontal is not |
| `dead-control` (`probe`) | tapped it, the tree is byte-identical | the highest-value shape here. Always worth a manual repro |
| `step-failed` | the charter could not drive this at all | frequently the finding itself |

---

## Manual - what a model or a person has to look for

### Consistency oracles

The app disagreeing with itself is the cheapest real finding there is, and no
regression suite can see it because each assertion is written against one screen.

- **The same figure in two places.** A card's total against its detail sheet's
  summary; a folder tile's count against the folder's own listing; the bell badge
  against the number of unread rows.
- **The same concept, two formats.** Dates (`22 Aug 2026` vs `22/08/2026`),
  currency, capitalisation of titles, how "empty" is spelled.
- **The same control, two behaviours.** Every modal's close button; whether an
  overlay tap dismisses; whether Back works.
- **Platform disagreement.** iOS and Android showing different text, different
  ordering, or a control one has and the other does not. ⚠️ Confirm it is not the
  page-source difference first - see the skill's Step 5.

### Claim oracles

The app makes claims. Check them.

- **Its own copy.** A search placeholder that says it searches documents; a
  "Preview isn't available - download it to open it" card whose Download does
  nothing; a "Relocate and Delete" that appears for an empty folder.
- **Counts and labels.** "Show All (98)" against 98 tiles; "2/10 members"; a
  badge that says 3 against 4 rows.
- **The product spec and Figma**, where they exist. ⚠️ Divergence is **documented,
  not asserted** in this framework - hosted third-party pages in particular tend to
  differ from a spec in a dozen ways that everyone has accepted as shipped. A gap
  only becomes a finding when it is FUNCTIONAL.

### State and lifecycle oracles

Where a smoke suite never goes, because it always starts clean and goes forwards.

- **Idempotence.** Do the same thing twice. Double-tap submit. Send the same
  message twice. Create a folder with a name that already exists.
- **Interruption.** Background the app mid-flow and return. Rotate. Let the screen
  lock. Kill and relaunch with a modal open.
- **Order.** Do the steps out of order. Go Back from somewhere nothing goes Back
  from - a productive charter in its own right.
- **Persistence.** Does what you just changed survive a relaunch? A tab change? A
  sign-out? The suite asserts the write and almost never the read-back.
- **Concurrency.** Change the data underneath the app (`seed-test-data`) and see
  what the open screen does.

### Input oracles

Nothing in the suite types anything hostile. Every field is unexplored.

Leading/trailing whitespace · whitespace only · empty · one character · exactly
the limit · one over the limit · far over (a 5,000-character paste) · emoji ·
RTL and combining characters · `<script>` and `'; --` (looking for a rendering or
parsing failure, not for an exploit) · newlines in a single-line field · a name
that collides with an existing one.

For each: **is the limit enforced, is the error shown, is the error accessible,
and is what got saved what you typed?**

### Boundary and volume oracles

- Zero rows, one row, the maximum the UI paginates at.
- A very long name in a fixed-width row.
- £0, a negative total, a very large number's grouping.
- An account with no data at all - the empty-state ids a seeded fixture can never
  reach by construction. See docs/testing/suites.md.

### Accessibility oracles

These are real findings in their own right, not test-tooling complaints. A form's
inline validation errors being absent from Android's accessibility tree is exactly
this: an error a screen reader cannot announce.

- Does every control have a name?
- Is an error message in the accessibility tree, not just on screen?
- Does the OS's largest text size break the layout?
- Is state (selected, checked, expanded) exposed at all? ⚠️ In React Native this
  is very often **style-only**, exposed nowhere - which makes `isSelected()` useless
  and is a common root cause of coverage gaps. Raise it once, in
  `TESTID_IMPROVEMENTS.md`, rather than per screen.

---

## Rules of engagement

- **Assume the environment is SHARED** unless you know otherwise. A session may
  create data through the app; it must not delete anyone else's. Rule 17 - cleanup
  is guarded by what a suite MARKS carrying the run's suffix, not by the cleanup
  being clever. Do not route around that.
- **Do not change a credential the fixture carries** for the rest of the run. If a
  charter has to, it has to write the new one back, exactly as a pre-auth spec would.
- **Never explore as a privileged or shared account.** Use a throwaway one, or the
  app's own demo credentials.
- **One device, one session.** A charter run and a suite run cannot share a
  Simulator - `maxInstances: 1` is a device fact, not a config preference.
