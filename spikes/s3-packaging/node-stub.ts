// Windows complement to ci.yml's "Block Node.js" step. That step writes an
// extensionless sh script, which only Git Bash can run: CreateProcess and
// libuv spawns look for node.exe / node.cmd. Compiled with
// `bun build --compile` into the same directory as node.exe.
console.error(`::error::node was called: ${process.argv.slice(2).join(" ")}`);
process.exit(1);
