import { afterEach } from "vitest";
import { resetFmpRestrictions } from "./lib/fmp";
import { resetProviderEvents } from "./lib/provider-status";

// The FMP refusal memory and provider events live for the server process; each test starts without them.
afterEach(() => {
  resetFmpRestrictions();
  resetProviderEvents();
});
