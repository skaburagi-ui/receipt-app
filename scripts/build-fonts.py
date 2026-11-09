#!/usr/bin/env python3
"""日本語フォント資産のビルド（再現可能）。

入力  : Google Fonts 公式リポジトリ(github.com/google/fonts)の可変フォント
          ofl/notosansjp/NotoSansJP[wght].ttf
          ofl/notoserifjp/NotoSerifJP[wght].ttf
        （再現性のため google/fonts のコミットSHAを固定して取得し、SHA-256を検証する）
処理  : fontTools.varLib.instancer で wght=400/700 の静的インスタンス化（名前表も更新）
        → JIS X 0208全域 + ASCII + 半角カナ + NEC/IBM拡張 + 記号 にサブセット化
注意  : 上流フォントに無い文字（≒ U+2252、‾ U+203E）はサブセットにも入らない（要求7,578字→cmap 7,576字）。
        findUnsupportedChars（src/seal）がこれらを未対応として返す。
出力  : public/fonts/NotoSansJP-{Regular,Bold}.subset.{ttf,woff2}
        public/fonts/NotoSerifJP-{Regular,Bold}.subset.{ttf,woff2}
        public/fonts/BUILD-INFO.json（出典・SHA-256・文字数・サイズの記録）
        TTF = PDF埋め込み用、WOFF2 = 画面用

使い方（ネットワーク必要）:
    pip install fonttools brotli
    python scripts/build-fonts.py [--src-dir <ダウンロード先>] [--out-dir public/fonts]

ダウンロード物は信頼できない入力として扱う: 専用の空ディレクトリ（既定は一時ディレクトリ）へ保存し、
SHA-256が固定値と一致しなければ中止する。取得したファイルをコードとして実行しない。
OFL.txt は docs/font-licenses/ に手で置いてある（本スクリプトは変更しない）。
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
import tempfile
import urllib.parse
import urllib.request
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

GOOGLE_FONTS_COMMIT = "fbe81817505e8aeadc53cc7a38a2b76fb57c333e"  # google/fonts main, 2026-11-05 取得時点

SOURCES = {
    "NotoSansJP": {"path": "ofl/notosansjp/NotoSansJP[wght].ttf"},
    "NotoSerifJP": {"path": "ofl/notoserifjp/NotoSerifJP[wght].ttf"},
}
# 取得ファイルのSHA-256は scripts/font-sources.sha256.json に固定（一致しなければ中止）。
PINNED_SHA_FILE = Path(__file__).with_name("font-sources.sha256.json")

WEIGHTS = {400: "Regular", 700: "Bold"}

# 追加の記号類（JIS X 0208/CP932 に無い、または確実に入れたいもの）
EXTRA_CODEPOINTS = (
    list(range(0x20, 0x7F))            # ASCII
    + list(range(0xA0, 0x100))         # Latin-1（NBSP・é 等。氏名・社名の欧文用）
    + list(range(0xFF61, 0xFFA0))      # 半角カナ
    + [0x3000, 0x00A5, 0x203E, 0x2015, 0x2014, 0x2212, 0xFF0D, 0x2016, 0x2225,
       0x301C, 0xFF5E, 0x00A6, 0xFFE0, 0xFFE1, 0xFFE2, 0xFFE3, 0xFFE4, 0xFFE5,
       0x2605, 0x2606, 0x25CB, 0x25CF, 0x2713]  # ¥ ‾ ― — − ー ∥ 〜 ～ ¦ ￠￡￢￣￤￥ ★☆○●✓
)


def jis_codepoints() -> set[int]:
    """JIS X 0208 全域 + NEC行13 + NEC選定IBM拡張 + IBM拡張 を Pythonのコーデックから列挙する。"""
    cps: set[int] = set()
    # JIS X 0208: EUC-JP 2バイト領域 (0xA1A1–0xFEFE) のうち JIS X 0208 のもの（0x8F始まりの補助漢字は含まない）
    for hi in range(0xA1, 0xFF):
        for lo in range(0xA1, 0xFF):
            try:
                ch = bytes([hi, lo]).decode("euc_jp")
            except UnicodeDecodeError:
                continue
            if len(ch) == 1:
                cps.add(ord(ch))
    # CP932（Windows-31J）: NEC行13（①㈱㌔等）・NEC選定IBM拡張・IBM拡張（髙 﨑 等）。PUA(E000–F8FF)は除外
    for hi in list(range(0x81, 0xA0)) + list(range(0xE0, 0xFD)):
        for lo in range(0x40, 0xFD):
            if lo == 0x7F:
                continue
            try:
                ch = bytes([hi, lo]).decode("cp932")
            except UnicodeDecodeError:
                continue
            if len(ch) == 1 and not (0xE000 <= ord(ch) <= 0xF8FF):
                cps.add(ord(ch))
    cps.update(EXTRA_CODEPOINTS)
    return cps


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def download(family: str, src_dir: Path) -> Path:
    spec = SOURCES[family]
    url = (
        "https://raw.githubusercontent.com/google/fonts/"
        f"{GOOGLE_FONTS_COMMIT}/" + urllib.parse.quote(spec["path"], safe="/")
    )
    dest = src_dir / f"{family}-VF.ttf"
    if not dest.exists():
        print(f"download {url}")
        req = urllib.request.Request(url, headers={"User-Agent": "receipt-app-build-fonts"})
        with urllib.request.urlopen(req, timeout=120) as r, dest.open("wb") as f:
            while True:
                chunk = r.read(1 << 20)
                if not chunk:
                    break
                f.write(chunk)
    return dest


def check_sha(family: str, path: Path) -> str:
    actual = sha256_of(path)
    pinned = {}
    if PINNED_SHA_FILE.exists():
        pinned = json.loads(PINNED_SHA_FILE.read_text(encoding="utf-8"))
    expected = pinned.get(family)
    if expected and expected != actual:
        sys.exit(f"SHA-256 mismatch for {family}: expected {expected}, got {actual}")
    if not expected:
        print(f"note: {family} SHA-256 not pinned yet: {actual}")
    return actual


def build_static(vf_path: Path, wght: int) -> TTFont:
    vf = TTFont(vf_path)
    return instancer.instantiateVariableFont(
        vf, {"wght": wght}, inplace=False, updateFontNames=True
    )


def subset_font(font: TTFont, unicodes: set[int]) -> TTFont:
    opts = subset.Options()
    # 縦書き字形(vert/vrt2)・約物詰め(palt)・kern 等だけ保持（"*" だと異体字系で約1MB増える）
    opts.layout_features = ["kern", "vert", "vrt2", "vkrn", "palt", "vpal", "locl", "ccmp", "liga", "clig", "calt", "rlig", "mark", "mkmk"]
    opts.hinting = False
    opts.desubroutinize = False
    opts.notdef_outline = True
    opts.name_IDs = ["*"]
    opts.name_languages = ["*"]
    opts.glyph_names = False
    opts.legacy_kern = False
    opts.drop_tables += ["DSIG"]
    s = subset.Subsetter(options=opts)
    s.populate(unicodes=unicodes)
    s.subset(font)
    return font


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--src-dir", type=Path, default=None, help="可変フォントの保存先（既定: 新規一時ディレクトリ）")
    ap.add_argument("--out-dir", type=Path, default=Path(__file__).resolve().parent.parent / "public" / "fonts")
    args = ap.parse_args()

    src_dir = args.src_dir or Path(tempfile.mkdtemp(prefix="receipt-fonts-"))
    src_dir.mkdir(parents=True, exist_ok=True)
    out_dir: Path = args.out_dir
    out_dir.mkdir(parents=True, exist_ok=True)

    unicodes = jis_codepoints()
    print(f"target codepoints: {len(unicodes)}")

    info: dict = {
        "generator": "scripts/build-fonts.py",
        "googleFontsCommit": GOOGLE_FONTS_COMMIT,
        "fonttools": __import__("fontTools").version,
        "requestedCodepoints": len(unicodes),
        "files": {},
        "sources": {},
    }

    for family in SOURCES:
        vf_path = download(family, src_dir)
        info["sources"][family] = {
            "url": f"https://github.com/google/fonts/blob/{GOOGLE_FONTS_COMMIT}/{SOURCES[family]['path']}",
            "sha256": check_sha(family, vf_path),
        }
        for wght, style in WEIGHTS.items():
            font = build_static(vf_path, wght)
            font = subset_font(font, unicodes)
            base = f"{family}-{style}.subset"
            ttf_path = out_dir / f"{base}.ttf"
            woff2_path = out_dir / f"{base}.woff2"
            font.flavor = None
            font.save(ttf_path)
            # WOFF2 は保存済みTTFを読み直して変換
            w = TTFont(ttf_path)
            w.flavor = "woff2"
            w.save(woff2_path)
            cmap = TTFont(ttf_path).getBestCmap()
            info["files"][f"{base}.ttf"] = {"bytes": ttf_path.stat().st_size, "cmapEntries": len(cmap)}
            info["files"][f"{base}.woff2"] = {"bytes": woff2_path.stat().st_size}
            print(f"{ttf_path.name}: {ttf_path.stat().st_size:,} B  {woff2_path.name}: {woff2_path.stat().st_size:,} B  cmap={len(cmap)}")

    (out_dir / "BUILD-INFO.json").write_text(json.dumps(info, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("done")


if __name__ == "__main__":
    main()
