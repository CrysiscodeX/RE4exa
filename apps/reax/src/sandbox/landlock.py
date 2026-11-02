# reax's Linux sandbox helper (ADR 0006). Run by the system python3 in isolated mode, standard
# library only (ctypes), nothing installed:
#   python3 -I landlock.py --abi                  prints the Landlock ABI (0: no Landlock)
#   python3 -I landlock.py <scratch> -- argv...   restricts itself, then execs argv
# The restriction: every write-class filesystem right is handled and allowed only beneath <scratch>
# (and writing /dev/null); from ABI 4, TCP connect and bind are handled with no rule, so refused.
# Reads are not restricted. Any failure before exec exits 125 with "reax-landlock:" on stderr and
# runs nothing (fail closed).
import ctypes
import os
import platform
import sys

SYS_CREATE_RULESET = 444  # the same number on x86_64 and aarch64
SYS_ADD_RULE = 445
SYS_RESTRICT_SELF = 446
PR_SET_NO_NEW_PRIVS = 38
CREATE_RULESET_VERSION = 1 << 0
RULE_PATH_BENEATH = 1

FS_WRITE_FILE = 1 << 1
FS_REMOVE_DIR = 1 << 4
FS_REMOVE_FILE = 1 << 5
FS_MAKE_CHAR = 1 << 6
FS_MAKE_DIR = 1 << 7
FS_MAKE_REG = 1 << 8
FS_MAKE_SOCK = 1 << 9
FS_MAKE_FIFO = 1 << 10
FS_MAKE_BLOCK = 1 << 11
FS_MAKE_SYM = 1 << 12
FS_REFER = 1 << 13  # ABI 2
FS_TRUNCATE = 1 << 14  # ABI 3
NET_BIND_TCP = 1 << 0  # ABI 4
NET_CONNECT_TCP = 1 << 1  # ABI 4


class RulesetAttr(ctypes.Structure):
    _fields_ = [("handled_access_fs", ctypes.c_uint64), ("handled_access_net", ctypes.c_uint64)]


class PathBeneathAttr(ctypes.Structure):
    _pack_ = 1
    _fields_ = [("allowed_access", ctypes.c_uint64), ("parent_fd", ctypes.c_int32)]


libc = None


def load_libc():
    global libc
    libc = ctypes.CDLL(None, use_errno=True)
    libc.syscall.restype = ctypes.c_long
    libc.prctl.restype = ctypes.c_int


def fail(why):
    sys.stderr.write("reax-landlock: %s\n" % why)
    sys.exit(125)


def abi():
    if sys.platform != "linux" or platform.machine() not in ("x86_64", "aarch64"):
        return 0
    load_libc()
    v = libc.syscall(ctypes.c_long(SYS_CREATE_RULESET), ctypes.c_void_p(None), ctypes.c_size_t(0),
                     ctypes.c_uint32(CREATE_RULESET_VERSION))
    return v if v > 0 else 0


def write_rights(v):
    r = (FS_WRITE_FILE | FS_REMOVE_DIR | FS_REMOVE_FILE | FS_MAKE_CHAR | FS_MAKE_DIR | FS_MAKE_REG
         | FS_MAKE_SOCK | FS_MAKE_FIFO | FS_MAKE_BLOCK | FS_MAKE_SYM)
    if v >= 2:
        r |= FS_REFER
    if v >= 3:
        r |= FS_TRUNCATE
    return r


def add_rule(ruleset, path, allowed):
    try:
        fd = os.open(path, os.O_PATH | os.O_CLOEXEC)
    except OSError as e:
        fail("cannot open %s: %s" % (path, e.strerror))
    attr = PathBeneathAttr(allowed, fd)
    r = libc.syscall(ctypes.c_long(SYS_ADD_RULE), ctypes.c_int(ruleset), ctypes.c_int(RULE_PATH_BENEATH),
                     ctypes.byref(attr), ctypes.c_uint32(0))
    err = ctypes.get_errno()
    os.close(fd)
    if r != 0:
        fail("landlock_add_rule(%s): %s" % (path, os.strerror(err)))


def main(args):
    if args == ["--abi"]:
        print(abi())
        return
    if len(args) < 3 or args[1] != "--":
        fail("usage: landlock.py <scratch> -- argv...")
    scratch, argv = args[0], args[2:]
    v = abi()
    if v < 1:
        fail("Landlock is not available")
    fs = write_rights(v)
    net = NET_BIND_TCP | NET_CONNECT_TCP if v >= 4 else 0
    attr = RulesetAttr(fs, net)
    size = ctypes.sizeof(RulesetAttr) if v >= 4 else 8  # handled_access_net exists from ABI 4
    ruleset = libc.syscall(ctypes.c_long(SYS_CREATE_RULESET), ctypes.byref(attr), ctypes.c_size_t(size),
                           ctypes.c_uint32(0))
    if ruleset < 0:
        fail("landlock_create_ruleset: %s" % os.strerror(ctypes.get_errno()))
    add_rule(ruleset, scratch, fs)
    add_rule(ruleset, "/dev/null", FS_WRITE_FILE | (FS_TRUNCATE if v >= 3 else 0))
    if libc.prctl(ctypes.c_int(PR_SET_NO_NEW_PRIVS), ctypes.c_ulong(1), ctypes.c_ulong(0), ctypes.c_ulong(0),
                  ctypes.c_ulong(0)) != 0:
        fail("prctl(PR_SET_NO_NEW_PRIVS): %s" % os.strerror(ctypes.get_errno()))
    if libc.syscall(ctypes.c_long(SYS_RESTRICT_SELF), ctypes.c_int(ruleset), ctypes.c_uint32(0)) != 0:
        fail("landlock_restrict_self: %s" % os.strerror(ctypes.get_errno()))
    os.close(ruleset)
    try:
        os.execvp(argv[0], argv)
    except OSError as e:
        sys.stderr.write("reax-landlock: cannot run %s: %s\n" % (argv[0], e.strerror))
        sys.exit(127)


main(sys.argv[1:])
