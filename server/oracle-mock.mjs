// Offline oracle: answers in character without any model, streaming word by
// word. Used by the tests and when nothing else is configured.
const wait = ms => new Promise(r => setTimeout(r, ms));
const RULES = [
  [/test|spec|coverage/, 'There are 214 tests. Three are skipped, and I would not trust the skipped ones. The slowest suite is the integration run against the fixtures in test/fixtures; it alone takes forty seconds.'],
  [/auth|login|token|session|password/, 'Authentication lives in src/auth. It issues short-lived access tokens and refreshes them silently from an httpOnly cookie. Nothing else should ever read that cookie. One module tries. Look at it.'],
  [/build|deploy|ci|pipeline|release/, 'The build runs through Vite. Dev server on port 5173, production bundle in dist. Deploys go out from the release workflow on tags only. Pushing to main deploys nothing. That is deliberate.'],
  [/db|database|migrat|prisma|sql|schema/, 'The database layer uses Prisma. Migrations are in prisma/migrations and are generated, never written by hand. The schema has a soft-delete flag that two queries forget to honour.'],
];
const DEFAULT = [
  'That service is deprecated. The replacement is the event bus in packages/core. Everything still calling the old one is listed in the deprecation report. Nobody has read it.',
  'The entry point is src/main.ts. It wires the router, the store and the telemetry, in that order, and the order matters more than the comments admit.',
  'Two code paths do the same work. One of them is correct. The tests cover the other.',
];

export function createMockOracle({ delay = 35 } = {}) {
  return {
    kind: 'mock', model: 'none',
    async ask({ question, emit, signal }) {
      emit({ type: 'tool', label: 'SCANNING /' }); await wait(delay * 8);
      emit({ type: 'tool', label: 'READING SRC/MAIN.TS' }); await wait(delay * 10);
      const q = String(question).toLowerCase();
      const text = (RULES.find(([re]) => re.test(q)) || [null, DEFAULT[Math.floor(Math.random() * DEFAULT.length)]])[1];
      let out = '';
      for (const w of text.split(/(?<=\s)/)) { if (signal?.aborted) break; out += w; emit({ type: 'delta', text: w }); await wait(delay); }
      return { answer: out };
    },
  };
}
