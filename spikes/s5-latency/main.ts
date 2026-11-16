// Spike S5 Electron main: S5's instrumentation, then S1's shell unchanged
// (app://tinydocy, the desktop CSP, the sandboxed preload). Imports run in
// order, so the instrumentation's switches and env are in place before S1's
// module body reads them.
import "./instrument";
import "../s1-shell/main";
