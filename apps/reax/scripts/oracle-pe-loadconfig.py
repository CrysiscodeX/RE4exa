# pefile's reading of the load configuration fields where LLVM 18 and the Windows SDK disagree on the
# 32-bit layout (ProcessHeapFlags and ProcessAffinityMask). Run with -I and the pinned pefile install.
#   python3 scripts/oracle-pe-loadconfig.py <file.exe>   prints JSON on stdout
import json
import sys

import pefile

pe = pefile.PE(sys.argv[1], fast_load=False)
s = pe.DIRECTORY_ENTRY_LOAD_CONFIG.struct
print(json.dumps({"ProcessHeapFlags": "0x%X" % s.ProcessHeapFlags, "ProcessAffinityMask": "0x%X" % s.ProcessAffinityMask}))
