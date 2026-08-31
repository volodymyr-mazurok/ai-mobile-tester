# REQ-001: Login

## Context

The store lets anyone browse, but a purchase needs an identified customer. Login is
reached from the navigation drawer and from checkout. Two accounts exist for testing:
a normal customer and one that has been locked by fraud rules.

Credentials for the demo build are published on the login screen itself.

| account | password | state |
|---|---|---|
| `bob@example.com` | `10203040` | normal |
| `alice@example.com` | `10203040` | locked out |

## Requirements

**R1.1 — Reaching the screen.**
Selecting *Log In* from the navigation drawer opens the login screen, showing a
username field, a password field and a *Login* button.

**R1.2 — Successful login.**
Submitting valid credentials for a normal account signs the customer in and returns
them to the product catalogue.

**R1.3 — Empty username.**
Submitting with the username blank shows *Username is required* against the username
field, and does not sign in.

**R1.4 — Empty password.**
Submitting with the password blank shows *Password is required* against the password
field, and does not sign in.

**R1.5 — Wrong password.**
Submitting a known username with an incorrect password shows an error explaining that
the credentials do not match, and does not sign in.

**R1.6 — Locked-out account.**
Submitting valid credentials for a locked account does **not** sign in, and shows an
error that says the account is locked. It must be distinguishable from R1.5 — a
customer who has been locked needs to know to contact support rather than retry.

**R1.7 — Signing out.**
A signed-in customer can sign out from the navigation drawer. Signing out asks for
confirmation before it takes effect, and the confirmation text is grammatical.

**R1.8 — Cancelling a sign-out.**
Declining the sign-out confirmation leaves the customer signed in.

## Out of scope

- Registration, password reset, social sign-in — none exist in this build.
- Biometric unlock (a separate drawer feature, REQ-TBD).
- Session lifetime and token refresh.

## Notes

- The drawer shows both *Log In* and *Log Out* regardless of state, so neither is a
  reliable indicator of whether anyone is signed in.
- The app browses fine without authentication; do not assume the catalogue implies a
  session.
