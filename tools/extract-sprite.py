#!/usr/bin/env python3
"""
스크린샷에서 픽셀 캐릭터를 잘라내 PNG 스프라이트로 저장하는 도구.

브라우저로 확대되어 찍힌 도트 그림을 원래 해상도로 되돌리고(JPEG 노이즈 제거),
배경을 투명하게 만들어 assets/img/char/ 에 넣을 수 있는 PNG 를 만듭니다.

사용법:
  pip install pillow numpy
  python3 tools/extract-sprite.py 스크린샷.png --box 215,1440,475,1895 \
      --floor 520,1600 --out assets/img/char/girl.png

  --box    잘라낼 영역 x0,y0,x1,y1 (캐릭터 주변을 넉넉하게)
  --floor  배경(바닥) 색을 뽑을 지점 x,y  — 캐릭터가 없는 깨끗한 바닥
  --scale  도트 한 칸이 화면에서 몇 픽셀인지 (생략하면 자동 추정)

만든 뒤:
  1) PNG 를 assets/img/char/ 에 둡니다.
  2) assets/js/data.js 의 AVATARS 항목에 sprite: '파일명' 을 추가합니다.
     예) { id: 0, name: '지훈', sprite: 'girl', style: 'short', ... }
  3) 파일명은 확장자를 뺀 이름입니다 (girl.png → sprite: 'girl').

주의: 남이 만든 그림을 잘라 쓸 때는 저작권을 먼저 확인하세요.
"""
import argparse
from collections import deque, Counter

import numpy as np
from PIL import Image


def guess_scale(arr):
    """도트 한 칸의 화면 픽셀 크기를 추정한다 (셀 내부 분산 최소화)."""
    best = None
    for sc in np.arange(2.0, 12.01, 0.05):
        tot, n = 0.0, 0
        y = 0.0
        while y + sc <= arr.shape[0] and n < 900:
            x = 0.0
            while x + sc <= arr.shape[1]:
                c = arr[int(y):int(y + sc), int(x):int(x + sc)]
                tot += c.reshape(-1, 3).std(axis=0).sum()
                n += 1
                x += sc
            y += sc
        score = tot / max(n, 1)
        if best is None or score < best[0]:
            best = (score, sc)
    return best[1]


def align(arr, scale):
    best = None
    for oy in np.arange(0, scale, 0.25):
        for ox in np.arange(0, scale, 0.25):
            tot, n = 0.0, 0
            y = oy
            while y + scale <= arr.shape[0]:
                x = ox
                while x + scale <= arr.shape[1]:
                    c = arr[int(y):int(y + scale), int(x):int(x + scale)]
                    tot += c.reshape(-1, 3).std(axis=0).sum()
                    n += 1
                    x += scale
                y += scale
            s = tot / max(n, 1)
            if best is None or s < best[0]:
                best = (s, oy, ox)
    return best[1], best[2]


def downsample(arr, scale, oy, ox):
    H = int((arr.shape[0] - oy) // scale)
    W = int((arr.shape[1] - ox) // scale)
    out = np.zeros((H, W, 3), np.uint8)
    for j in range(H):
        for i in range(W):
            y0 = int(round(oy + j * scale))
            x0 = int(round(ox + i * scale))
            c = arr[y0 + 1:y0 + int(scale) - 1, x0 + 1:x0 + int(scale) - 1]
            if c.size == 0:
                c = arr[y0:y0 + 2, x0:x0 + 2]
            out[j, i] = np.median(c.reshape(-1, 3), axis=0)
    return out


def remove_background(small, floor, tol):
    H, W, _ = small.shape
    si = small.astype(int)
    d = np.min(np.abs(si[:, :, None, :] - floor[None, None, :, :]).sum(axis=3), axis=2)
    isfloor = d < tol

    bg = np.zeros((H, W), bool)
    q = deque()
    for y in range(H):
        for x in range(W):
            if (y in (0, H - 1) or x in (0, W - 1)) and isfloor[y, x]:
                bg[y, x] = True
                q.append((y, x))
    while q:
        y, x = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < H and 0 <= nx < W and not bg[ny, nx] and isfloor[ny, nx]:
                bg[ny, nx] = True
                q.append((ny, nx))

    solid = ~bg
    lab = np.zeros((H, W), int)
    cur = 0
    sizes = {}
    for y in range(H):
        for x in range(W):
            if solid[y, x] and lab[y, x] == 0:
                cur += 1
                n = 0
                qq = deque([(y, x)])
                lab[y, x] = cur
                while qq:
                    cy, cx = qq.popleft()
                    n += 1
                    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        ny, nx = cy + dy, cx + dx
                        if 0 <= ny < H and 0 <= nx < W and solid[ny, nx] and lab[ny, nx] == 0:
                            lab[ny, nx] = cur
                            qq.append((ny, nx))
                sizes[cur] = n
    keep = lab[H // 2, W // 2] or max(sizes, key=sizes.get)
    mask = lab == keep

    # 캐릭터 안쪽에 뚫린 구멍 메우기
    seen = np.zeros((H, W), bool)
    for y in range(H):
        for x in range(W):
            if not mask[y, x] and not seen[y, x]:
                pts = []
                touch = False
                qq = deque([(y, x)])
                seen[y, x] = True
                while qq:
                    ay, ax = qq.popleft()
                    pts.append((ay, ax))
                    if ay in (0, H - 1) or ax in (0, W - 1):
                        touch = True
                    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        ny, nx = ay + dy, ax + dx
                        if 0 <= ny < H and 0 <= nx < W and not mask[ny, nx] and not seen[ny, nx]:
                            seen[ny, nx] = True
                            qq.append((ny, nx))
                if not touch:
                    for p in pts:
                        mask[p] = True
    return mask


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('image')
    ap.add_argument('--box', required=True, help='x0,y0,x1,y1')
    ap.add_argument('--floor', required=True, help='배경색을 뽑을 지점 x,y')
    ap.add_argument('--out', required=True)
    ap.add_argument('--scale', type=float, default=0)
    ap.add_argument('--tol', type=int, default=52)
    a = ap.parse_args()

    img = Image.open(a.image).convert('RGB')
    box = tuple(int(v) for v in a.box.split(','))
    fx, fy = (int(v) for v in a.floor.split(','))

    full = np.asarray(img)
    patch = full[max(0, fy - 40):fy + 40, max(0, fx - 40):fx + 40].reshape(-1, 3)
    cnt = Counter(map(tuple, (patch // 6 * 6)))
    floor = np.array([c for c, _ in cnt.most_common(14)], int)

    crop = np.asarray(img.crop(box)).astype(float)
    scale = a.scale or guess_scale(crop)
    oy, ox = align(crop, scale)
    small = downsample(crop, scale, oy, ox)
    print('도트 한 칸 = %.2f px, 축소 후 %dx%d' % (scale, small.shape[1], small.shape[0]))

    mask = remove_background(small, floor, a.tol)
    ys, xs = np.where(mask)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    rgba = np.zeros((y1 - y0, x1 - x0, 4), np.uint8)
    rgba[..., :3] = small[y0:y1, x0:x1]
    rgba[..., 3] = mask[y0:y1, x0:x1] * 255
    out = Image.fromarray(rgba, 'RGBA')
    out.save(a.out)
    print('저장 완료:', a.out, out.size)
    print('배경 조각이 남았다면 이미지 편집기로 지우세요.')


if __name__ == '__main__':
    main()
