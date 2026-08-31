/**
 * CHARTER: sweep every top-level screen and report what the tree alone gives away.
 *
 * The one charter worth keeping and re-running on every app build. It goes
 * nowhere clever - your top-level screens, in order - and its value is entirely
 * in the ORACLES it runs over each one (see `smells()` in test/support/explore.ts):
 * leaked placeholder values, copy that repeats a phrase back-to-back, a testID
 * matching two elements, visible text with no addressable owner, unlabelled
 * controls, currency and dash inconsistency, zero-size content, horizontally
 * clipped elements.
 *
 * None of that is asserted anywhere in test/specs/, and none of it is what a
 * smoke suite is for - a regression checks the figures it seeded, and cannot
 * notice a second element quietly answering to the same testID.
 *
 * It also PROBES the controls listed in `PROBES`, purely to record whether they
 * do anything at all. `probe()`'s `dead-control` observation is the finding
 * shape "I tapped it and nothing in the tree moved" - which is a real bug class
 * and one no assertion-based suite will ever catch.
 *
 * ⚠️ THIS FILE IS APP-SHAPED BY DESIGN. It reads your screens from
 * test/pageobjects/screens.ts and needs no other per-app knowledge. If your app
 * has no bottom tab bar, change `visit()` - the oracles do not care how you got
 * there.
 *
 * Output: `.explore/sweep-<platform>/`.
 */
import * as fs from "fs";
import { browser } from "@wdio/globals";
import ActionHelper from "../../utils/actionHelper";
import { PROBES, SCREENS, signInForExploration, visit } from "../pageobjects/screens";
import { longFlowTimeout } from "../support/timeouts";
import { inventory, probe, smells, startSession } from "../support/explore";

describe("Charter: screen sweep", function () {
  this.timeout(longFlowTimeout());

  it("visits every screen, records the tree, and probes untested controls", async () => {
    const session = startSession("sweep");
    await signInForExploration();
    const window = await browser.getWindowSize();

    for (const screen of SCREENS) {
      await session.step(`${screen.alias}`, async () => {
        await visit(screen);
        // Start from the top: scroll position persists across specs and across
        // sessions (noReset), so "what does this screen show" is otherwise a
        // question about whatever ran last.
        await ActionHelper.scroll("up", 3);

        const top = await session.snapshot(`${screen.alias}-top`);
        for (const o of smells(top, window)) session.observe(o);
        fs.writeFileSync(`${session.dir}/${screen.alias}-inventory.txt`, inventory(top));

        // Below the fold is a different screen as far as the tree is concerned -
        // on Android literally so, since only laid-out content is in the source.
        await ActionHelper.scroll("down", 3);
        const bottom = await session.snapshot(`${screen.alias}-bottom`);
        for (const o of smells(bottom, window)) session.observe(o);

        const unseen = bottom.ids.filter((id) => !top.ids.includes(id));
        session.note(`  ${unseen.length} ids only visible after scrolling`);
      });
    }

    // Controls the suite never touches. Each is one tap with an obvious right
    // answer that nothing currently checks.
    for (const p of PROBES) {
      await session.step(`probe: ${p.name}`, async () => {
        await visit(p.screen);
        await probe(session, p.name, () => ActionHelper.click(p.path));
      });
    }

    session.finish();
  });
});
