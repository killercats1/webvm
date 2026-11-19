// The root filesystem location
export const diskImageUrl = "https://github.com/leaningtech/webvm/releases/download/ext2_image/debian_mini_20230519_5022088024.ext2";
// The root filesystem backend type
export const diskImageType = "bytes";
// Print an introduction message about the technology
export const printIntro = false;
// Is a graphical display needed
export const needsDisplay = true;
// Executable full path (Required)
export const cmd = "/sbin/init";
// Arguments, as an array (Required)
export const args = [];
// Optional extra parameters
export const opts = {
	// User id
	uid: 0,
	// Group id
	gid: 0
};
