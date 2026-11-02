// `reax serve` under umask 000, for the token-file test: the daemon must make run/ 0700 and its
// files 0600 whatever the umask lets through. Run with --conditions=source.
process.umask(0);
const { main } = await import("../../src/cli.ts");
process.exitCode = await main(["serve", ...process.argv.slice(2)]);
