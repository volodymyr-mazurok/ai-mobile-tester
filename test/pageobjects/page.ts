import { Component } from "./abstraction/component";

/**
 * The base every screen extends.
 *
 * A page is just a Component with NO SELECTOR - it IS the document root, so its
 * children search the whole screen rather than inside anything. That is the only
 * thing this base is required to do.
 *
 * ⚠️ PUT YOUR APP'S SHARED CHROME HERE - the header, the tab bar, a nav drawer:
 * whatever genuinely appears on every screen. Declaring it once means a page
 * object describes only what makes that screen different, and a chrome change
 * is one edit rather than one per page.
 *
 * Anything declared here can be REPLACED by a subclass simply by redeclaring the
 * same alias; the last definition wins, exactly like overriding a method.
 *
 * ⚠️ AND DECLARE IT THE WAY THE APP ACTUALLY NESTS IT, not the way it reads best.
 * THE ONE RULE (see abstraction/component.ts) is that a child is looked up INSIDE
 * its parent's element. Real RN headers are frequently FLAT - the container and
 * its "children" are siblings under an untagged parent - and nesting them anyway
 * produces a page object that reads beautifully and finds nothing. Capture the
 * screen first: `inspect-live-screen`.
 */
export abstract class MobilePage extends Component {
  /**
   * @param alias  what this screen is called in errors and paths, e.g. "Catalog"
   * @param prefix optional testID prefix its children hang off, so each child can
   *               name just its own tail. Omit it for an app whose ids are flat
   *               phrases ("products screen") rather than dotted paths
   *               ("catalog.header.title").
   */
  protected constructor(alias: string, prefix?: string) {
    super({ alias, prefix });
  }
}

export default MobilePage;
