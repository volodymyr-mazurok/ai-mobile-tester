# XPath on iOS and Android

Reference for hand-written XPath: how the two platforms differ, what breaks a chain,
and how to iterate on an expression without paying a round trip per attempt. Every
count below was measured live against a real React Native app on both a Simulator and
an emulator.

---

## Rule zero: in THIS framework you do not get the choice

**`Component` addresses everything by XPath, on both platforms, always** - see
[../architecture/page-objects.md](../architecture/page-objects.md). `~id` and
`-ios predicate string:` are gone, deliberately: one strategy means selectors nest
identically everywhere and there is no per-strategy scoping rule to remember. The
measured cost of that is ~13% over iOS's native accessibility-id query, paid on
purpose.

So this page is for the cases the four builders cannot express - a *relationship*
(ancestor, sibling, nth match), an attribute like "is a password field", or a screen
whose markup is not the app's to tag. **It is not permission to hand-write a selector
where a testID would do**; go through `byTestId` and friends first.

Why the alternatives were not kept, since it is a fair question. Measured on one
tagged root:

| Strategy | Android | iOS |
| --- | --- | --- |
| `~id` (`accessibility id`) | **0 — does not work** | **1 ✓** |
| `id` | **0 — does not work** | – |
| `-android uiautomator` `resourceId("…")` | **1 ✓** | – |
| xpath on the id attribute | **1 ✓** | **1 ✓** |

On Android a `testID` becomes a `resource-id`, and Appium's plain `id` strategy
expects a real Android resource name - a dotted testID is not one, so `id` finds
nothing even fully qualified as `com.example.app:id/…`. `~id` fails there too,
because on Android it matches `content-desc`. Only XPath works on both.

---

## The platform cheat sheet

The two platforms produce **different XML**. This is the thing that wastes afternoons.

| | Android | iOS |
| --- | --- | --- |
| Tag name is | the Java class | the XCUI element type |
| Example tag | `android.widget.EditText` | `XCUIElementTypeTextField` |
| `testID` lands in | `@resource-id` | `@name` |
| Text lives in | `@text` | `@label` / `@value` |
| Any element | `//*` | `//*` |

Same screen, same element, two expressions:

```
Android:  //*[@resource-id="auth.webView"]//android.widget.Button[@text="Sign in"]
iOS:      //*[@name="auth.webView"]//XCUIElementTypeButton[@name="Sign in"]
```

### Element type map

| Widget | Android | iOS |
| --- | --- | --- |
| plain container | `android.view.ViewGroup`, `android.view.View` | `XCUIElementTypeOther` |
| text | `android.widget.TextView` | `XCUIElementTypeStaticText` |
| text input | `android.widget.EditText` | `XCUIElementTypeTextField` |
| password input | `android.widget.EditText[@password="true"]` | `XCUIElementTypeSecureTextField` |
| button | `android.widget.Button` | `XCUIElementTypeButton` |
| checkbox / switch | `android.widget.CheckBox` | `XCUIElementTypeSwitch` |
| image | `android.widget.ImageView` | `XCUIElementTypeImage` |
| web container | `android.webkit.WebView` | `XCUIElementTypeWebView` |
| link | – (rendered as text) | `XCUIElementTypeLink` |

iOS is more semantic: a sign-in page yields `TextField name="Email Address"` and
`SecureTextField name="Password"`, where Android gives two bare `EditText`s
distinguishable only by `@password`. ⚠️ Pin iOS to the concrete type - `@name` matches
the wrapping container too, and document order puts the container FIRST, so an
unpinned selector types into nothing and throws nothing.

---

## Parent → child

```
/   direct child only
//  any descendant, any depth
```

Measured on one tagged WebView container:

| Expression (Android) | Matches |
| --- | --- |
| `//*[@resource-id="auth.webView"]/*` | 1 — only the direct child |
| `//*[@resource-id="auth.webView"]//*` | 17 — everything below |
| `//*[@resource-id="auth.webView"]/android.widget.EditText` | **0** — it is 6 levels down |
| `//*[@resource-id="auth.webView"]//android.widget.EditText` | **2 ✓** |

