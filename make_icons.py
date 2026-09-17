# -*- coding: utf-8 -*-
# 生成扩展图标：青色方块 + 白色 "T" 字母，纯标准库写 PNG
import os
import struct
import zlib

def write_png(path, size):
    bg = (15, 118, 110)   # teal
    fg = (255, 255, 255)  # white
    px = [[bg] * size for _ in range(size)]

    def rect(x0, y0, x1, y1, color):
        for y in range(int(y0), int(y1)):
            for x in range(int(x0), int(x1)):
                if 0 <= y < size and 0 <= x < size:
                    px[y][x] = color

    # 字母 T：顶部横杠 + 中间竖杠
    rect(size * 0.24, size * 0.26, size * 0.76, size * 0.40, fg)
    rect(size * 0.44, size * 0.40, size * 0.56, size * 0.74, fg)

    raw = b''.join(
        b'\x00' + b''.join(struct.pack('BBB', *c) for c in row) for row in px
    )

    def chunk(tag, data):
        c = struct.pack('>I', len(data)) + tag + data
        return c + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)

    out = b'\x89PNG\r\n\x1a\n'
    out += chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0))
    out += chunk(b'IDAT', zlib.compress(raw))
    out += chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(out)
    print('written:', path, size)

os.makedirs(r'E:\TextCapture文字捕获\icons', exist_ok=True)
for s in (16, 32, 48, 128):
    write_png(r'E:\TextCapture文字捕获\icons\icon%d.png' % s, s)
