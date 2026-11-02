import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BrowserProvisioningRefused,
  TLS_BYPASS_WARNING,
  checkRenderBrowser,
  tlsEnvironmentWarning,
} from '../src/remotion/browserReadiness';

const managedReady = async (): Promise<{type: 'local-puppeteer-browser'; path: string}> => ({
  type: 'local-puppeteer-browser',
  path: '/managed/chrome-headless-shell',
});

test('a managed browser renders without any network access', async () => {
  const readiness = await checkRenderBrowser({env: {}, ensureBrowser: managedReady});
  assert.equal(readiness.status, 'BROWSER_READY');
  assert.equal(readiness.source, 'managed');
  assert.equal(readiness.executable, '/managed/chrome-headless-shell');
  assert.equal(readiness.provisioning, 'not-required');
});

test('an explicitly configured executable is validated and reported', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mvfoundry-browser-'));
  try {
    const executable = path.join(dir, 'chrome.exe');
    writeFileSync(executable, 'placeholder');
    const ready = await checkRenderBrowser({
      env: {REMOTION_BROWSER_EXECUTABLE: executable},
      ensureBrowser: async ({browserExecutable}) => ({type: 'user-defined-path', path: String(browserExecutable)}),
    });
    assert.equal(ready.status, 'BROWSER_READY');
    assert.equal(ready.source, 'environment');
    assert.equal(ready.executable, executable);

    const invalid = await checkRenderBrowser({
      env: {CHROME_PATH: path.join(dir, 'nope.exe')},
      ensureBrowser: managedReady,
    });
    assert.equal(invalid.status, 'BROWSER_EXECUTABLE_INVALID');
    assert.match(invalid.detail, /does not exist/);
    assert.ok(invalid.guidance.length > 0);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test('a missing browser refuses provisioning instead of downloading', async () => {
  let downloaded = false;
  const readiness = await checkRenderBrowser({
    env: {},
    ensureBrowser: async ({onBrowserDownload}) => {
      // Remotion calls this callback only when it is about to download.
      onBrowserDownload();
      downloaded = true;
      return {type: 'no-browser'};
    },
  });
  assert.equal(downloaded, false);
  assert.equal(readiness.status, 'BROWSER_PROVISIONING_NOT_AUTHORIZED');
  assert.equal(readiness.provisioning, 'refused');
  assert.equal(readiness.executable, null);
  assert.match(readiness.detail, /refuses to download implicitly/);
});

test('Remotion reporting no browser and a version mismatch stays distinct', async () => {
  const missing = await checkRenderBrowser({
    env: {},
    ensureBrowser: async () => ({type: 'no-browser'}),
  });
  assert.equal(missing.status, 'BROWSER_MISSING');

  const mismatch = await checkRenderBrowser({
    env: {},
    ensureBrowser: async () => ({type: 'version-mismatch', actualVersion: '99.0.0.0'}),
  });
  assert.equal(mismatch.status, 'BROWSER_VERSION_UNSUPPORTED');
  assert.match(mismatch.detail, /99\.0\.0\.0/);
});

test('the provisioning refusal is a distinct error type', () => {
  const error = new BrowserProvisioningRefused();
  assert.equal(error.name, 'BrowserProvisioningRefused');
  assert.match(error.message, /never provisions one implicitly/);
});

test('a host-wide TLS bypass is reported but never applied', () => {
  assert.equal(tlsEnvironmentWarning({}), null);
  assert.equal(tlsEnvironmentWarning({NODE_TLS_REJECT_UNAUTHORIZED: '1'}), null);
  assert.equal(tlsEnvironmentWarning({NODE_TLS_REJECT_UNAUTHORIZED: '0'}), TLS_BYPASS_WARNING);
  assert.match(TLS_BYPASS_WARNING, /never disables certificate verification/);
});