import {Config} from '@remotion/cli/config';

// Browser selection is configuration-driven. When unset, Remotion manages its
// own headless browser instead of relying on a machine-specific path.
const browser = process.env.REMOTION_BROWSER_EXECUTABLE ?? process.env.CHROME_PATH;
if (browser) {
  Config.setBrowserExecutable(browser);
}

Config.setOverwriteOutput(true);
