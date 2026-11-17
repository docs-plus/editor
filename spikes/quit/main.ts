// Spike #106 Electron main: the quit probe, then S5's instrumentation and
// S1's shell unchanged (the same stack S5's Playwright arms launched).
import "./quit-probe";
import "../s5-latency/instrument";
import "../s1-shell/main";