**The pattern: anchor on a testID, then `//` down.**

```
//*[@resource-id="PARENT_TESTID"]//TargetType[@attr="value"]     Android
//*[@name="PARENT_TESTID"]//TargetType[@attr="value"]            iOS
```

### Never chain `/` through layout wrappers

This resolves, but do not write it:

```
//*[@resource-id="auth.webView"]/android.webkit.WebView/android.webkit.WebView
  /android.view.View/android.view.View/android.view.View/android.view.View/android.widget.EditText
```

Every intermediate `View` is a React Native layout wrapper. RN adds and removes them
freely, and on Fabric a `View` only becomes a native element when it has a background,
a border or a `testID` — so adding a style anywhere along that path silently breaks the
chain. `//` from a stable anchor survives it.

---

## Chaining

### Preferred: chain lookups, not one long XPath

Each link is separately debuggable, and scoping stays readable:

```ts
const grid = await $(`//*[@${ID_ATTR()}="catalog.grid"]`);
const cards = await grid.$$(driver.isAndroid ? 'android.view.ViewGroup' : 'XCUIElementTypeOther');
await cards[0].click();
```

⚠️ **A scoped `$$` like that one is the most expensive call this framework can make**
on iOS - measured at 56s against 0.66s for the same question asked from the root. See
[../architecture/performance.md](../architecture/performance.md) before putting one in
a loop.

A cross-platform helper for the two shapes:

```ts
const T = {                        // element type per platform
  text:   () => (driver.isAndroid ? 'android.widget.TextView' : 'XCUIElementTypeStaticText'),
  input:  () => (driver.isAndroid ? 'android.widget.EditText'  : 'XCUIElementTypeTextField'),
  button: () => (driver.isAndroid ? 'android.widget.Button'    : 'XCUIElementTypeButton'),
};

const ID_ATTR = () => (driver.isAndroid ? 'resource-id' : 'name');

/** descendant of a tagged parent */
const within = (parentId: string, type: string, predicate = '') =>
  $(`//*[@${ID_ATTR()}="${parentId}"]//${type}${predicate}`);

await within('auth.webView', T.button(), '[@name="Sign in"]');   // iOS
```

### Chaining inside one XPath

Only when you need it in a single expression:

```
//*[@resource-id="A"]//*[@resource-id="B"]//android.widget.TextView
```

Anchor on the **outermost stable id first** — putting `//*` at the front of a hot
selector forces a full-tree walk per call.

---

## The indexing trap

`[1]` is a **per-parent** predicate, not "the first match overall". Wrap in parentheses
to index the flattened result list.

iOS, three `WebView`s on screen:

| Expression | Matches |
| --- | --- |
| `//XCUIElementTypeWebView` | 3 |
| `//XCUIElementTypeWebView[1]` | **3** ← each is the first inside its own parent |
| `(//XCUIElementTypeWebView)[1]` | **1 ✓** |

Android, two `EditText`s:

| Expression | Matches |
| --- | --- |
| `//*[@resource-id="auth.loginWebView"]//android.widget.EditText[1]` | **2** |
| `(//*[@resource-id="auth.loginWebView"]//android.widget.EditText)[1]` | 1 — email |
| `(//*[@resource-id="auth.loginWebView"]//android.widget.EditText)[2]` | 1 — password |

Better still, select on an attribute — positions reorder, attributes don't:

```
Android:  //android.widget.EditText[@password="true"]
iOS:      //XCUIElementTypeSecureTextField
```

XPath indexes are **1-based**; WDIO's `$$()` array is 0-based. Mixing them up is the
second most common off-by-one here.

---

## Going up and sideways

| Need | Expression |
| --- | --- |
| parent | `…/..` or `…/parent::*` |
| any ancestor | `…/ancestor::*` |
| nearest tagged ancestor | `…/ancestor::*[@resource-id]` (iOS: `[@name]`) |
| next sibling | `…/following-sibling::*` |
| previous sibling | `…/preceding-sibling::*` |

