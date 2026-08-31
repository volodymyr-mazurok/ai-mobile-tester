# Authentication

Signing in is, in almost every mobile suite, **the flakiest thing the suite does**.
It is also the thing every authenticated spec depends on. This page is how the
framework contains that.

## Pick a strategy

`config/app.ts` declares one:

| `auth.strategy` | means | what it costs you |
|---|---|---|
| `"none"` | the app opens straight onto usable content | nothing |
| `"in-app"` | credentials go into the app's own views | `setValue` works normally |
| `"webview"` | credentials go through a hosted login page (Entra/B2C, Auth0, Okta, Cognito) | [utils/webViewInput.ts](../../utils/webViewInput.ts), and rule 18 |

⚠️ **On `main` the strategy is `"none"`**, and `app.contract.ts` holds placeholder
resting states - nothing is wired up until you point it at an app. The `demo`
branch's app is `"in-app"` and also browse-first: its catalogue renders whether or
not anyone is signed in, which is why its contract treats several screens as
legitimate resting states.

## Rule 18: a hosted login's fields are PASTED, not typed

⚠️ **Never `setValue` into a hosted login page.** Those screens accept a write and
silently keep nothing.

The mechanism, measured: the provider **re-renders its form asynchronously** - on
blur, on validation, after a checkbox is ticked - and a re-render landing mid-typing
resets the input, so the field keeps only the keystrokes that arrived afterwards.
Recorded results from one campaign: 1 character of 8, 2 of 16, 4 of 17, 5 of 17.

It is not a speed problem in the ordinary sense. Retrying **the same way** produces
**the same truncation**, four attempts running. So the fix is to *verify the write*
and *change strategy on retry*, not to repeat one that has already failed. That is
what `utils/webViewInput.ts` does, and why it pastes via the clipboard rather than
typing.

⚠️ **And you have to read the field back.** An empty iOS field reports its
*placeholder* as its value, so "not empty" proves nothing. A secure field that really
holds text reads back as one bullet per character, so its **length** is checkable
even though its text is not. Android's `EditText` reports its hint rather than its
text, so there is nothing to verify against and one write is all you get.

⚠️ **Do not `clearValue()` a hosted field.** It blurs the field, which fires the
on-blur re-render - the very thing you are trying to avoid.

## The session outlives the app

⚠️ **An in-app logout usually clears the app's token but not the identity
provider's session.** The WebView can then silently re-authenticate and land straight
back inside the app. A reinstall usually fixes it - but *not always*: a freshly
reinstalled app has been observed coming up **already signed in**, which means the
provider's session was not living in the app's sandbox at all.

So `ensureSignedOut()` in [test/support/session.ts](../../test/support/session.ts)
**alternates** the two - logout, check, wipe, logout, check - up to three times.
Whichever clears the session on a given run, it reaches the entry point. It costs
nothing when the app is already signed out.

## Recovery, and why it escalates in that order

`waitForAppReadyOrRecover()` goes **relaunch → reinstall**, because they fix
different things:

- a **relaunch** clears *process* state - a modal, a half-finished flow, a wedged
  render;
- a **reinstall** clears *persisted* state - most importantly a token for an account
  that no longer exists.

That second case is worth knowing about: if your test-data provider deletes the
account it seeded, the next run inherits a session for a user who is gone, and the
app can come up **blank** - no home, no sign-in form - with relaunching no help,
because the poison is persisted. Every spec file in one run failed its `before all`
hook that way. `wdio.conf.ts`'s `onPrepare` clears the install at the start of every
run for exactly this reason.

## Spec order is load-bearing

Suites that share a session must run **authenticated first, pre-auth last**. A
pre-auth suite deliberately signs out; anything authenticated after it pays for a
whole extra sign-in - the flakiest operation in the run.

`config/wdio/specOrder.ts` enforces it by reading the directory, so a newly added
spec cannot be silently left out. Name the ones that sign out in its
`PRE_AUTH_SPECS`.

⚠️ This is also why `specFileRetriesDeferred` is **false**. A deferred retry lands
after the pre-auth specs have signed the app out, and retries into a state it was
never written for.

## Credentials come from `.env`

Never a committed file. See [test-data.md](test-data.md#where-secrets-come-from) for
what that cost the predecessor repo.

The `demo` branch's app is the exception that proves it: its credentials are printed
on its own login screen, so `screens.ts` there uses them inline and says clearly that
this is a property of that build, not a pattern to copy. On `main`,
`signInForExploration()` is an empty no-op waiting for your app.
