"""Real PTY workload: colored content and a 120Hz status row during typing."""
import os
import select
import sys
import termios
import tty

previous = termios.tcgetattr(sys.stdin)
cols, rows = os.get_terminal_size()
value = ""
frame = 0
try:
    tty.setraw(sys.stdin.fileno())
    sys.stdout.write("\x1b[?1049h\x1b[2J")
    for y in range(3, rows):
        text = "中文 e\u0301 🦊" if y == 3 else ("colored terminal content " * 8)[:cols]
        sys.stdout.write(f"\x1b[{y};1H\x1b[38;5;{30+y}m{text}\x1b[0m")
    sys.stdout.flush()
    while True:
        ready, _, _ = select.select([sys.stdin], [], [], 1 / 120)
        if ready:
            data = os.read(sys.stdin.fileno(), 4096)
            if b"\x03" in data or not data:
                break
            for char in data.decode("utf-8"):
                if char == "\x15":
                    value = ""
                elif char in ("\x7f", "\x08"):
                    value = value[:-1]
                elif char.isprintable():
                    value += char
        frame += 1
        sys.stdout.write(f"\x1b[?2026h\x1b[1;1HSTREAM FRAME {frame:08d}\x1b[K\x1b[{rows};1HSTREAM> {value}\x1b[K\x1b[?2026l")
        sys.stdout.flush()
finally:
    sys.stdout.write("\x1b[?1049l")
    sys.stdout.flush()
    termios.tcsetattr(sys.stdin, termios.TCSADRAIN, previous)