The label → input idiom, which is what forms usually need:

```
//android.widget.TextView[@text="Forgot your password?"]/../..//android.widget.EditText
```

Read right-to-left: find the label, go up two levels to the shared container, descend to
the input inside it.

---

## Debugging: iterate offline, not through Inspector

Appium Inspector works, but costs a source round trip per attempt and can OOM on a small
AVD. Capture the source once, then iterate for free with `xmllint` (ships with macOS).

<details>
<summary>If you do want the Inspector's point-and-click view</summary>

It is a separate GUI download, not part of this repo, and it needs an Appium server
of its own - the wdio service's one only exists for the length of a run:

```bash
npm run android:boot          # or ios:boot - the Inspector attaches, it does not boot
npx appium --allow-cors       # leave running; connect to 127.0.0.1 : 4723, path /
```

Two things that read as connection faults and are not:

- **`--allow-cors` is required by the BROWSER build** of the Inspector. Without it you
  get `Could not connect to Appium server URL` while the server is plainly up - a CORS
  block, not a connection problem. The desktop build does not need it; passing it is
  harmless either way.
- **`http://0.0.0.0:4723` in the server's log is the LISTEN address**, meaning all
  interfaces. Connect the Inspector to `127.0.0.1`; `0.0.0.0` is not a destination.

For capabilities, mirror `config/wdio/capabilities.ts` rather than inventing a set -
`appium:app` must be an ABSOLUTE path (`echo "$(pwd)/apps/YourApp.app"`), and
`appium:noReset: true` keeps it from wiping the state you wanted to look at.

```bash
SID=…   # from POST /session
curl -s "http://127.0.0.1:4723/session/$SID/source" \
  | python3 -c 'import json,sys;open("/tmp/src.xml","w").write(json.load(sys.stdin)["value"])'

q() { printf '%-64s => ' "$1"; xmllint --xpath "count($1)" /tmp/src.xml 2>/dev/null || printf 'INVALID'; echo; }
q '//*[@resource-id="auth.webView"]//android.widget.EditText'
```

`count()` is deliberate: a wrong path prints `0`, malformed syntax prints `INVALID`, so
you can tell "no match" from "broken expression". Then swap in
`string(…/@password)` to confirm you selected the element you meant, not merely *an*
element. Offline counts matched live Appium exactly for every expression in this guide.

**Iterate against `driver.getPageSource()`, never `adb shell uiautomator dump`.** In the
adb dump every tag is literally `node` and the class is an attribute, so
`//android.widget.EditText` returns 0 while looking perfectly correct:

| Source | Form required |
| --- | --- |
| `getPageSource()` | `//android.widget.EditText` |
| `adb uiautomator dump` | `//node[@class="android.widget.EditText"]` |

---

## Gotchas that actually bite

**Structure, not syntax, is what breaks chains.** Real example: on Android
`//android.widget.Button[@text="Sign in"]/ancestor::*[@resource-id="auth.screen"]`
returned **0** — `auth.screen` was a *sibling* of the WebView container, not an
ancestor of its contents. The offline loop above catches this in a second, and it is
THE ONE RULE stated in XPath.

**Many testIDs do not resolve on iOS at all.** Anything nested inside a tappable row is
collapsed out of the iOS accessibility tree — one app had ~109 of them. Target the
row's own testID there, and use `npm run capture:tree` on both platforms to find which
ids exist where.

**Don't select on localised text from web content.** A hosted login page inherits the
DEVICE's locale, so a container came back as `name="основний"` on a Simulator set to
Ukrainian. Use testIDs for app chrome and stable field names for web inputs; never
match a system-UI string.

**Nested `<Text>` inside `<Text>`** is a span with no native element on either platform.
Tag and target the outer one.

**The RN LogBox banner is a real node on Android** (`content-desc="!, Open debugger to …"`)
in a debug build, and it can swallow taps near where it sits. A release-configured iOS
build disables it — an asymmetry between your two artifacts, not a bug.
