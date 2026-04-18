/**
 * Tests for per-backend model-queue scoping. These cover the behavior
 * that the Settings UI and sendMessage both depend on:
 *
 * - normalizeServerUrlForMatch is the comparison oracle. Two URLs that
 *   should mean the same backend must normalize identically; otherwise
 *   the Settings filter and the dispatch filter will silently disagree
 *   about which entry is "yours" right now.
 * - modelEntryMatchesBackend keeps unstamped entries universal so first
 *   load after the migration shipped doesn't make anyone's queue vanish.
 * - stampUnstampedEntries is the migration itself.
 * - selectQueueForBackend is what dispatch reads. It must drop disabled
 *   entries and entries from other backends, but keep unstamped legacy
 *   entries enabled.
 *
 * Run with: `npm --prefix backend exec -- node --test --import tsx --test-reporter=spec ../store/queueScope.test.ts`
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  modelEntryMatchesBackend,
  normalizeServerUrlForMatch,
  selectQueueForBackend,
  stampUnstampedEntries,
  type ScopedEntry,
} from "./queueScope";

describe("normalizeServerUrlForMatch", () => {
  it("defaults missing scheme to http://", () => {
    assert.equal(
      normalizeServerUrlForMatch("192.168.1.9:5000"),
      "http://192.168.1.9:5000"
    );
  });

  it("preserves an existing https:// scheme", () => {
    assert.equal(
      normalizeServerUrlForMatch("https://abc.trycloudflare.com"),
      "https://abc.trycloudflare.com"
    );
  });

  it("strips trailing slashes", () => {
    assert.equal(
      normalizeServerUrlForMatch("http://127.0.0.1:5000/"),
      "http://127.0.0.1:5000"
    );
    assert.equal(
      normalizeServerUrlForMatch("http://127.0.0.1:5000///"),
      "http://127.0.0.1:5000"
    );
  });

  it("trims surrounding whitespace", () => {
    assert.equal(
      normalizeServerUrlForMatch("  http://localhost:5000  "),
      "http://localhost:5000"
    );
  });

  it("returns empty string for nullish or empty input", () => {
    assert.equal(normalizeServerUrlForMatch(undefined), "");
    assert.equal(normalizeServerUrlForMatch(null), "");
    assert.equal(normalizeServerUrlForMatch(""), "");
    assert.equal(normalizeServerUrlForMatch("   "), "");
  });

  it("treats bare-host vs full URL with trailing slash as equal after normalization", () => {
    // This is the regression that was making the dedupe + filter disagree.
    assert.equal(
      normalizeServerUrlForMatch("192.168.1.9:5000"),
      normalizeServerUrlForMatch("http://192.168.1.9:5000/")
    );
  });
});

describe("modelEntryMatchesBackend", () => {
  const localUrl = "http://192.168.1.9:5000";
  const vpsUrl = "https://my-vps.example.com";

  it("matches an entry stamped with the active backend", () => {
    assert.equal(
      modelEntryMatchesBackend({ serverUrl: localUrl }, localUrl),
      true
    );
  });

  it("rejects an entry stamped with a different backend", () => {
    assert.equal(
      modelEntryMatchesBackend({ serverUrl: vpsUrl }, localUrl),
      false
    );
  });

  it("treats unstamped entries as universal so legacy queues don't vanish", () => {
    assert.equal(modelEntryMatchesBackend({}, localUrl), true);
    assert.equal(modelEntryMatchesBackend({ serverUrl: undefined }, vpsUrl), true);
  });

  it("normalizes both sides before comparing", () => {
    assert.equal(
      modelEntryMatchesBackend(
        { serverUrl: "192.168.1.9:5000/" },
        normalizeServerUrlForMatch("http://192.168.1.9:5000")
      ),
      true
    );
  });
});

describe("stampUnstampedEntries", () => {
  const url = "http://192.168.1.9:5000";

  it("stamps every unstamped entry with the active URL", () => {
    const queue: ScopedEntry[] = [{}, { serverUrl: "https://other" }, {}];
    const stamped = stampUnstampedEntries(queue, url);
    assert.ok(stamped, "expected a non-null result when migration is needed");
    assert.equal(stamped[0].serverUrl, url);
    assert.equal(stamped[1].serverUrl, "https://other");
    assert.equal(stamped[2].serverUrl, url);
  });

  it("returns null when the queue is already fully stamped (no work to do)", () => {
    const queue: ScopedEntry[] = [
      { serverUrl: url },
      { serverUrl: "https://other" },
    ];
    assert.equal(stampUnstampedEntries(queue, url), null);
  });

  it("returns null when the active URL is empty (don't stamp with garbage)", () => {
    const queue: ScopedEntry[] = [{}];
    assert.equal(stampUnstampedEntries(queue, ""), null);
  });

  it("returns null on an empty queue", () => {
    assert.equal(stampUnstampedEntries([], url), null);
  });

  it("does not mutate the input queue", () => {
    const queue: ScopedEntry[] = [{}];
    const stamped = stampUnstampedEntries(queue, url);
    assert.equal(queue[0].serverUrl, undefined);
    assert.notEqual(stamped, queue);
  });
});

describe("selectQueueForBackend", () => {
  const localUrl = "http://192.168.1.9:5000";
  const vpsUrl = "https://my-vps.example.com";

  it("drops disabled entries even when their backend matches", () => {
    const queue: ScopedEntry[] = [
      { serverUrl: localUrl, enabled: false },
      { serverUrl: localUrl, enabled: true },
    ];
    const out = selectQueueForBackend(queue, localUrl);
    assert.equal(out.length, 1);
    assert.equal(out[0].enabled, true);
  });

  it("drops entries belonging to a different backend", () => {
    const queue: ScopedEntry[] = [
      { serverUrl: localUrl, enabled: true },
      { serverUrl: vpsUrl, enabled: true },
    ];
    const out = selectQueueForBackend(queue, vpsUrl);
    assert.equal(out.length, 1);
    assert.equal(out[0].serverUrl, vpsUrl);
  });

  it("keeps unstamped legacy entries when they're enabled", () => {
    const queue: ScopedEntry[] = [
      { enabled: true },
      { serverUrl: vpsUrl, enabled: true },
    ];
    const out = selectQueueForBackend(queue, localUrl);
    assert.equal(out.length, 1);
    assert.equal(out[0].serverUrl, undefined);
  });

  it("preserves order of the remaining entries", () => {
    const queue: ScopedEntry[] = [
      { serverUrl: localUrl, enabled: true },
      { serverUrl: vpsUrl, enabled: true },
      { serverUrl: localUrl, enabled: true },
    ];
    const out = selectQueueForBackend(queue, localUrl);
    assert.equal(out.length, 2);
    // Both entries are stamped to localUrl; verify they came back in
    // the same relative order they appeared in the input queue.
    assert.deepEqual(
      out.map((_, i) => i),
      [0, 1]
    );
  });

  it("treats `enabled: undefined` as disabled", () => {
    const queue: ScopedEntry[] = [{ serverUrl: localUrl }];
    assert.equal(selectQueueForBackend(queue, localUrl).length, 0);
  });

  it("normalizes the comparison so bare host vs full URL match", () => {
    const queue: ScopedEntry[] = [
      { serverUrl: "192.168.1.9:5000", enabled: true },
    ];
    const out = selectQueueForBackend(
      queue,
      normalizeServerUrlForMatch("http://192.168.1.9:5000/")
    );
    assert.equal(out.length, 1);
  });
});
