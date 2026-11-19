// The root OS image location, change to local filepath if serving locally
export const diskImageUrl = "/api/disk";
// The root filesystem backend type use "github" for a GitHub Release asset or "bytes" for a same-origin local file
export const diskImageType = "bytes";
// Print an introduction message about the technology
export const printIntro = true;
// Is a graphical display needed
export const needsDisplay = false;
// Executable full path (Required)
export const cmd = "/bin/bash";
// Arguments, as an array (Required)
export const args = ["--login"];
// Optional extra parameters
export const opts = {
	// Environment variables
	env: ["HOME=/root", "TERM=xterm", "USER=user", "SHELL=/bin/bash", "EDITOR=vim", "LANG=en_US.UTF-8", "LC_ALL=C"],
	// Current working directory
	cwd: "/home/user",
	// User id
	uid: 0,
	// Group id
	gid: 0
};
