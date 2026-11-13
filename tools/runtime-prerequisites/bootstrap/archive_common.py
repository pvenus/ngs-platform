"""Minimal local archive safety helpers; no Git, Workers, models or services."""
import ctypes
import errno
import os
from pathlib import Path
import stat
import sys

class BootstrapError(ValueError):
    pass

def deny(code):
    raise BootstrapError(code)

def checked(value, *, directory=True):
    path = Path(value)
    if any(ord(c) < 32 for c in str(path)):
        deny('PATH_CONTROL_CHARACTER_DENIED')
    if not path.is_absolute() or '..' in path.parts:
        deny('CANONICAL_ABSOLUTE_PATH_REQUIRED')
    cursor = Path(path.anchor)
    for part in path.parts[1:]:
        cursor /= part
        info = cursor.lstat()
        if stat.S_ISLNK(info.st_mode):
            deny('SYMLINK_DENIED')
        if cursor != path and not stat.S_ISDIR(info.st_mode):
            deny('PATH_PARENT_INVALID')
    info = path.lstat()
    if not (stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode)):
        deny('PATH_TYPE_INVALID')
    if info.st_uid != os.getuid() or info.st_mode & 0o022:
        deny('PATH_OWNER_OR_MODE_INVALID')
    if path.resolve(strict=True) != path:
        deny('CANONICAL_ABSOLUTE_PATH_REQUIRED')
    return path

def unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            deny('DUPLICATE_KEY')
        result[key] = value
    return result

def install_absent(payload, target):
    """Atomic exclusive rename, never a check-then-overwrite rename fallback."""
    libc = ctypes.CDLL(None, use_errno=True)
    source_fd = os.open(payload.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    target_fd = os.open(target.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        if sys.platform == 'darwin':
            rename = libc.renameatx_np
            flag = 4  # Darwin RENAME_EXCL.
        else:
            deny('ATOMIC_EXCLUSIVE_INSTALL_UNSUPPORTED')
        rename.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
        rename.restype = ctypes.c_int
        if rename(source_fd, os.fsencode(payload.name), target_fd, os.fsencode(target.name), flag):
            if ctypes.get_errno() in (errno.EEXIST, errno.ENOTEMPTY):
                deny('DESTINATION_APPEARED')
            deny('ATOMIC_INSTALL_FAILED')
    finally:
        os.close(source_fd)
        os.close(target_fd)
